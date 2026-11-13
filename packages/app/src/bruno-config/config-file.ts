// CUSTOM(bruno-config-file): one JSON file with every setting Bruno's Customizations edits.
import { z } from "zod";

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
