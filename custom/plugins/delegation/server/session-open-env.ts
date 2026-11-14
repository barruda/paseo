// Server only. Pure part of the `agent.session_open` hook: the env every session gets from the
// settings, apart from the CLAUDE.md trimming (which reads the disk).
import type { DelegationSettings } from "@getpaseo/protocol/delegation";
import { CLAUDE_AGENTS_ENV, buildClaudeAgentsEnv } from "./implementer-agent";

/** Claude Code: prompt-cache TTL of everything outside the main conversation (Agent-tool subagents, helpers). */
export const CLAUDE_SUBAGENT_CACHE_TTL_ENV = "CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL";
/** Claude Code: prompt-cache TTL of the main conversation (a subscription defaults to 1h). */
export const CLAUDE_MAIN_CACHE_TTL_ENV = "CLAUDE_CODE_PROMPT_CACHE_TTL";

type SessionValues = Pick<
  DelegationSettings,
  "implementerModel" | "implementerEffort" | "subagentContext" | "searchModel" | "subagentCacheTtl"
>;

/**
 * Claude sessions get the agent definitions and the TTL for their own subagents. A Claude session
 * that is itself a Paseo subagent also gets the TTL for its main conversation. Other providers
 * cache automatically and have no TTL knob.
 */
export function sessionOpenEnv(input: {
  provider: string;
  isSubagent: boolean;
  values: SessionValues;
}): Record<string, string> {
  const { provider, isSubagent, values } = input;
  if (provider !== "claude") return {};
  return {
    [CLAUDE_AGENTS_ENV]: buildClaudeAgentsEnv(values),
    [CLAUDE_SUBAGENT_CACHE_TTL_ENV]: values.subagentCacheTtl,
    ...(isSubagent ? { [CLAUDE_MAIN_CACHE_TTL_ENV]: values.subagentCacheTtl } : {}),
  };
}
