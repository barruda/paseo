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
      "desktop-settings.json: notification sounds and flexible tab movement. Daemon behaviour and the update channel stay as they are.",
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

/**
 * Key names that are a credential on their own, whatever the casing or separators. Compared
 * without `-`, `_` and `.`, so `api_key`, `api-key` and `apiKey` all hit.
 */
const CREDENTIAL_KEY_NAMES: readonly string[] = [
  "apikey",
  "apikeys",
  "accesskey",
  "privatekey",
  "secretkey",
  "signingkey",
  "apitoken",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "bearertoken",
  "sessiontoken",
  "secret",
  "secrets",
  "token",
  "tokens",
  "password",
  "passwd",
  "authorization",
  "credential",
  "credentials",
];

/**
 * A key name that ends in a credential word is a credential (`githubToken`, `jwtSecret`,
 * `dbPassword`). The plural `tokens` is left out on purpose: `maxTokens` and `max_tokens` are
 * limits, not secrets.
 */
const CREDENTIAL_WORD_SUFFIX_PATTERN =
  /(?:token|secret|secrets|password|passwords|passwd|credential|credentials|authorization)$/i;

/**
 * `key` only counts behind a qualifier, so `apiKey` and `sshKey` are credentials while `cacheKey`,
 * `sortKey` and `hotkey` are ordinary settings.
 */
const QUALIFIED_KEY_SUFFIX_PATTERN =
  /(?:api|access|private|secret|signing|auth|session|client|master|encryption|hmac|ssh|tls|gpg)[-_]?(?:key|keys)$/i;

/** Whether a key holds a credential. Dropped wherever it appears in a settings file. */
export function isCredentialKey(key: string): boolean {
  if (CREDENTIAL_KEY_NAMES.includes(key.replace(/[-_.]/g, "").toLowerCase()))
    return true;
  return (
    CREDENTIAL_WORD_SUFFIX_PATTERN.test(key) ||
    QUALIFIED_KEY_SUFFIX_PATTERN.test(key)
  );
}

/** File-name words that mean the file is credentials end to end. */
const CREDENTIAL_FILE_WORDS: readonly string[] = [
  "token",
  "tokens",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "creds",
  "auth",
  "oauth",
  "apikey",
  "accesskey",
  "privatekey",
  "secretkey",
  "keypair",
  "key",
  "keys",
  "password",
  "passwd",
  "authorization",
];

/** Whether a settings file name says its content is credentials end to end. */
export function isCredentialFileName(fileName: string): boolean {
  if (/\.(?:pem|key)$/i.test(fileName)) return true;
  const base = fileName.replace(/\.[^.]+$/, "");
  const words = base
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean);
  const last = words.at(-1)?.toLowerCase();
  // Only the last word counts, so `tokens.json` and `apiToken.json` skip while `token-usage.json`,
  // `password-policy.json` and `tokenizer.json` are ordinary settings.
  return last !== undefined && CREDENTIAL_FILE_WORDS.includes(last);
}

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
