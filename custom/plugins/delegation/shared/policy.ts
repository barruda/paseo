import type {
  DelegationCardData,
  DelegationSettings,
  DelegationWhen,
} from "@getpaseo/protocol/delegation";

// The rule a new Opus/Fable Claude session gets in its system prompt while delegation is on. It is
// written once, at creation: changing the system prompt of a running session would throw its
// whole prompt cache away, so a session keeps the rule (or its absence) for its whole life.

/** First line of the rule; also how a config that already has it is recognized. */
export const DELEGATION_MARKER = "# Delegating implementation (Paseo delegation)";

/** Passed to the session's first launch, so `agent.session_open` can tie the rule to an agent id. */
export const DELEGATION_ENV = "PASEO_DELEGATION_ID";

const WHEN_RULES: Record<DelegationWhen, string> = {
  conservative:
    "Delegate only after the user approved a plan, and only a change that touches three or more files or needs more than about ten edits.",
  balanced:
    "Once the approach is settled (an approved plan, or a fix whose cause you already found), delegate any change that touches more than one file or needs more than a few edits.",
  aggressive:
    "Delegate every code change except a one-line or single-edit fix you can make right away.",
};

export interface DelegationConfigInput {
  provider: string;
  model?: string;
  systemPrompt?: string;
}

/** Only Claude sessions on a model costlier than the implementer gain from delegating. */
export function isDelegationEligible(config: DelegationConfigInput): boolean {
  if (config.provider !== "claude") return false;
  if (config.systemPrompt?.includes(DELEGATION_MARKER)) return false;
  const model = config.model?.trim().toLowerCase() ?? "";
  // No model means the provider default, which is Opus in this setup.
  return model === "" || /opus|fable|mythos/.test(model);
}

export function buildDelegationPolicy(settings: DelegationSettings): string {
  const { implementerModel: model, implementerEffort: effort } = settings;
  const lines = [
    DELEGATION_MARKER,
    "",
    "You plan, decide and review. A cheaper subagent writes the code. Your model costs more per token, and every file you read and every tool result stays in your context and is paid again on each later turn, so hand implementation work to a subagent when the rule below says so.",
    "",
    `When to delegate: ${WHEN_RULES[settings.when]}`,
    "",
    "Keep in this session: design and architecture decisions, protocol, security, concurrency and migration work, debugging whose cause you have not found yet, and small edits you already know exactly.",
    "",
    `How to delegate: call the Agent tool with subagent_type "general-purpose", model "${model}" and effort "${effort}". The subagent cannot see this conversation, so the brief must stand alone: the goal, the approved plan, the files to change, what to leave alone, acceptance criteria, and the exact commands that verify the work (typecheck, lint, targeted tests). Ask it to end with the files it changed, the commands it ran and their results, and any departure from the plan. Independent pieces that touch different files can go to parallel subagents.`,
  ];
  if (settings.review) {
    lines.push(
      "",
      "Review: when the subagent finishes, read the diff yourself, rerun the checks, and send fixes back to the same subagent with SendMessage instead of starting a new one. Make a fix yourself only when it is smaller than the message describing it.",
    );
  }
  if (settings.searchModel !== "off") {
    lines.push(
      "",
      `Search: for a broad search across many files where you only need the conclusion, use the Agent tool with subagent_type "Explore" and model "${settings.searchModel}".`,
    );
  }
  const subagentText = settings.subagentInstructions.trim();
  if (subagentText) {
    lines.push(
      "",
      `Subagent instructions: end the prompt of every subagent you start with the Agent tool with the following text, quoted verbatim:\n${subagentText}`,
    );
  }
  const extra = settings.extraInstructions.trim();
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

/** The session's own system prompt, if any, then the rule. */
export function withDelegationPolicy(systemPrompt: string | undefined, policy: string): string {
  const own = systemPrompt?.trim();
  return own ? `${own}\n\n${policy}` : policy;
}

export function delegationCardData(settings: DelegationSettings): DelegationCardData {
  return {
    implementerModel: settings.implementerModel,
    implementerEffort: settings.implementerEffort,
    when: settings.when,
    review: settings.review,
    searchModel: settings.searchModel,
  };
}
