import { z } from "zod";

// CUSTOM(critic): a second LLM reviews each answer of an agent before the user reads it. The
// `critic` plugin (custom/plugins/critic) runs the loop; the app's composer toggle edits the
// config and hides rejected rounds; the daemon holds the "finished" notification until the
// critic settles. Shared here so the three agree on markers, labels and row shapes.

export const CRITIC_PLUGIN_ID = "critic";
export const CRITIC_TIMELINE_KIND = "critic-review";
export const CRITIC_TIMELINE_VERSION = 1;

/** On the reviewed agent while the critic is on: the daemon then leaves "finished" to the critic. */
export const CRITIC_ENABLED_LABEL = "custom.critic.enabled";
/** On every critic agent: it never notifies and never gets a critic of its own. */
export const CRITIC_ROLE_LABEL = "custom.critic.role";
export const CRITIC_ROLE_VALUE = "critic";

export function isCriticEnabledLabels(labels: Readonly<Record<string, string>>): boolean {
  return labels[CRITIC_ENABLED_LABEL] === "true";
}

export function isCriticAgentLabels(labels: Readonly<Record<string, string>>): boolean {
  return labels[CRITIC_ROLE_LABEL] === CRITIC_ROLE_VALUE;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const CriticImageSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  /** Base64, no data: prefix. */
  data: z.string(),
});
export type CriticImage = z.infer<typeof CriticImageSchema>;

export const CriticConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingOptionId: z.string().nullable(),
  prompt: z.string(),
  images: z.array(CriticImageSchema),
  /** per-request: a fresh critic for each user message. persistent: one for the whole chat. */
  mode: z.enum(["per-request", "persistent"]),
  /** off: judges only what the prompt carries. read: may read and search the repository. */
  tools: z.enum(["off", "read"]),
  includeDiff: z.boolean(),
  maxRounds: z.number().int().min(1).max(10),
});
export type CriticConfig = z.infer<typeof CriticConfigSchema>;
export type CriticMode = CriticConfig["mode"];
export type CriticTools = CriticConfig["tools"];

export const DEFAULT_CRITIC_CONFIG: CriticConfig = {
  enabled: false,
  provider: "claude",
  model: "claude-sonnet-5-5",
  thinkingOptionId: null,
  prompt: "",
  images: [],
  mode: "per-request",
  tools: "off",
  includeDiff: true,
  maxRounds: 3,
};

/** Plugin RPC names (`client.invokePluginRpc(CRITIC_PLUGIN_ID, name, input)`). */
export const CRITIC_RPC = {
  getConfig: "config.get",
  setConfig: "config.set",
} as const;

export const CriticGetConfigInputSchema = z.object({ agentId: z.string().min(1) });
export const CriticGetConfigOutputSchema = z.object({
  config: CriticConfigSchema,
  /** True when the agent has no config of its own yet and this is the saved default. */
  isDefault: z.boolean(),
});
export const CriticSetConfigInputSchema = z.object({
  agentId: z.string().min(1),
  config: CriticConfigSchema,
  /** Also make this config (minus `enabled`) the default for agents without one. */
  saveAsDefault: z.boolean(),
});
export const CriticSetConfigOutputSchema = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// Timeline rows
// ---------------------------------------------------------------------------

export const CriticReviewStatusSchema = z.enum([
  /** The critic is reading the answer. */
  "reviewing",
  "approved",
  /** Feedback went back to the agent; another round follows. */
  "rejected",
  /** Rejected on the last allowed round: the answer goes to the user as it is. */
  "limit",
  /** The agent stopped to ask the user something. */
  "question",
  /** The agent is waiting on background work and will go on by itself. */
  "waiting",
  /** The verdict depends on something the critic could not see: the user has to check it. */
  "unverified",
  "failed",
  /** The user sent a message or turned the critic off while it ran. */
  "canceled",
]);
export type CriticReviewStatus = z.infer<typeof CriticReviewStatusSchema>;

export const CriticReviewDataSchema = z.object({
  round: z.number().int().min(1),
  maxRounds: z.number().int().min(1),
  status: CriticReviewStatusSchema,
  /** The agent's answer the critic read (cut to fit the row). */
  answer: z.string(),
  feedback: z.string().nullable(),
  error: z.string().nullable(),
  criticAgentId: z.string().nullable(),
  /** "provider/model", for the card. */
  model: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
});
export type CriticReviewData = z.infer<typeof CriticReviewDataSchema>;

/** The chat hides the agent's answer while the critic reads it and after it rejects it. */
export function criticStatusHidesAnswer(status: CriticReviewStatus): boolean {
  return status === "reviewing" || status === "rejected";
}

/** Statuses that end the loop with something for the user to read. */
export function criticStatusNotifies(status: CriticReviewStatus): boolean {
  return (
    status === "approved" ||
    status === "limit" ||
    status === "question" ||
    status === "unverified" ||
    status === "failed"
  );
}

// ---------------------------------------------------------------------------
// Messages to the reviewed agent
// ---------------------------------------------------------------------------

const NOTICE_OPEN = "<critic-notice>";
const NOTICE_CLOSE = "</critic-notice>";
const FEEDBACK_PATTERN = /^\s*<critic-feedback round="(\d+)">/;

const NOTICE_ON =
  "From this message on, a reviewer (another model) reads each of your answers before the user does. End every turn with a complete report: what you changed, how you checked it, and what you left out. If the reviewer rejects an answer, its review reaches you in a <critic-feedback> message: fix what it points out and answer again with the full report. The reviewer receives the images your answer links to if the files exist when your turn ends: keep screenshots in place and link each one by its real path.";
const NOTICE_OFF =
  "The reviewer is off from this message on: your answers go straight to the user again.";

/** Goes in front of the user's next message after the critic is turned on or off. */
export function buildCriticNotice(enabled: boolean): string {
  return `${NOTICE_OPEN}\n${enabled ? NOTICE_ON : NOTICE_OFF}\n${NOTICE_CLOSE}\n\n`;
}

/** The user's message without a leading critic notice. */
export function stripCriticNotice(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(NOTICE_OPEN)) return text;
  const end = trimmed.indexOf(NOTICE_CLOSE);
  if (end < 0) return text;
  return trimmed.slice(end + NOTICE_CLOSE.length).replace(/^\s+/, "");
}

export function buildCriticFeedbackMessage(input: { round: number; feedback: string }): string {
  return [
    `<critic-feedback round="${input.round}">`,
    "The reviewer read your last answer and did not approve it. The user sees your answer only after the reviewer approves it. Fix what it points out, then answer again with the full report.",
    "",
    input.feedback.trim(),
    "</critic-feedback>",
  ].join("\n");
}

/** The round a feedback message answers, or null when the text is not critic feedback. */
export function criticFeedbackRound(text: string): number | null {
  const match = FEEDBACK_PATTERN.exec(text);
  return match ? Number(match[1]) : null;
}

export function isCriticFeedbackMessage(text: string): boolean {
  return criticFeedbackRound(text) !== null;
}
