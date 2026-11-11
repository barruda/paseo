import { z } from "zod";

// CUSTOM(delegation): shared by the `delegation` plugin (custom/plugins/delegation) and the app's
// composer icon and sheet (packages/app/src/delegation). When it is on, a new Claude session on an
// Opus or Fable model gets a rule in its system prompt: plan, decide and review in the session, and
// hand implementation to a cheaper subagent through Claude Code's Agent tool.

export const DELEGATION_PLUGIN_ID = "delegation";
export const DELEGATION_SETTINGS_ID = "delegation";

/** Claude Code's Agent tool takes model aliases only. */
export const DELEGATION_MODELS = ["sonnet", "opus", "haiku"] as const;
export type DelegationModel = (typeof DELEGATION_MODELS)[number];

export const DELEGATION_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type DelegationEffort = (typeof DELEGATION_EFFORTS)[number];

/**
 * Conservative: only an approved plan touching several files. Balanced: any multi-file change once
 * the approach is settled. Aggressive: every code change except a one-edit fix.
 */
export const DELEGATION_WHEN = ["conservative", "balanced", "aggressive"] as const;
export type DelegationWhen = (typeof DELEGATION_WHEN)[number];

/** The model broad searches go to through the Explore agent, or `off` to leave search alone. */
export const DELEGATION_SEARCH = ["off", "haiku", "sonnet"] as const;
export type DelegationSearch = (typeof DELEGATION_SEARCH)[number];

export const DEFAULT_DELEGATION = {
  enabled: false,
  implementerModel: "sonnet",
  implementerEffort: "medium",
  when: "balanced",
  review: true,
  searchModel: "off",
  extraInstructions: "",
} as const;

export const MAX_DELEGATION_EXTRA_CHARS = 4000;

export const DelegationSettingsSchema = z.object({
  /** New Opus/Fable Claude sessions get the rule. Sessions already open keep what they had. */
  enabled: z.boolean().default(DEFAULT_DELEGATION.enabled),
  implementerModel: z.enum(DELEGATION_MODELS).default(DEFAULT_DELEGATION.implementerModel),
  implementerEffort: z.enum(DELEGATION_EFFORTS).default(DEFAULT_DELEGATION.implementerEffort),
  when: z.enum(DELEGATION_WHEN).default(DEFAULT_DELEGATION.when),
  /** The session reads the diff, reruns the checks and sends fixes back to the same subagent. */
  review: z.boolean().default(DEFAULT_DELEGATION.review),
  searchModel: z.enum(DELEGATION_SEARCH).default(DEFAULT_DELEGATION.searchModel),
  /** Appended to the rule as written. */
  extraInstructions: z
    .string()
    .max(MAX_DELEGATION_EXTRA_CHARS)
    .default(DEFAULT_DELEGATION.extraInstructions),
});
export type DelegationSettings = z.infer<typeof DelegationSettingsSchema>;

/** The card the plugin appends to a session that started with the rule. */
export const DELEGATION_TIMELINE_KIND = "delegation-policy";
export const DELEGATION_TIMELINE_VERSION = 1;

export const DelegationCardDataSchema = z.object({
  implementerModel: z.enum(DELEGATION_MODELS),
  implementerEffort: z.enum(DELEGATION_EFFORTS),
  when: z.enum(DELEGATION_WHEN),
  review: z.boolean(),
  searchModel: z.enum(DELEGATION_SEARCH),
});
export type DelegationCardData = z.infer<typeof DelegationCardDataSchema>;

const MODEL_NAMES: Record<DelegationModel, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

export function formatDelegationModel(model: DelegationModel | DelegationSearch): string {
  return model === "off" ? "off" : MODEL_NAMES[model];
}

export const DELEGATION_WHEN_LABELS: Record<DelegationWhen, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};
