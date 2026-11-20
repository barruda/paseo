// CUSTOM(project-icon-colors): a project's accent comes from the icon the app shows for it.
// The palette, the app's letter colors and its project view keys live here so the server and
// the client resolve the same color for the same project.
import { GROUP_COLORS, type GroupColor, type ProjectAccent } from "./model";

export const PALETTE: Record<GroupColor, readonly [string, string]> = {
  gray: ["#64748b", "#94a3b8"],
  blue: ["#2563eb", "#60a5fa"],
  cyan: ["#0e7490", "#22d3ee"],
  teal: ["#0f766e", "#2dd4bf"],
  green: ["#15803d", "#4ade80"],
  amber: ["#b45309", "#fbbf24"],
  orange: ["#c2410c", "#fb923c"],
  violet: ["#7c3aed", "#a78bfa"],
  pink: ["#be185d", "#f472b6"],
  red: ["#dc2626", "#f87171"],
};

export const GRAY_ACCENT: ProjectAccent = accentFromPalette("gray");

export function accentFromPalette(color: GroupColor): ProjectAccent {
  return { light: PALETTE[color][0], dark: PALETTE[color][1] };
}

/** The same stable palette color per project id the plugin has always used. */
export function projectPaletteAccent(id: string): ProjectAccent {
  const colors = GROUP_COLORS.filter((color) => color !== "gray");
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return accentFromPalette(colors[hash % colors.length]);
}

// Mirror of packages/app/src/styles/identity-colors.ts. The app colors a project's generated
// letter icon from the project's view key; the plugin draws that same letter, so it needs the
// same table. Reordering the names recolors every existing project, so keep the order.
export const IDENTITY_COLOR_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

const IDENTITY_COLORS: Record<(typeof IDENTITY_COLOR_NAMES)[number], string> = {
  violet: "#7a6aa8",
  sky: "#3d7ea6",
  emerald: "#388068",
  orange: "#a4673a",
  pink: "#b05c80",
  indigo: "#6a70b8",
  teal: "#368080",
  red: "#b06260",
  amber: "#8f7838",
  blue: "#5179b0",
};

// The same hues as foreground on a dark surface, from the app's IDENTITY_FOREGROUND_DARK.
// The light fill above is a box with a white letter; the dark surface needs the lighter text.
const IDENTITY_FOREGROUND_DARK: Record<
  (typeof IDENTITY_COLOR_NAMES)[number],
  string
> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

export function identityAccent(viewKey: string): ProjectAccent {
  let hash = 0;
  for (const character of viewKey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const name = IDENTITY_COLOR_NAMES[hash % IDENTITY_COLOR_NAMES.length]!;
  return { light: IDENTITY_COLORS[name], dark: IDENTITY_FOREGROUND_DARK[name] };
}

/**
 * The app groups projects by `projectKey` only when it is unique on the server, and otherwise
 * keys the project by its server placement. The letter color follows that key.
 */
export function projectViewKeys(
  projects: readonly { projectId: string; projectKey?: string | null }[],
  serverId: string,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    if (!project.projectKey) continue;
    counts.set(project.projectKey, (counts.get(project.projectKey) ?? 0) + 1);
  }
  const allocated = new Set<string>();
  for (const project of projects) {
    if (project.projectKey) allocated.add(project.projectKey);
  }
  const result = new Map<string, string>();
  for (const project of projects) {
    const shared = project.projectKey;
    if (shared && counts.get(shared) === 1) {
      result.set(project.projectId, shared);
      continue;
    }
    let key = JSON.stringify([serverId, project.projectId]);
    if (allocated.has(key)) {
      for (let suffix = 0; ; suffix += 1) {
        const collision = JSON.stringify([
          "placement",
          serverId,
          project.projectId,
          suffix,
        ]);
        if (allocated.has(collision)) continue;
        key = collision;
        break;
      }
    }
    allocated.add(key);
    result.set(project.projectId, key);
  }
  return result;
}

export type ProjectAccentImage =
  | { kind: "color"; color: string }
  | { kind: "monochrome" }
  | { kind: "unsupported" };

/**
 * Precedence: a color the user picked by hand, then the icon's dominant color, then the app's
 * letter color when the project has no image, then the stable palette.
 * `image` is undefined when the icon could not be read, null when the daemon has no icon.
 */
export function resolveProjectAccent(input: {
  id: string;
  viewKey?: string | null;
  image?: ProjectAccentImage | null;
  manualColor?: GroupColor | null;
}): ProjectAccent {
  if (input.manualColor) return accentFromPalette(input.manualColor);
  if (input.image === undefined) return projectPaletteAccent(input.id);
  if (input.image === null) {
    return input.viewKey
      ? identityAccent(input.viewKey)
      : projectPaletteAccent(input.id);
  }
  if (input.image.kind === "color") {
    return accentFromDominantColor(input.image.color) ?? GRAY_ACCENT;
  }
  if (input.image.kind === "monochrome") return GRAY_ACCENT;
  return projectPaletteAccent(input.id);
}

/**
 * A dominant color becomes two variants, so a white letter on the light surface and a dark
 * one on the dark surface keep their contrast. Achromatic colors have no hue to keep.
 */
export function accentFromDominantColor(hex: string): ProjectAccent | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  if (hsl.s < 0.12) return null;
  const light = hslToHex(clampHsl(hsl, 0.3, 0.46));
  const dark = hslToHex(clampHsl(hsl, 0.62, 0.8));
  return {
    light: darkenUntilContrast(light, "#ffffff", 4),
    // The app's lightest dark surface; the badge letter and the accents sit on it.
    dark: lightenUntilContrast(dark, "#282c34", 4),
  };
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clampHsl(hsl: Hsl, min: number, max: number): Hsl {
  return { ...hsl, l: Math.min(max, Math.max(min, hsl.l)) };
}

function parseHex(value: string): { r: number; g: number; b: number } | null {
  const hex = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const expanded =
    hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === red) h = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${[r, g, b]
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function darkenUntilContrast(
  color: string,
  against: string,
  ratio: number,
): string {
  const hsl = rgbToHsl(parseHex(color)!);
  let current = color;
  while (contrast(current, against) < ratio && hsl.l > 0.05) {
    hsl.l = Math.max(0.05, hsl.l - 0.02);
    current = hslToHex(hsl);
  }
  return current;
}

function lightenUntilContrast(
  color: string,
  against: string,
  ratio: number,
): string {
  const hsl = rgbToHsl(parseHex(color)!);
  let current = color;
  while (contrast(current, against) < ratio && hsl.l < 0.95) {
    hsl.l = Math.min(0.95, hsl.l + 0.02);
    current = hslToHex(hsl);
  }
  return current;
}
