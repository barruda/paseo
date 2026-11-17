// CUSTOM(agent-profiles): a profile is the system prompt, skills and memory of an orchestrator or
// of the Projects Assistant chat. Settings live in the board store (see `skillSelectionSchema`
// in the two settings schemas); the content lives in a Claude Code plugin folder per profile.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Which skills a profile's Claude agent may see. "all" is Claude's own default. */
export const skillSelectionSchema = z.object({
  mode: z.enum(["all", "selected"]).default("all"),
  /** Names as the allowlist takes them: `skill` or `plugin:skill`. */
  names: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
});
export type SkillSelection = z.infer<typeof skillSelectionSchema>;

/** The fixed id of the Projects Assistant's profile; an orchestrator's is its id. */
export const ASSISTANT_PROFILE = "assistant";
const profileInput = z.object({ profile: z.string().min(1).max(200) });

export const profileSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type ProfileSkill = z.infer<typeof profileSkillSchema>;

export const profileSchema = z.object({
  directory: z.string(),
  pluginName: z.string(),
  systemPrompt: z.string(),
  ownSkills: z.array(profileSkillSchema),
});
export type ProfileView = z.infer<typeof profileSchema>;

export const profilesGetRpc = defineRpc({
  name: "workboard.profiles.get",
  input: profileInput,
  output: profileSchema,
});
export const profilesSetSystemPromptRpc = defineRpc({
  name: "workboard.profiles.set-system-prompt",
  input: profileInput.extend({ text: z.string().max(200_000) }),
  output: z.object({ ok: z.literal(true) }),
});

export const SKILL_GROUPS = ["profile", "personal", "plugins"] as const;
export const skillItemSchema = z.object({
  /** As the allowlist takes it. */
  name: z.string(),
  description: z.string(),
  group: z.enum(SKILL_GROUPS),
  /** The SKILL.md file. */
  source: z.string(),
});
export type SkillItem = z.infer<typeof skillItemSchema>;
export const profilesSkillsRpc = defineRpc({
  name: "workboard.profiles.skills",
  input: profileInput,
  output: z.object({ skills: z.array(skillItemSchema) }),
});
