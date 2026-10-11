// CUSTOM(workboard-images): stores images pasted into task descriptions.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  isImageMimeType,
  mimeTypeForExtension,
  sniffImageType,
} from "../shared/images";

export function defaultImageDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.join(
    path.resolve(home),
    "plugin-data",
    "paseo-workboard",
    "images",
  );
}

export class ImageStore {
  constructor(private readonly directory: string) {}

  async save(input: {
    mimeType: string;
    base64: string;
  }): Promise<{ path: string }> {
    if (!isImageMimeType(input.mimeType))
      throw new Error(`Unsupported image type: ${input.mimeType}`);
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length === 0) throw new Error("The image is empty");
    if (bytes.length > IMAGE_MAX_BYTES)
      throw new Error(
        `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB`,
      );
    // The clipboard's type label can be wrong; the file extension follows the bytes.
    const actual = sniffImageType(bytes);
    if (actual === null)
      throw new Error("The pasted data is not a PNG, JPEG, GIF, or WebP image");
    await mkdir(this.directory, { recursive: true });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..*$/, "");
    const file = path.join(
      this.directory,
      `${stamp}-${randomUUID().slice(0, 8)}.${IMAGE_TYPES[actual]}`,
    );
    await writeFile(file, bytes, { flag: "wx" });
    return { path: file };
  }

  /** Reads only files inside the image directory, so a description can't point it elsewhere. */
  async read(input: { path: string }): Promise<{ dataUri: string }> {
    const directory = await realpath(this.directory).catch(() => {
      throw new Error("The image no longer exists");
    });
    const file = await realpath(input.path).catch(() => {
      throw new Error("The image no longer exists");
    });
    if (path.dirname(file) !== directory)
      throw new Error("Not a Workboard image");
    const mime = mimeTypeForExtension(path.extname(file).slice(1));
    if (mime === null) throw new Error("Not a Workboard image");
    const bytes = await readFile(file);
    return { dataUri: `data:${mime};base64,${bytes.toString("base64")}` };
  }
}
