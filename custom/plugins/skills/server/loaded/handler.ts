// CUSTOM(skills-loaded): the `skills.loaded` RPC. Reads the agent's own session file, or the
// newest session of the same project when the agent has none yet.

import os from "node:os";
import path from "node:path";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { applyClaudeLine, createClaudeState, type ClaudeContextState } from "./claude.ts";
import { extractSkillsText, parseCodexMcpConfig, parseCodexSkills, type CodexSkill } from "./codex.ts";
import {
  buildSkillRows,
  categorizeClaudeSkill,
  categorizeCodexSkill,
  summarizeClaudeMcp,
  summarizeCodexMcp,
  type LoadedMcpServer,
  type LoadedSkill,
} from "./report.ts";
import {
  claudeActiveConfigDir,
  claudeConfigDirs,
  claudeProjectTranscripts,
  codexHomeDir,
  codexRolloutsForCwd,
  findClaudeTranscript,
  findCodexRollout,
  forEachLine,
  readCodexConfig,
  userSkillNames,
  type SessionFile,
} from "./sources.ts";

export interface LoadedResult {
  provider: string;
  source: "session" | "last-session" | "none" | "unsupported";
  sessionFile: string | null;
  sessionDate: string | null;
  skills: LoadedSkill[];
  mcpServers: LoadedMcpServer[];
  mcpSource: "session" | "config" | "none";
}

export interface LoadedEnvironment {
  env: NodeJS.ProcessEnv;
  home: string;
}

interface AgentInfo {
  provider: string;
  cwd: string;
  sessionId: string | null;
}

async function loadAgent(agentId: string, context: PluginHandlerContext): Promise<AgentInfo> {
  const handle = context.paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  const agent = refreshed?.agent ?? handle.current();
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const sessionId = agent.persistence?.sessionId ?? agent.runtimeInfo?.sessionId ?? null;
  return { provider: agent.provider, cwd: agent.cwd, sessionId };
}

/**
 * Session files only grow, and a Codex rollout can pass 200 MB, so each parse is kept until the
 * file's size or mtime changes. Bounded: one entry per file and mode, oldest dropped first.
 */
const CACHE_LIMIT = 32;
const cache = new Map<string, { size: number; mtimeMs: number; value: unknown }>();

async function cached<T>(file: SessionFile, mode: string, parse: () => Promise<T>): Promise<T> {
  const key = `${mode}:${file.path}`;
  const hit = cache.get(key);
  if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) return hit.value as T;
  const value = await parse();
  cache.delete(key);
  cache.set(key, { size: file.size, mtimeMs: file.mtimeMs, value });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return value;
}

function readClaudeState(file: SessionFile, includeToolSearch: boolean): Promise<ClaudeContextState> {
  return cached(file, `claude:${includeToolSearch}`, async () => {
    const state = createClaudeState();
    await forEachLine(file.path, (line) => applyClaudeLine(state, line, { includeToolSearch }));
    return state;
  });
}

/** The last skill list in the rollout is the one in context now. */
function readCodexSkills(file: SessionFile): Promise<CodexSkill[] | null> {
  return cached(file, "codex", async () => {
    let text: string | null = null;
    await forEachLine(file.path, (line) => {
      text = extractSkillsText(line) ?? text;
    });
    return text === null ? null : parseCodexSkills(text);
  });
}

function empty(provider: string, source: LoadedResult["source"]): LoadedResult {
  return { provider, source, sessionFile: null, sessionDate: null, skills: [], mcpServers: [], mcpSource: "none" };
}

async function loadClaude(agent: AgentInfo, environment: LoadedEnvironment): Promise<LoadedResult> {
  const { env, home } = environment;
  let file: SessionFile | null = null;
  let state: ClaudeContextState | null = null;
  let source: LoadedResult["source"] = "session";

  if (agent.sessionId) {
    file = await findClaudeTranscript({
      sessionId: agent.sessionId,
      cwd: agent.cwd,
      configDirs: claudeConfigDirs(env, home),
    });
    if (file) state = await readClaudeState(file, true);
  }
  if (!state) {
    // A new session loads what the last one in this project started with. Tools that session
    // loaded with ToolSearch are left out: a new session starts without them.
    source = "last-session";
    const candidates = await claudeProjectTranscripts({
      cwd: agent.cwd,
      configDir: claudeActiveConfigDir(env, home),
    });
    for (const candidate of candidates.slice(0, 5)) {
      const parsed = await readClaudeState(candidate, false);
      if (parsed.sawSkillListing || parsed.sawToolDelta) {
        file = candidate;
        state = parsed;
        break;
      }
    }
  }
  if (!state || !file) return empty(agent.provider, "none");

  // The config folder is three levels up from `<config>/projects/<project>/<id>.jsonl`.
  const configDir = path.dirname(path.dirname(path.dirname(file.path)));
  const customNames = await userSkillNames({ cwd: agent.cwd, configDir, home });
  const skills = buildSkillRows(
    [...state.skills.values()].map((skill) => ({
      ...skill,
      category: categorizeClaudeSkill(skill.name, customNames),
    })),
  );
  return {
    provider: agent.provider,
    source,
    sessionFile: file.path,
    sessionDate: new Date(file.mtimeMs).toISOString(),
    skills,
    mcpServers: summarizeClaudeMcp(state),
    mcpSource: "session",
  };
}

async function loadCodex(agent: AgentInfo, environment: LoadedEnvironment): Promise<LoadedResult> {
  const codexHome = codexHomeDir(environment.env, environment.home);
  let file: SessionFile | null = null;
  let skills: CodexSkill[] | null = null;
  let source: LoadedResult["source"] = "session";

  if (agent.sessionId) {
    file = await findCodexRollout({ sessionId: agent.sessionId, codexHome });
    if (file) skills = await readCodexSkills(file);
  }
  if (!skills) {
    source = "last-session";
    file = null;
    for (const candidate of await codexRolloutsForCwd({ cwd: agent.cwd, codexHome })) {
      const parsed = await readCodexSkills(candidate);
      if (parsed) {
        file = candidate;
        skills = parsed;
        break;
      }
    }
  }

  const servers = parseCodexMcpConfig(await readCodexConfig(codexHome));
  const mcp = {
    mcpServers: summarizeCodexMcp(servers),
    mcpSource: servers.length > 0 ? ("config" as const) : ("none" as const),
  };
  if (!skills || !file) return { ...empty(agent.provider, "none"), ...mcp };

  return {
    provider: agent.provider,
    source,
    sessionFile: file.path,
    sessionDate: new Date(file.mtimeMs).toISOString(),
    skills: buildSkillRows(
      skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        category: categorizeCodexSkill(skill, codexHome),
      })),
    ),
    ...mcp,
  };
}

export function loadForAgent(agent: AgentInfo, environment: LoadedEnvironment): Promise<LoadedResult> {
  if (agent.provider === "claude") return loadClaude(agent, environment);
  if (agent.provider === "codex") return loadCodex(agent, environment);
  return Promise.resolve(empty(agent.provider, "unsupported"));
}

export function createLoadedSkillsHandler(
  environment: LoadedEnvironment = { env: process.env, home: os.homedir() },
) {
  return async (input: { agentId: string }, context: PluginHandlerContext): Promise<LoadedResult> => {
    const agent = await loadAgent(input.agentId, context);
    return loadForAgent(agent, environment);
  };
}
