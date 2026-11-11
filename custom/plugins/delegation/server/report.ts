import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type {
  DelegationGroup,
  DelegationReport,
  DelegationReportSession,
} from "@getpaseo/protocol/delegation";
import { DELEGATION_MARKER, isDelegationEligible } from "../shared/policy";

// The sheet's Reports tab. Reads this daemon's agent records (PASEO_HOME/agents) for Claude
// sessions on Opus/Fable active in the period, splits them by whether their saved system prompt
// has the rule, and prices each one's Claude transcript (CLAUDE_CONFIG_DIR/projects) at API rates.
// A subscription pays in usage limits, not dollars, but in about the same proportion.

/** $ per million tokens: input, cache read, cache write (1 h TTL, what Claude Code uses), output. */
const PRICES: { match: RegExp; price: [number, number, number, number] }[] = [
  { match: /fable|mythos/, price: [8, 0.2, 16, 40] },
  { match: /opus-5-5/, price: [4, 0.2, 8, 20] },
  { match: /opus/, price: [5, 0.5, 10, 25] },
  { match: /sonnet-5-5/, price: [2, 0.1, 4, 10] },
  { match: /sonnet/, price: [3, 0.3, 6, 15] },
  { match: /haiku-5-5/, price: [0.1, 0.01, 0.2, 0.5] },
  { match: /haiku/, price: [1, 0.1, 2, 5] },
];

export function priceUsage(model: string, usage: Usage): number {
  const price = PRICES.find((entry) => entry.match.test(model))?.price;
  if (!price) return 0;
  return (
    (usage.input * price[0] +
      usage.cacheRead * price[1] +
      usage.cacheWrite * price[2] +
      usage.output * price[3]) /
    1e6
  );
}

interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface TranscriptStats {
  turns: number;
  mainCost: number;
  mainCacheRead: number;
  subagentCost: number;
  agentCalls: number;
  cheapAgentCalls: number;
  fixMessages: number;
}

interface StoredAgent {
  id: string;
  provider: string;
  cwd: string;
  title?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  internal?: boolean;
  config?: { model?: string; systemPrompt?: string | null } | null;
  persistence?: { sessionId?: string | null } | null;
}

const cache = new Map<string, { key: string; stats: TranscriptStats }>();

/** Prices one transcript file; `sidechain` counts every line as subagent work. */
async function scanFile(
  file: string,
  stats: TranscriptStats,
  seen: Set<string>,
  sidechain: boolean,
): Promise<void> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"assistant"')) continue;
    let entry: {
      type?: string;
      isSidechain?: boolean;
      requestId?: string;
      message?: {
        id?: string;
        model?: string;
        usage?: Record<string, number>;
        content?: { type?: string; id?: string; name?: string; input?: { model?: string } }[];
      };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (entry.type !== "assistant" || !message) continue;
    const sub = sidechain || entry.isSidechain === true;
    // Claude Code writes one line per content block with the same usage: count each request once.
    const id = `${message.id}:${entry.requestId}`;
    if (message.usage && message.model && !seen.has(id)) {
      seen.add(id);
      const usage: Usage = {
        input: message.usage.input_tokens ?? 0,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        output: message.usage.output_tokens ?? 0,
      };
      const cost = priceUsage(message.model, usage);
      if (sub) stats.subagentCost += cost;
      else {
        stats.mainCost += cost;
        stats.mainCacheRead += usage.cacheRead;
        stats.turns += 1;
      }
    }
    if (sub) continue;
    for (const block of message.content ?? []) {
      if (block.type !== "tool_use") continue;
      const blockId = `tool:${block.id ?? `${id}:${block.name}`}`;
      if (seen.has(blockId)) continue;
      seen.add(blockId);
      if (block.name === "Agent" || block.name === "Task") {
        stats.agentCalls += 1;
        if (block.input?.model === "sonnet" || block.input?.model === "haiku")
          stats.cheapAgentCalls += 1;
      }
      if (block.name === "SendMessage") stats.fixMessages += 1;
    }
  }
}

async function findTranscript(claudeDir: string, sessionId: string): Promise<string | null> {
  const projects = path.join(claudeDir, "projects");
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (await stat(file).catch(() => null)) return file;
  }
  return null;
}

export async function readTranscriptStats(file: string): Promise<TranscriptStats> {
  const subDir = file.replace(/\.jsonl$/, "/subagents");
  const subFiles = (await readdir(subDir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(subDir, name));
  const keyParts = [];
  for (const each of [file, ...subFiles]) {
    const info = await stat(each);
    keyParts.push(`${each}:${info.size}:${info.mtimeMs}`);
  }
  const key = keyParts.join("|");
  const cached = cache.get(file);
  if (cached?.key === key) return cached.stats;
  const stats: TranscriptStats = {
    turns: 0,
    mainCost: 0,
    mainCacheRead: 0,
    subagentCost: 0,
    agentCalls: 0,
    cheapAgentCalls: 0,
    fixMessages: 0,
  };
  const seen = new Set<string>();
  await scanFile(file, stats, seen, false);
  for (const sub of subFiles) await scanFile(sub, stats, seen, true);
  cache.set(file, { key, stats });
  return stats;
}

async function readAgents(paseoHome: string): Promise<StoredAgent[]> {
  const root = path.join(paseoHome, "agents");
  const files = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const agents: StoredAgent[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      agents.push(JSON.parse(await readFile(path.join(root, file), "utf8")) as StoredAgent);
    } catch {
      // A record being written right now; the next report reads it.
    }
  }
  return agents;
}

function emptyGroup(): DelegationGroup {
  return {
    sessions: 0,
    missing: 0,
    turns: 0,
    mainCost: 0,
    subagentCost: 0,
    contextPerTurn: 0,
    agentCalls: 0,
    cheapAgentCalls: 0,
  };
}

export async function buildReport(input: {
  days: number;
  paseoHome?: string;
  claudeDir?: string;
  now?: number;
}): Promise<DelegationReport> {
  const paseoHome = input.paseoHome ?? process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
  const claudeDir =
    input.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const cutoff = (input.now ?? Date.now()) - input.days * 86_400_000;
  const groups = { delegated: emptyGroup(), other: emptyGroup() };
  const cacheReads = { delegated: 0, other: 0 };
  const sessions: DelegationReportSession[] = [];

  for (const agent of await readAgents(paseoHome)) {
    const at = agent.lastActivityAt ?? agent.updatedAt;
    if (agent.internal || !at || Date.parse(at) < cutoff) continue;
    const delegated = agent.config?.systemPrompt?.includes(DELEGATION_MARKER) ?? false;
    // The comparison only makes sense among sessions that could have delegated.
    const model = agent.config?.model;
    if (!delegated && !isDelegationEligible({ provider: agent.provider, model })) continue;
    const name = delegated ? "delegated" : "other";
    const group = groups[name];
    group.sessions += 1;
    const sessionId = agent.persistence?.sessionId;
    const file = sessionId ? await findTranscript(claudeDir, sessionId) : null;
    if (!file) {
      group.missing += 1;
      continue;
    }
    const stats = await readTranscriptStats(file);
    group.turns += stats.turns;
    group.mainCost += stats.mainCost;
    group.subagentCost += stats.subagentCost;
    group.agentCalls += stats.agentCalls;
    group.cheapAgentCalls += stats.cheapAgentCalls;
    cacheReads[name] += stats.mainCacheRead;
    sessions.push({
      agentId: agent.id,
      title: agent.title ?? null,
      cwd: agent.cwd,
      lastActivityAt: at,
      delegated,
      turns: stats.turns,
      mainCost: stats.mainCost,
      subagentCost: stats.subagentCost,
      contextPerTurn: stats.turns ? stats.mainCacheRead / stats.turns : 0,
      agentCalls: stats.agentCalls,
      cheapAgentCalls: stats.cheapAgentCalls,
      fixMessages: stats.fixMessages,
    });
  }
  for (const name of ["delegated", "other"] as const) {
    const group = groups[name];
    group.contextPerTurn = group.turns ? cacheReads[name] / group.turns : 0;
  }
  sessions.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return { days: input.days, ...groups, sessions: sessions.slice(0, 50) };
}
