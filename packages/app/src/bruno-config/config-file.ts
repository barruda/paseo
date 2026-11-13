// CUSTOM(bruno-config-file): one JSON file with every setting Bruno's Customizations edits.
import { z } from "zod";
import { JEV_ROUTER_PLUGIN_ID, JEV_ROUTER_SETTINGS_ID } from "@getpaseo/protocol/jev-router";

export const BRUNO_CONFIG_FILE_NAME = "paseo-bruno-config.json";
const BRUNO_CONFIG_VERSION = 1;

const AppSectionSchema = z
  .object({
    chatLinksEnabled: z.boolean().optional(),
    chatOptions: z.record(z.string(), z.boolean()).optional(),
    chatOptionOrder: z
      .object({
        above: z.array(z.string()).optional(),
        left: z.array(z.string()).optional(),
        right: z.array(z.string()).optional(),
      })
      .optional(),
    deskPreviewTabs: z.boolean().optional(),
    recentTabsSkipPinned: z.boolean().optional(),
    showCriticToggle: z.boolean().optional(),
    showJevRouterToggle: z.boolean().optional(),
  })
  .passthrough();

const DesktopSectionSchema = z
  .object({ flexibleTabMovement: z.boolean().optional() })
  .passthrough();

// Daemon config and plugin values stay opaque: the daemon and each plugin validate on write.
const JsonObjectSchema = z.record(z.string(), z.unknown());

const HostSectionSchema = z
  .object({
    github: z.object({ configDir: z.string().optional() }).passthrough().optional(),
    speech: JsonObjectSchema.optional(),
    features: JsonObjectSchema.optional(),
    // plugin id -> settings id -> values
    plugins: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  })
  .passthrough();

const BrunoConfigSchema = z
  .object({
    paseoBrunoConfig: z.number().int().positive(),
    savedAt: z.string().optional(),
    app: AppSectionSchema.optional(),
    desktop: DesktopSectionSchema.optional(),
    host: HostSectionSchema.optional(),
  })
  .passthrough();

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export type BrunoConfig = z.infer<typeof BrunoConfigSchema>;
export type BrunoConfigSnapshot = Omit<BrunoConfig, "paseoBrunoConfig" | "savedAt">;

export type ParseBrunoConfigResult =
  | { ok: true; config: BrunoConfig }
  | { ok: false; reason: "invalid-json" | "invalid-format" | "newer-version" };

export function serializeBrunoConfig(snapshot: BrunoConfigSnapshot, now = new Date()): string {
  return `${JSON.stringify(
    { paseoBrunoConfig: BRUNO_CONFIG_VERSION, savedAt: now.toISOString(), ...snapshot },
    null,
    2,
  )}\n`;
}

export function parseBrunoConfig(text: string): ParseBrunoConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  // Check the version first: a newer file may change the shape of the other sections.
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { paseoBrunoConfig?: unknown }).paseoBrunoConfig === "number" &&
    (raw as { paseoBrunoConfig: number }).paseoBrunoConfig > BRUNO_CONFIG_VERSION
  ) {
    return { ok: false, reason: "newer-version" };
  }
  const parsed = BrunoConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid-format" };
  return { ok: true, config: parsed.data };
}

export const BRUNO_CONFIG_ERROR_MESSAGES = {
  "invalid-json": "That file is not valid JSON.",
  "invalid-format": "That file is not a Bruno's Customizations configuration.",
  "newer-version": "That file was saved by a newer version of this app. Update the app to load it.",
} as const;

type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The voice and dictation provider choices (local or Claude) move between hosts; the Claude
// account folder does not.
const ACCOUNT_SPEECH_KEYS = ["claudeSttConfigDir"] as const;
// OpenAI credentials live in these feature sub-objects, next to the provider and model.
const ACCOUNT_FEATURE_PATHS: Record<string, readonly string[]> = {
  dictation: ["stt"],
  voiceMode: ["stt", "tts", "llm"],
};
const ACCOUNT_FEATURE_KEYS = ["apiKey", "baseUrl"] as const;
const ACCOUNT_JEV_KEYS = ["apiKey", "apiUrl", "jevModel"] as const;

function omitKeys(source: PlainObject, keys: readonly string[]): PlainObject {
  const copy: PlainObject = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

function stripFeatures(features: PlainObject): PlainObject {
  const copy: PlainObject = { ...features };
  for (const [group, paths] of Object.entries(ACCOUNT_FEATURE_PATHS)) {
    const value = copy[group];
    if (!isPlainObject(value)) continue;
    const nextGroup: PlainObject = { ...value };
    for (const path of paths) {
      const inner = nextGroup[path];
      if (!isPlainObject(inner)) continue;
      const stripped = omitKeys(inner, ACCOUNT_FEATURE_KEYS);
      if (Object.keys(stripped).length > 0) nextGroup[path] = stripped;
      else delete nextGroup[path];
    }
    if (Object.keys(nextGroup).length > 0) copy[group] = nextGroup;
    else delete copy[group];
  }
  return copy;
}

/**
 * Copy of a config without the account-specific host fields: the GitHub account, the Claude
 * account folder, the OpenAI keys and URLs of voice and dictation, and the Jev router key,
 * endpoint and model. A section that
 * ends up empty is left out.
 */
export function stripAccountSettings<T extends BrunoConfigSnapshot>(config: T): T {
  const host = config.host as z.infer<typeof HostSectionSchema> | undefined;
  if (!host) return config;
  const { github: _github, speech, features, plugins, ...rest } = host;
  const nextHost: PlainObject = { ...rest };
  if (speech) {
    const stripped = omitKeys(speech, ACCOUNT_SPEECH_KEYS);
    if (Object.keys(stripped).length > 0) nextHost.speech = stripped;
  }
  if (features) {
    const stripped = stripFeatures(features);
    if (Object.keys(stripped).length > 0) nextHost.features = stripped;
  }
  if (plugins) {
    const nextPlugins: Record<string, Record<string, JsonValue>> = { ...plugins };
    const jev = plugins[JEV_ROUTER_PLUGIN_ID];
    const router = jev?.[JEV_ROUTER_SETTINGS_ID];
    if (jev && isPlainObject(router)) {
      nextPlugins[JEV_ROUTER_PLUGIN_ID] = {
        ...jev,
        [JEV_ROUTER_SETTINGS_ID]: omitKeys(router, ACCOUNT_JEV_KEYS) as JsonValue,
      };
    }
    nextHost.plugins = nextPlugins;
  }
  return { ...config, host: nextHost };
}

/** A file without a key keeps the host's value: shallow merge when both sides are objects. */
export function mergePluginValues(current: unknown, incoming: JsonValue): JsonValue {
  if (isPlainObject(current) && isPlainObject(incoming)) {
    return { ...current, ...incoming } as JsonValue;
  }
  return incoming;
}
