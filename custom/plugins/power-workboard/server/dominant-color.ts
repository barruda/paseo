// CUSTOM(project-icon-colors): the dominant color of a project icon, for its accent.
// The weighted average skips transparent pixels and a light or dark background, and weights
// saturated pixels higher so a small logo on a flat backdrop keeps its own color.
import { PNG } from "pngjs";

export type ProjectIconColor =
  | { kind: "color"; color: string }
  | { kind: "monochrome" }
  | { kind: "unsupported" };

const MIN_ALPHA = 0.06;
/** A project icon is small; a huge PNG would block the board while it decodes. */
const MAX_PIXELS = 4_000_000;
const NEAR_WHITE = 0.92;
const NEAR_BLACK = 0.08;
const MIN_CHROMA = 0.12;

export function dominantColorFromIcon(
  data: Buffer,
  mimeType: string,
): ProjectIconColor {
  if (mimeType === "image/png") {
    if (data.length >= 24) {
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      if (width * height > MAX_PIXELS) return { kind: "unsupported" };
    }
    try {
      const png = PNG.sync.read(data);
      return dominantColorFromRgba(png.width, png.height, png.data);
    } catch {
      return { kind: "unsupported" };
    }
  }
  if (mimeType === "image/svg+xml") {
    return dominantColorFromSvg(data.toString("utf8"));
  }
  // ICO frames arrive as PNG from the daemon. Other formats stay on the palette.
  return { kind: "unsupported" };
}

export function dominantColorFromRgba(
  width: number,
  height: number,
  data: Uint8Array,
  channels = 4,
): ProjectIconColor {
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  let chromatic = 0;
  const pixels = width * height;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels;
    const alpha = channels === 4 ? (data[offset + 3] ?? 0) / 255 : 1;
    if (alpha < MIN_ALPHA) continue;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = (max - min) / 255;
    // A saturated dark blue is vivid, not a black background.
    if (
      (lightness >= NEAR_WHITE || lightness <= NEAR_BLACK) &&
      chroma < MIN_CHROMA
    )
      continue;
    if (chroma >= MIN_CHROMA) chromatic += 1;
    const weight = alpha * (0.25 + chroma);
    red += r * weight;
    green += g * weight;
    blue += b * weight;
    total += weight;
  }
  if (total === 0 || chromatic === 0) return { kind: "monochrome" };
  return {
    kind: "color",
    color: toHex(red / total, green / total, blue / total),
  };
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  red: "#ff0000",
  maroon: "#800000",
  orange: "#ffa500",
  yellow: "#ffff00",
  olive: "#808000",
  lime: "#00ff00",
  green: "#008000",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  blue: "#0000ff",
  navy: "#000080",
  purple: "#800080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
  brown: "#a52a2a",
};

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
const FILL_ATTRIBUTE =
  /(?:fill|stroke|stop-color|flood-color)\s*=\s*["']([^"']+)["']/gi;
const STYLE_ATTRIBUTE = /style\s*=\s*["']([^"']*)["']/gi;
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_COLOR = /(?:fill|stroke|stop-color|flood-color)\s*:\s*([^;}]+)/gi;

/**
 * SVG has no pixels to average. Its shapes' paint colors are the closest signal, so each
 * non-background color counts once and the average follows how often it is painted.
 */
export function dominantColorFromSvg(svg: string): ProjectIconColor {
  const values: string[] = [];
  // A gradient reference is an id, not a paint color, even when the id looks like one.
  const paint = (value: string): string[] => {
    const cleaned = value.replace(/url\([^)]*\)/g, "");
    const colors = [...(cleaned.match(COLOR_TOKEN) ?? [])];
    if (NAMED_COLORS[cleaned.trim().toLowerCase()]) colors.push(cleaned);
    return colors;
  };
  const declarations = (value: string): string[] => {
    const colors: string[] = [];
    for (const color of value.matchAll(STYLE_COLOR)) {
      colors.push(...paint(color[1] ?? ""));
    }
    return colors;
  };
  for (const match of svg.matchAll(FILL_ATTRIBUTE)) {
    values.push(...paint(match[1] ?? ""));
  }
  for (const match of svg.matchAll(STYLE_ATTRIBUTE)) {
    values.push(...declarations(match[1] ?? ""));
  }
  // An exported logo often paints through classes declared in a <style> block.
  for (const match of svg.matchAll(STYLE_BLOCK)) {
    values.push(...declarations(match[1] ?? ""));
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  let chromatic = 0;
  for (const value of values) {
    const rgb = parseColor(value);
    if (!rgb || rgb.a < MIN_ALPHA) continue;
    const lightness = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const chroma =
      (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
    if (
      (lightness >= NEAR_WHITE || lightness <= NEAR_BLACK) &&
      chroma < MIN_CHROMA
    )
      continue;
    if (chroma >= MIN_CHROMA) chromatic += 1;
    const weight = 0.25 + chroma;
    red += rgb.r * weight;
    green += rgb.g * weight;
    blue += rgb.b * weight;
    total += weight;
  }
  if (total === 0 || chromatic === 0) return { kind: "monochrome" };
  return {
    kind: "color",
    color: toHex(red / total, green / total, blue / total),
  };
}

function parseColor(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const named = NAMED_COLORS[value.trim().toLowerCase()];
  if (named) return parseHex(named);
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgb) {
    const parts = (rgb[1] ?? "").split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const channels = parts
      .slice(0, 3)
      .map((part) =>
        part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part),
      );
    if (channels.some((channel) => !Number.isFinite(channel))) return null;
    const alpha = parts.length >= 4 ? parseFloat(parts[3]!) : 1;
    return {
      r: channels[0]!,
      g: channels[1]!,
      b: channels[2]!,
      a: Number.isFinite(alpha) ? alpha : 1,
    };
  }
  return parseHex(value);
}

function parseHex(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const hex = /^#([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const expanded =
    hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
