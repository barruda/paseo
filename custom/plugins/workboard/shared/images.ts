// CUSTOM(workboard-images): images pasted into a task description. The file lives on the daemon
// host and the description keeps a Markdown reference to its absolute path, so the text stays
// readable (and usable by an agent) outside Workboard.

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Every saved image sits under `<PASEO_HOME>/plugin-data/<this>/`. */
export const IMAGE_DIRECTORY_MARKER = "/plugin-data/paseo-workboard/images/";

export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type ImageMimeType = keyof typeof IMAGE_TYPES;

export function isImageMimeType(value: string): value is ImageMimeType {
  return value in IMAGE_TYPES;
}

export function mimeTypeForExtension(extension: string): ImageMimeType | null {
  for (const [mime, ext] of Object.entries(IMAGE_TYPES)) {
    if (ext === extension.toLowerCase()) return mime as ImageMimeType;
  }
  return extension.toLowerCase() === "jpeg" ? "image/jpeg" : null;
}

/** The type the bytes really are, from their signature; null when not a supported image. */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | null {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

export interface ImageRef {
  path: string;
  start: number;
  end: number;
}

const IMAGE_REF = /!\[[^\]\n]*\]\(([^)\s]+)\)/g;

/** References to images Workboard saved, in text order. Other Markdown images are left alone. */
export function findImageRefs(text: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const match of text.matchAll(IMAGE_REF)) {
    const path = match[1];
    if (path === undefined || !path.includes(IMAGE_DIRECTORY_MARKER)) continue;
    refs.push({ path, start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

export function imageMarkdown(path: string): string {
  return `![image](${path})`;
}

/**
 * Replaces the selection with the references, each on its own line. The positions come from when
 * the paste happened; the text may have changed while the images uploaded, so they are clamped.
 */
export function insertImageRefs(
  text: string,
  selection: { start: number; end: number },
  paths: readonly string[],
): string {
  if (paths.length === 0) return text;
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const trail = after.startsWith("\n") ? "" : "\n";
  return `${before}${lead}${paths.map(imageMarkdown).join("\n")}${trail}${after}`;
}

/** Removes one reference and the line break it was given, leaving the surrounding text as typed. */
export function removeImageRef(text: string, ref: ImageRef): string {
  let { start, end } = ref;
  if (text[end] === "\n") end += 1;
  else if (start > 0 && text[start - 1] === "\n") start -= 1;
  return text.slice(0, start) + text.slice(end);
}
