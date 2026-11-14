// Server only, like claude-md-excludes.ts.
import type { DelegationSettings } from "@getpaseo/protocol/delegation";
import { IMPLEMENTER_AGENT_NAME, SEARCH_AGENT_NAME } from "../shared/policy";

/** Env var the plugin sets on Claude sessions; same name as the constant in the Claude provider. */
export const CLAUDE_AGENTS_ENV = "PASEO_CLAUDE_AGENTS";

type ImplementerValues = Pick<
  DelegationSettings,
  "implementerModel" | "implementerEffort" | "subagentContext"
>;

type SearchValues = Pick<DelegationSettings, "searchModel">;

const BASE_PROMPT =
  "You implement one code change for the session that started you. The brief is your whole context: it holds the goal, the plan, the files to change, what to leave alone, the acceptance criteria and the commands that verify the work. Stay inside it. If the plan cannot work as written, stop and report why instead of redesigning it. Your shell's working directory resets between Bash calls, so use absolute paths. Run the verify commands from the brief before you finish. End with the files you changed, each command you ran and its result, and any departure from the plan.";

const PROJECT_DOCS_SENTENCE =
  " Before editing, read CLAUDE.md and AGENTS.md at the repository root (`git rev-parse --show-toplevel`) if they exist, and follow them.";

/**
 * The lean agent the delegation rule points at. `omitClaudeMd` is a Claude Code agent-definition
 * field the SDK forwards untouched, although its `AgentDefinition` type lacks it.
 */
export function buildImplementerAgent(values: ImplementerValues) {
  return {
    description:
      "Implements one approved, self-contained code change from a complete brief (goal, files, acceptance criteria, verify commands). Use for delegated implementation work.",
    prompt:
      values.subagentContext === "project" ? BASE_PROMPT + PROJECT_DOCS_SENTENCE : BASE_PROMPT,
    tools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
    model: values.implementerModel,
    effort: values.implementerEffort,
    ...(values.subagentContext === "full" ? {} : { omitClaudeMd: true }),
  };
}

const SEARCH_PROMPT =
  "You search a codebase for the session that started you and report what you found. You never change anything: no edits, no writes, and only read-only shell commands (rg, grep, find, ls, cat, sed -n, git log/show/diff/grep). Search as wide as the brief asks, read excerpts rather than whole large files, and stop once you can answer. End with the answer first, then the absolute file paths (with line numbers) that support it.";

/**
 * The lean read-only search agent. Defined on every Claude session, also when the Search setting is
 * off: a resumed session may still carry the "Search:" line in its system prompt.
 */
export function buildSearchAgent(values: Pick<DelegationSettings, "searchModel">) {
  return {
    description:
      "Read-only search across the codebase when only the conclusion is needed: finds files, symbols, usages and conventions, and reports where they are.",
    prompt: SEARCH_PROMPT,
    tools: ["Bash", "Read", "Glob", "Grep"],
    model: values.searchModel === "off" ? "haiku" : values.searchModel,
    omitClaudeMd: true,
  };
}

export function buildClaudeAgentsEnv(values: ImplementerValues & SearchValues): string {
  return JSON.stringify({
    [IMPLEMENTER_AGENT_NAME]: buildImplementerAgent(values),
    [SEARCH_AGENT_NAME]: buildSearchAgent(values),
  });
}
