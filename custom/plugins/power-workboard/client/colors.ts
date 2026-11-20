import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  groupColorKey,
  type Group,
  type GroupColor,
  type ProjectAccent,
} from "../shared/model";
import { PALETTE, projectPaletteAccent } from "../shared/project-color";

type Theme = PluginSurfaceProps["theme"];
export const groupColor = (group: Group, theme: Theme): string =>
  groupColorValue(groupColorKey(group), theme);

export function groupColorValue(color: GroupColor, theme: Theme): string {
  return supplementalColor(theme, ...PALETTE[color]);
}

// The theme exposes strings, without a mode flag. Alpha does not identify a backing surface.
function surfaceRgb(value: string): number[] | null {
  const hex = /^#([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(value.trim())?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((offset) =>
      parseInt(expanded.slice(offset, offset + 2), 16),
    );
  }
  const rgb = /^(rgb|rgba)\(([^)]+)\)$/i.exec(value.trim());
  if (!rgb) return null;
  const parts = rgb[2].split(",").map((part) => part.trim());
  if (parts.length !== (rgb[1].toLowerCase() === "rgba" ? 4 : 3)) return null;
  const channels = parts.slice(0, 3).map((part) => {
    if (!/^\d+(?:\.\d+)?%?$/.test(part)) return NaN;
    const percent = part.endsWith("%");
    const number = parseFloat(part);
    return number <= (percent ? 100 : 255)
      ? number * (percent ? 2.55 : 1)
      : NaN;
  });
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  if (
    parts.length === 4 &&
    (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(parts[3]) || Number(parts[3]) > 1)
  )
    return null;
  return channels;
}
export function supplementalColor(
  theme: Theme,
  light: string,
  dark: string,
): string {
  const rgb = surfaceRgb(theme.colors.surface0);
  if (!rgb) return light;
  const brightness = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return brightness < 128 ? dark : light;
}

/** A stable color per project, from its id, so its chip looks the same everywhere. */
export function projectColor(id: string, theme: Theme): string {
  const { light, dark } = projectPaletteAccent(id);
  return supplementalColor(theme, light, dark);
}

/**
 * CUSTOM(project-icon-colors): the project's accent, or the stable palette when the board has no
 * accent for it (an old snapshot, or a task whose project is gone).
 */
export function projectAccentColor(
  accent: ProjectAccent | null | undefined,
  fallbackId: string,
  theme: Theme,
): string {
  if (accent) return supplementalColor(theme, accent.light, accent.dark);
  return projectColor(fallbackId, theme);
}

/**
 * CUSTOM(project-icon-colors): the app's letter box uses the same identity fill in both themes,
 * independent of the accent (which the dark theme changes, and an image or a hand-picked color
 * can replace). Falls back to the accent's light variant for an old snapshot without `letterFill`.
 */
export function projectLetterFill(
  letterFill: string | undefined,
  accent: ProjectAccent | null | undefined,
  fallbackId: string,
): string {
  return letterFill ?? accent?.light ?? projectPaletteAccent(fallbackId).light;
}
