import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SkillSourceSchema = z.object({
  // Must stay in step with SkillSourceKind in resolve/skill-entry.ts — a
  // mismatch fails zod validation at runtime, not at compile time.
  kind: z.enum(["project", "repo", "personal", "admin", "plugin"]),
  label: z.string(),
  dir: z.string(),
});

export const SkillEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: SkillSourceSchema,
  path: z.string(),
  userInvocable: z.boolean(),
  status: z.enum(["discovered"]),
});

export const ReportedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});

/**
 * What the live session says it can run, minus everything discovery already
 * found, split on the provider's own `kind`. `available: false` means the daemon
 * predates `agent.commands()`, which is not an error — the panel simply omits
 * both sections.
 */
export const ReportedSkillsSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable(),
  skills: z.array(ReportedSkillSchema),
  commands: z.array(ReportedSkillSchema),
});

export const listSkills = defineRpc({
  name: "skills.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    /**
     * Whether filesystem discovery ran for this provider — not whether the panel
     * has anything to show. Every provider that answers `agent.commands()` gets a
     * reported section regardless.
     */
    scanned: z.boolean(),
    cwd: z.string().nullable(),
    skills: z.array(SkillEntrySchema),
    reported: ReportedSkillsSchema,
  }),
});

export const readSkill = defineRpc({
  name: "skills.read",
  input: z.object({ agentId: z.string(), skillId: z.string() }),
  output: z.object({
    name: z.string(),
    description: z.string(),
    path: z.string(),
    body: z.string(),
  }),
});

// CUSTOM(skills-loaded): what the agent's session actually has in its context, read from the
// provider's own session file (Claude transcript, Codex rollout). No model call.

/** Where a loaded skill comes from: the user's own skill folders, a plugin, or the agent itself. */
export const LoadedSkillCategorySchema = z.enum(["custom", "plugin", "bundled"]);

/** Display group, in display order: the user's skills, then described, then name-only. */
export const LoadedSkillGroupSchema = z.enum(["custom", "described", "name-only"]);

export const LoadedSkillSchema = z.object({
  name: z.string(),
  /** Empty when the provider listed the name alone. */
  description: z.string(),
  hasDescription: z.boolean(),
  category: LoadedSkillCategorySchema,
  group: LoadedSkillGroupSchema,
});

export const LoadedMcpServerSchema = z.object({
  name: z.string(),
  /** `configured` and `disabled` come from Codex's config.toml, which records no session state. */
  status: z.enum(["loaded", "needs-auth", "pending", "failed", "configured", "disabled"]),
  error: z.string().nullable(),
  /** Null when the session file does not record tools (Codex). */
  toolCount: z.number().nullable(),
  /** Tools whose full schema is in context; the rest are known by name only (deferred). */
  fullSchemaCount: z.number().nullable(),
  /** Whether the server's instructions are in the context. Null when unknown. */
  instructions: z.boolean().nullable(),
});

export const loadedSkills = defineRpc({
  name: "skills.loaded",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    provider: z.string(),
    /**
     * `session`: the agent's own session file. `last-session`: the agent has no session file
     * yet, so this is the newest session of the same project. `none`: nothing found.
     * `unsupported`: the provider's session format is not read.
     */
    source: z.enum(["session", "last-session", "none", "unsupported"]),
    sessionFile: z.string().nullable(),
    /** ISO time the session file was last written. */
    sessionDate: z.string().nullable(),
    skills: z.array(LoadedSkillSchema),
    mcpServers: z.array(LoadedMcpServerSchema),
    /** `config`: Codex lists servers from config.toml; the rollout records none. */
    mcpSource: z.enum(["session", "config", "none"]),
  }),
});
