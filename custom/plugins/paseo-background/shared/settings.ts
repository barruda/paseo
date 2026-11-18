import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { presets } from "./presets";
import { FILE_ID_PATTERN } from "./images";
import { getCachedFile } from "./file-cache";

export const backgroundSchema = z.object({
  enabled: z.boolean().default(false),
  profileId: z.string().max(120).default(""),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), id: z.string().refine((id) => presets.some((p) => p.id === id), "Choose an available preset") }),
    z.object({ kind: z.literal("url"), url: z.string().trim().max(4096).url().refine((value) => value.startsWith("https://"), "Use an HTTPS image URL") }),
    // CUSTOM(background-local-image): an image the user picked, stored on the host.
    z.object({ kind: z.literal("file"), id: z.string().max(120).regex(FILE_ID_PATTERN, "Invalid image id"), name: z.string().max(255) }),
  ]).default({ kind: "preset", id: "forest" }),
  imageOpacity: z.number().finite().min(0).max(1).default(0.65),
  surfaceOpacity: z.number().finite().min(0).max(1).default(0.72),
  blurRadius: z.number().finite().min(0).max(24).default(0),
  brightness: z.number().finite().min(0.4).max(1.4).default(1),
  fit: z.enum(["cover", "contain"]).default("cover"),
  position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
});

export type BackgroundSettings = z.infer<typeof backgroundSchema>;
export const defaults = (): BackgroundSettings => backgroundSchema.parse({});
export const preferences = defineSettings({ id: "background", scope: "host", version: 1, schema: backgroundSchema });
export const preferenceRpc = settingsRpc(preferences.id);

export function sourceUri(settings: BackgroundSettings): string {
  const source = settings.source;
  if (source.kind === "file") return getCachedFile(source.id) ?? ""; // "" while it loads
  return source.kind === "url" ? source.url : presets.find((p) => p.id === source.id)!.uri;
}

export function withOpacity(color: string, opacity: number): string | null {
  const channels = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (channels) {
    const alpha = channels[4] === undefined ? 1 : Number(channels[4]);
    if (alpha === 0) return null;
    return `rgba(${channels[1]}, ${channels[2]}, ${channels[3]}, ${Math.max(0, Math.min(1, opacity)) * alpha})`;
  }
  const hex = color.match(/^#([\da-f]{6}|[\da-f]{3})$/i)?.[1];
  if (!hex) return null;
  const value = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  return `rgba(${[0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(", ")}, ${Math.max(0, Math.min(1, opacity))})`;
}
