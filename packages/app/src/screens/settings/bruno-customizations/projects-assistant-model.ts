// CUSTOM(projects-assistant): the Projects Assistant settings as the Settings page edits them.
// The schemas mirror custom/plugins/power-workboard/shared/assistant.ts (not imported: core does
// not depend on plugin code); keep them in step with it.
import { z } from "zod";

export const ASSISTANT_ACTIONS = ["merge", "prepare-pr", "notify", "nothing"] as const;
export const ASSISTANT_DEFAULT_ACTIONS = ["prepare-pr", "notify", "nothing"] as const;

const actionSchema = z.enum(ASSISTANT_ACTIONS);
const defaultActionSchema = z.enum(ASSISTANT_DEFAULT_ACTIONS);

export const projectPolicySchema = z.object({
  action: actionSchema.default("notify"),
  observe: z.boolean().default(false),
  verifyCommand: z.string().max(2000).default(""),
  autoFixes: z.number().int().min(0).max(3).default(1),
  baseBranch: z.string().max(200).default(""),
});
export type ProjectPolicy = z.infer<typeof projectPolicySchema>;

export const assistantChatSettingsSchema = z.object({
  /** `provider/model`. */
  provider: z.string().trim().min(3).default("claude/claude-opus-5-5"),
  thinkingOptionId: z.string().trim().min(1).nullable().default("high"),
  modeId: z.string().trim().min(1).nullable().default("bypassPermissions"),
});
export type AssistantChatSettings = z.infer<typeof assistantChatSettingsSchema>;

export const assistantSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultAction: defaultActionSchema.default("notify"),
  projects: z.record(z.string(), projectPolicySchema).default({}),
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
  merge: "Merge",
  "prepare-pr": "Prepare PR",
  notify: "Tell me",
  nothing: "Nothing",
};

export const MAX_AUTO_FIXES = 3;

export function actionNeedsGit(action: AssistantAction): boolean {
  return action === "merge" || action === "prepare-pr";
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

/** Empty thinking/mode means the provider's default (null); an empty model keeps the saved one. */
export function patchChatSettings(
  settings: AssistantSettings,
  patch: { provider?: string; thinkingOptionId?: string; modeId?: string },
): AssistantSettings {
  const chat = { ...settings.chat };
  if (patch.provider !== undefined) chat.provider = patch.provider.trim();
  if (patch.thinkingOptionId !== undefined)
    chat.thinkingOptionId = patch.thinkingOptionId.trim() || null;
  if (patch.modeId !== undefined) chat.modeId = patch.modeId.trim() || null;
  return { ...settings, chat };
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
