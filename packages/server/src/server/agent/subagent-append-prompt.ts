import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { composeSystemPromptParts } from "./system-prompt.js";

// CUSTOM(delegation-subagent-instructions): the `delegation` plugin's `agent.session_open` hook puts
// the "Additional instructions" for Paseo subagents in this env var. The daemon append is applied
// before that hook runs, so the text is folded into the launch config afterwards. Launch config
// only: the stored config is what gets saved.
export const SUBAGENT_APPEND_PROMPT_ENV = "PASEO_SUBAGENT_APPEND_PROMPT";

export function withSubagentAppendPrompt(
  config: AgentSessionConfig,
  env: Record<string, string> | undefined,
): AgentSessionConfig {
  const extra = env?.[SUBAGENT_APPEND_PROMPT_ENV]?.trim();
  if (!extra) return config;
  const daemonAppendSystemPrompt = composeSystemPromptParts(config.daemonAppendSystemPrompt, extra);
  return { ...config, daemonAppendSystemPrompt };
}
