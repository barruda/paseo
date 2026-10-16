import { createReadStream, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Logger } from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import { claudeConfigDir, claudeTranscriptPathSync } from "./agent/providers/claude/project-dir.js";
import {
  HistoryContentIndex,
  setActiveHistoryContentIndex,
  type HistoryMessage,
} from "./history-content-index.js";

// CUSTOM(history-content-search): fills the History content index. New turns are indexed from
// the daemon's timeline when they end; sessions from before the index existed are read once from
// the provider's own transcript files.

const TURN_END_EVENTS = new Set(["turn_completed", "turn_failed", "turn_canceled"]);
const INDEX_DEBOUNCE_MS = 2_000;
const BACKFILL_START_DELAY_MS = 30_000;

export interface HistoryContentIndexerOptions {
  index: HistoryContentIndex;
  agentManager: Pick<AgentManager, "subscribe" | "getTimelineRows">;
  listStoredAgents: () => Promise<StoredAgentRecord[]>;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
  backfillDelayMs?: number;
}

/**
 * Opens `$PASEO_HOME/history-search.db` and starts indexing. A failure to open leaves History
 * with name search only; it never stops the daemon. Returns a function that stops and closes.
 */
export function openHistoryContentIndexer(input: {
  paseoHome: string;
  agentManager: HistoryContentIndexerOptions["agentManager"];
  agentStorage: Pick<AgentStorage, "list">;
  logger: Logger;
}): () => void {
  let index: HistoryContentIndex;
  try {
    index = new HistoryContentIndex(path.join(input.paseoHome, "history-search.db"));
  } catch (err) {
    input.logger.warn({ err }, "history content index: failed to open; content search is off");
    return () => {};
  }
  setActiveHistoryContentIndex(index);
  const stop = startHistoryContentIndexer({
    index,
    agentManager: input.agentManager,
    listStoredAgents: () => input.agentStorage.list(),
    logger: input.logger,
  });
  return () => {
    stop();
    setActiveHistoryContentIndex(null);
    index.close();
  };
}

/** Starts indexing. Returns a function that stops it. */
export function startHistoryContentIndexer(options: HistoryContentIndexerOptions): () => void {
  const { index, agentManager, logger } = options;
  const pending = new Map<string, NodeJS.Timeout>();
  let stopped = false;

  async function indexTimeline(agentId: string): Promise<void> {
    const rows = await agentManager.getTimelineRows(agentId);
    index.addMessages(agentId, timelineMessages(rows));
  }

  const unsubscribe = agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_stream" || !TURN_END_EVENTS.has(event.event.type)) return;
      const { agentId } = event;
      clearTimeout(pending.get(agentId));
      pending.set(
        agentId,
        setTimeout(() => {
          pending.delete(agentId);
          indexTimeline(agentId).catch((err) => {
            logger.warn({ err, agentId }, "history content index: failed to index turn");
          });
        }, INDEX_DEBOUNCE_MS),
      );
    },
    { replayState: false },
  );

  async function backfill(): Promise<void> {
    const count = await backfillHistoryContent({
      index,
      records: options.listStoredAgents,
      env: options.env ?? process.env,
      isStopped: () => stopped,
    });
    if (count > 0) logger.info({ count }, "history content index: backfilled sessions");
  }

  const backfillTimer = setTimeout(() => {
    backfill().catch((err) => logger.warn({ err }, "history content index: backfill failed"));
  }, options.backfillDelayMs ?? BACKFILL_START_DELAY_MS);

  return () => {
    stopped = true;
    unsubscribe();
    clearTimeout(backfillTimer);
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
}

function timelineMessages(
  rows: readonly { timestamp: string; item: { type: string; text?: string } }[],
): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (const row of rows) {
    const { item } = row;
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    if (!item.text) continue;
    messages.push({
      role: item.type === "user_message" ? "user" : "assistant",
      text: item.text,
      timestamp: row.timestamp,
    });
  }
  return messages;
}

/**
 * Indexes each stored session not backfilled yet from its transcript file. Sessions whose file
 * is missing are marked too, so a daemon start never rescans them. Returns how many sessions
 * were read.
 */
export async function backfillHistoryContent(input: {
  index: HistoryContentIndex;
  records: () => Promise<StoredAgentRecord[]>;
  env: NodeJS.ProcessEnv;
  isStopped?: () => boolean;
}): Promise<number> {
  const done = input.index.backfilledAgentIds();
  const records = (await input.records()).filter((record) => !done.has(record.id));
  let codexRollouts: Map<string, string> | null = null;
  let count = 0;
  for (const record of records) {
    if (input.isStopped?.()) break;
    const sessionId = record.persistence?.sessionId;
    let file: string | null = null;
    let format: TranscriptFormat | null = null;
    if (sessionId && record.provider === "claude") {
      file = claudeTranscriptPathSync({
        cwd: record.cwd,
        sessionId,
        configDir: claudeConfigDir(input.env),
      });
      format = CLAUDE_TRANSCRIPT;
    } else if (sessionId && record.provider === "codex") {
      codexRollouts ??= listCodexRollouts(input.env);
      file = codexRollouts.get(sessionId) ?? null;
      format = CODEX_ROLLOUT;
    }
    if (file && format && existsSync(file)) {
      input.index.addMessages(record.id, await readTranscript(file, format));
      count += 1;
    }
    input.index.markBackfilled(record.id);
  }
  return count;
}

interface TranscriptFormat {
  /** Cheap check run before JSON.parse. Tool output is most of a transcript's bytes. */
  mayHoldMessage: (line: string) => boolean;
  parse: (line: unknown) => HistoryMessage | null;
}

const CLAUDE_TRANSCRIPT: TranscriptFormat = {
  mayHoldMessage: (line) =>
    !line.includes('"type":"tool_result"') && !line.includes('"type":"tool_use"'),
  parse: (line) => parseClaudeTranscriptLine(line),
};

const CODEX_ROLLOUT: TranscriptFormat = {
  mayHoldMessage: (line) => line.includes('"type":"message"'),
  parse: (line) => parseCodexRolloutLine(line),
};

async function readTranscript(file: string, format: TranscriptFormat): Promise<HistoryMessage[]> {
  const messages: HistoryMessage[] = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || !format.mayHoldMessage(line)) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const message = format.parse(value);
    if (message) messages.push(message);
  }
  return messages;
}

/** Injected context, command echoes and notifications are tagged blocks; people never write those. */
function isInjectedText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("<") || trimmed.startsWith("# AGENTS.md");
}

function textBlocks(content: unknown, blockType: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        block.type === blockType &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export function parseClaudeTranscriptLine(line: unknown): HistoryMessage | null {
  if (typeof line !== "object" || line === null) return null;
  const entry = line as {
    type?: string;
    isMeta?: boolean;
    isSidechain?: boolean;
    timestamp?: string;
    message?: { content?: unknown };
  };
  if (entry.isMeta || entry.isSidechain) return null;
  if (entry.type !== "user" && entry.type !== "assistant") return null;
  const text = textBlocks(entry.message?.content, "text");
  if (!text.trim() || isInjectedText(text)) return null;
  return { role: entry.type, text, timestamp: entry.timestamp };
}

export function parseCodexRolloutLine(line: unknown): HistoryMessage | null {
  if (typeof line !== "object" || line === null) return null;
  const entry = line as {
    type?: string;
    timestamp?: string;
    payload?: { type?: string; role?: string; content?: unknown };
  };
  if (entry.type !== "response_item" || entry.payload?.type !== "message") return null;
  const { role, content } = entry.payload;
  if (role !== "user" && role !== "assistant") return null;
  const text = textBlocks(content, role === "user" ? "input_text" : "output_text");
  if (!text.trim() || isInjectedText(text)) return null;
  return { role, text, timestamp: entry.timestamp };
}

/** Thread id -> rollout file, across live and archived Codex sessions. */
function listCodexRollouts(env: NodeJS.ProcessEnv): Map<string, string> {
  const home = env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const rollouts = new Map<string, string>();
  const pattern =
    /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
  for (const root of [path.join(home, "sessions"), path.join(home, "archived_sessions")]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = pattern.exec(entry.name);
      if (match) rollouts.set(match[1], path.join(entry.parentPath, entry.name));
    }
  }
  return rollouts;
}
