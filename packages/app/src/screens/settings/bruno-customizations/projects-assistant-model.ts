// CUSTOM(projects-assistant): the Projects Assistant settings as the Settings page edits them.
// The schemas mirror custom/plugins/power-workboard/shared/assistant.ts (not imported: core does
// not depend on plugin code); keep them in step with it.
import { z } from "zod";

// CUSTOM(assistant-autonomy): `review` (the assistant reviews, then merges) is the default action.
export const ASSISTANT_ACTIONS = ["review", "merge", "prepare-pr", "notify", "nothing"] as const;
export const ASSISTANT_DEFAULT_ACTIONS = ["review", "prepare-pr", "notify", "nothing"] as const;

const actionSchema = z.enum(ASSISTANT_ACTIONS);
const defaultActionSchema = z.enum(ASSISTANT_DEFAULT_ACTIONS);

export const projectPolicySchema = z.object({
  action: actionSchema.default("review"),
  observe: z.boolean().default(false),
  verifyCommand: z.string().max(2000).default(""),
  autoFixes: z.number().int().min(0).max(3).default(1),
  baseBranch: z.string().max(200).default(""),
});
export type ProjectPolicy = z.infer<typeof projectPolicySchema>;

// CUSTOM(assistant-review-policy): who reviews a project's finished task. A project without an
// entry is `self`. The plugin seeds DreamMMO and DreamMMO-android as `fresh-agent` when its stored
// settings have no `reviews`, so its responses always carry the field.
export const REVIEW_POLICIES = ["self", "fresh-agent"] as const;
const reviewPolicySchema = z.enum(REVIEW_POLICIES);
export type ReviewPolicy = z.infer<typeof reviewPolicySchema>;

// CUSTOM(agent-profiles): mirrors skillSelectionSchema in the plugin's shared/profiles.ts.
export const skillSelectionSchema = z.object({
  mode: z.enum(["all", "selected"]).default("all"),
  names: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
});

// CUSTOM(assistant-compact): the chat restarts with a summary once a turn leaves it this full.
export const DEFAULT_COMPACT_AT_TOKENS = 180_000;
const MAX_COMPACT_AT_TOKENS = 10_000_000;

export const assistantChatSettingsSchema = z.object({
  /** `provider/model`. */
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  thinkingOptionId: z.string().trim().min(1).nullable().default("high"),
  modeId: z.string().trim().min(1).nullable().default("bypassPermissions"),
  // CUSTOM(agent-profiles): edited in the plugin's Orchestrators tab; kept here so saving keeps them.
  skills: skillSelectionSchema.default(() => skillSelectionSchema.parse({})),
  memory: z.boolean().default(true),
  // CUSTOM(assistant-wake)
  wakeOnNeedsYou: z.boolean().default(true),
  // CUSTOM(assistant-compact): 0 turns it off.
  compactAtTokens: z
    .number()
    .int()
    .min(0)
    .max(MAX_COMPACT_AT_TOKENS)
    .default(DEFAULT_COMPACT_AT_TOKENS),
});
export type AssistantChatSettings = z.infer<typeof assistantChatSettingsSchema>;

export const assistantSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultAction: defaultActionSchema.default("review"),
  projects: z.record(z.string(), projectPolicySchema).default({}),
  reviews: z.record(z.string(), reviewPolicySchema).default({}),
  chat: assistantChatSettingsSchema.default(() => assistantChatSettingsSchema.parse({})),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
export type AssistantAction = z.infer<typeof actionSchema>;
export type AssistantDefaultAction = z.infer<typeof defaultActionSchema>;

export const assistantProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  isGit: z.boolean(),
});
export type AssistantProject = z.infer<typeof assistantProjectSchema>;

export const assistantSettingsResponseSchema = z.object({
  settings: assistantSettingsSchema,
  projects: z.array(assistantProjectSchema),
});
export type AssistantSettingsResponse = z.infer<typeof assistantSettingsResponseSchema>;

export const ACTION_LABELS: Record<AssistantAction, string> = {
  review: "Assistant reviews",
  merge: "Merge",
  "prepare-pr": "Prepare PR",
  notify: "Tell me",
  nothing: "Nothing",
};

export const REVIEW_LABELS: Record<ReviewPolicy, string> = {
  self: "The assistant",
  "fresh-agent": "A fresh agent",
};

export const MAX_AUTO_FIXES = 3;

export function actionNeedsGit(action: AssistantAction): boolean {
  // Review leads to merge-now, so it needs a git project and a base branch like merge does.
  return action === "review" || action === "merge" || action === "prepare-pr";
}

/** A project's own rule is only worth editing in detail when the assistant acts on the work. */
export function policyActs(policy: ProjectPolicy | undefined): policy is ProjectPolicy {
  return policy !== undefined && actionNeedsGit(policy.action);
}

/** Picking an action creates the project's rule; the other fields keep their values if it had one. */
export function setProjectAction(
  settings: AssistantSettings,
  projectId: string,
  action: AssistantAction,
): AssistantSettings {
  const current = settings.projects[projectId] ?? projectPolicySchema.parse({});
  return {
    ...settings,
    projects: { ...settings.projects, [projectId]: { ...current, action } },
  };
}

export function patchProjectPolicy(
  settings: AssistantSettings,
  projectId: string,
  patch: Partial<Omit<ProjectPolicy, "action">>,
): AssistantSettings {
  const current = settings.projects[projectId];
  if (!current) return settings;
  return {
    ...settings,
    projects: { ...settings.projects, [projectId]: { ...current, ...patch } },
  };
}

/** Removes the project's rule so it follows the default again. */
export function resetProjectPolicy(
  settings: AssistantSettings,
  projectId: string,
): AssistantSettings {
  if (!(projectId in settings.projects)) return settings;
  const projects = { ...settings.projects };
  delete projects[projectId];
  return { ...settings, projects };
}

export function projectReview(settings: AssistantSettings, projectId: string): ReviewPolicy {
  return settings.reviews[projectId] ?? "self";
}

/** Kept apart from the project's rule: setting the review never gives a project its own action. */
export function setProjectReview(
  settings: AssistantSettings,
  projectId: string,
  review: ReviewPolicy,
): AssistantSettings {
  const reviews = { ...settings.reviews };
  if (review === "self") delete reviews[projectId];
  else reviews[projectId] = review;
  return { ...settings, reviews };
}

/**
 * Empty thinking/mode means the provider's default (null); an empty model keeps the saved one.
 * CUSTOM(assistant-compact): the compaction limit is typed as text; empty is the default, and
 * anything that is not a whole number makes the settings invalid until it is fixed.
 */
export function patchChatSettings(
  settings: AssistantSettings,
  patch: {
    provider?: string;
    thinkingOptionId?: string;
    modeId?: string;
    compactAtTokens?: string;
  },
): AssistantSettings {
  const chat = { ...settings.chat };
  if (patch.provider !== undefined) chat.provider = patch.provider.trim();
  if (patch.thinkingOptionId !== undefined)
    chat.thinkingOptionId = patch.thinkingOptionId.trim() || null;
  if (patch.modeId !== undefined) chat.modeId = patch.modeId.trim() || null;
  if (patch.compactAtTokens !== undefined)
    chat.compactAtTokens = parseTokens(patch.compactAtTokens);
  return { ...settings, chat };
}

/** "180000", "180,000" or "180_000"; NaN when it is not a whole number. */
function parseTokens(text: string): number {
  const digits = text.replace(/[\s_,.]/g, "");
  if (!digits) return DEFAULT_COMPACT_AT_TOKENS;
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

export function chatSettingsValid(settings: AssistantSettings): boolean {
  return assistantChatSettingsSchema.safeParse(settings.chat).success;
}

export function clampAutoFixes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_AUTO_FIXES, Math.max(0, Math.round(value)));
}

export function settingsEqual(a: AssistantSettings, b: AssistantSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
