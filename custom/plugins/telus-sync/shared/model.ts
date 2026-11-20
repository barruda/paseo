// CUSTOM(telus-sync): the allowlists and exclusion lists are the contract; tests pin them.
import { z } from "zod";

/**
 * What a sync may copy. Everything else under the two Paseo homes is off limits: credentials,
 * agent and provider definitions, agent profiles, and all execution data.
 */

export const CATEGORY_IDS = [
  "ux",
  "desktop",
  "plugins",
  "pluginSettings",
] as const;
export const categoryIdSchema = z.enum(CATEGORY_IDS);
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface CategoryInfo {
  title: string;
  description: string;
}

export const CATEGORY_INFO: Record<CategoryId, CategoryInfo> = {
  ux: {
    title: "UX preferences on the daemon",
    description:
      "config.json: the features block (dictation, voice mode, web UI). No providers, MCP servers, env or directories.",
  },
  desktop: {
    title: "App preferences (desktop)",
    description:
      "desktop-settings.json: notification sounds and flexible tab movement. Quit Paseo Telus first: it caches the file and would overwrite the sync on its next save. Daemon behaviour and the update channel stay as they are.",
  },
  plugins: {
    title: "Installed and enabled plugins",
    description:
      "config.json: pluginsEnabled and the plugins list; the managed sources under plugins/; custom-plugins-applied.json.",
  },
  pluginSettings: {
    title: "Plugin settings",
    description:
      "plugin-settings/<id>/ for plugins whose settings are UX only. Credential keys and execution state are never copied.",
  },
};

/** config.json top-level keys that may travel, and the subkeys of each. */
export const CONFIG_UX_ALLOWLIST: Record<string, readonly string[]> = {
  features: ["dictation", "voiceMode", "webUi"],
};

/** desktop-settings.json leaf paths that may travel. */
export const DESKTOP_SETTINGS_ALLOWLIST: readonly (readonly string[])[] = [
  ["notifications", "playSound"],
  ["tabs", "flexibleMovement"],
];

/**
 * Plugin settings that never travel. Their files hold board/task state, agent model picks or
 * credentials, not display preferences.
 */
export const EXCLUDED_PLUGIN_SETTINGS: Record<string, string> = {
  "power-workboard":
    "board tasks, orchestrations, workspace pins and the server id are execution data",
  delegation:
    "its settings pick the provider and models for the subagents it starts",
  "jev-router": "it stores the TypeSafe API key and the routing model choices",
};

/** A key whose value is a credential. Dropped wherever it appears in a settings file. */
export const CREDENTIAL_KEY_PATTERN =
  /(api[-_]?key|access[-_]?key|private[-_]?key|secret|token|password|passwd|authorization|credential)/i;

/** A settings file that is credentials end to end; skipped as a whole. */
export const CREDENTIAL_FILE_PATTERN =
  /(secret|token|credentials?|creds?|auth|api[-_]?key|keypair|\.pem$|\.key$)/i;

/** Files under plugin-settings/ that are local backups, not live settings. */
export const SKIPPED_SETTINGS_FILE_PATTERN = /\.bak($|[-_.])/i;

/** Kept backups; older ones are deleted after a successful sync. */
export const MAX_BACKUPS = 5;

export const itemStatusSchema = z.enum([
  "new",
  "changed",
  "same",
  "unavailable",
]);
export type ItemStatus = z.infer<typeof itemStatusSchema>;

export const previewItemSchema = z.object({
  label: z.string(),
  status: itemStatusSchema,
  detail: z.string().nullable(),
});
export type PreviewItem = z.infer<typeof previewItemSchema>;

export const previewCategorySchema = z.object({
  category: categoryIdSchema,
  title: z.string(),
  description: z.string(),
  items: z.array(previewItemSchema),
  notes: z.array(z.string()),
  changed: z.number(),
  same: z.number(),
  unavailable: z.number(),
});
export type PreviewCategory = z.infer<typeof previewCategorySchema>;

export const statusSchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  sourceHome: z.string(),
  targetHome: z.string(),
  sourceAppDir: z.string(),
  targetAppDir: z.string(),
  backupRoot: z.string(),
});
export type SyncStatus = z.infer<typeof statusSchema>;

export const runResultSchema = z.object({
  ok: z.boolean(),
  /** The backup directory name, also the history entry id. */
  backupId: z.string().nullable(),
  backupPath: z.string().nullable(),
  copied: z.number(),
  same: z.number(),
  skipped: z.number(),
  warnings: z.array(z.string()),
  /** What the Telus install needs to pick the change up. Never done by the sync. */
  apply: z.array(z.string()),
  error: z.string().nullable(),
});
export type RunResult = z.infer<typeof runResultSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  categories: z.array(categoryIdSchema),
  copied: z.number(),
  same: z.number(),
  skipped: z.number(),
  failed: z.boolean(),
  rolledBackAt: z.string().nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export function emptyRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    ok: false,
    backupId: null,
    backupPath: null,
    copied: 0,
    same: 0,
    skipped: 0,
    warnings: [],
    apply: [],
    error: null,
    ...overrides,
  };
}
