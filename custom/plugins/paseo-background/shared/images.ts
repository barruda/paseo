// CUSTOM(background-local-image): local image files stored on the daemon host.
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as const;
export type ImageMimeType = keyof typeof IMAGE_TYPES;
export const FILE_ID_PATTERN = /^[\w.-]+$/;

export function isImageMimeType(value: string): value is ImageMimeType { return value in IMAGE_TYPES; }

export function mimeTypeForExtension(extension: string): ImageMimeType | null {
  const ext = extension.toLowerCase();
  if (ext === "jpeg") return "image/jpeg";
  for (const [mime, known] of Object.entries(IMAGE_TYPES)) if (known === ext) return mime as ImageMimeType;
  return null;
}

/** The type the bytes really are, from their signature; null when not a supported image. */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
