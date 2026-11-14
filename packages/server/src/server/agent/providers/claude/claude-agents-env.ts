import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

// CUSTOM(delegation-implementer-agent): the delegation plugin puts a JSON object of agent
// definitions in this launch env var; the Claude session merges it into the SDK's `agents` option.
export const CLAUDE_AGENTS_ENV = "PASEO_CLAUDE_AGENTS";

/** Entries may carry fields the SDK type lacks (`omitClaudeMd`); the SDK forwards them untouched. */
export type ClaudeAgentDefinition = AgentDefinition & { omitClaudeMd?: boolean };

function isAgentDefinition(value: unknown): value is ClaudeAgentDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.description === "string" && typeof entry.prompt === "string";
}

/** The agents in the env var, or null when it is missing, malformed or has an invalid entry. */
export function parseClaudeAgentsEnv(
  env: Record<string, string> | undefined,
): Record<string, ClaudeAgentDefinition> | null {
  const raw = env?.[CLAUDE_AGENTS_ENV];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.every(([, value]) => isAgentDefinition(value))) return null;
    return Object.fromEntries(entries) as Record<string, ClaudeAgentDefinition>;
  } catch {
    return null;
  }
}
