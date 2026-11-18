// CUSTOM(background-local-image): stores the images picked in the settings screen.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FILE_ID_PATTERN, IMAGE_MAX_BYTES, IMAGE_TYPES, isImageMimeType, mimeTypeForExtension, sniffImageType } from "../shared/images";

export function defaultImageDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.join(path.resolve(home), "plugin-data", "paseo-background", "images");
}

export class ImageStore {
  constructor(private readonly directory: string) {}

  async save(input: { mimeType: string; base64: string; name?: string }): Promise<{ id: string }> {
    if (!isImageMimeType(input.mimeType)) throw new Error(`Unsupported image type: ${input.mimeType}`);
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length === 0) throw new Error("The image is empty");
    if (bytes.length > IMAGE_MAX_BYTES) throw new Error(`The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB`);
    // The declared type can be wrong; the extension follows the bytes.
    const actual = sniffImageType(bytes);
    if (actual === null) throw new Error("The file is not a PNG, JPEG, GIF, or WebP image");
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    const id = `${stamp}-${randomUUID().slice(0, 8)}.${IMAGE_TYPES[actual]}`;
    await writeFile(path.join(this.directory, id), bytes, { flag: "wx" });
    return { id };
  }

  /** Reads only files directly inside the image directory. */
  async read(input: { id: string }): Promise<{ mimeType: string; base64: string }> {
    if (!FILE_ID_PATTERN.test(input.id) || input.id.includes("..")) throw new Error("Not a background image");
    const directory = await realpath(this.directory).catch(() => { throw new Error("The image no longer exists"); });
    const file = await realpath(path.join(directory, input.id)).catch(() => { throw new Error("The image no longer exists"); });
    if (path.dirname(file) !== directory) throw new Error("Not a background image");
    const mimeType = mimeTypeForExtension(path.extname(file).slice(1));
    if (mimeType === null) throw new Error("Not a background image");
    return { mimeType, base64: (await readFile(file)).toString("base64") };
  }
}
