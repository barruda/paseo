import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  citedEvidenceFiles,
  type EvidenceSummary,
  htmlImageSources,
  sniffImageMime,
} from "../shared/review";

/** Anthropic refuses an image over 5 MB of base64. */
const MAX_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_UNAVAILABLE = 12;

export interface CriticEvidence extends EvidenceSummary {
  images: { data: string; mimeType: string }[];
}

/** Replaces each local page with the images it shows; the images keep the citation order. */
async function expandPages(files: readonly string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const file of files) {
    if (!/\.html?$/i.test(file)) {
      expanded.push(file);
      continue;
    }
    try {
      if ((await stat(file)).size > MAX_HTML_BYTES) continue;
      const sources = htmlImageSources(await readFile(file, "utf8"));
      expanded.push(...sources.map((source) => path.resolve(path.dirname(file), source)));
    } catch {
      expanded.push(file);
    }
  }
  return [...new Set(expanded)];
}

function readFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" ? "file not found" : "could not be read";
}

/**
 * Reads the images the answer links to, so the critic sees them without opening anything: its
 * read tools stop at the workspace, and agents keep screenshots elsewhere. The latest citations
 * win when there are too many.
 */
export async function collectEvidence(answer: string, cwd: string): Promise<CriticEvidence> {
  const cited = citedEvidenceFiles(answer).map((file) => path.resolve(cwd, file));
  const files = await expandPages(cited);
  const attached: { path: string; data: string; mimeType: string }[] = [];
  const unavailable: { path: string; reason: string }[] = [];
  let totalBytes = 0;

  for (const file of files.toReversed()) {
    if (attached.length >= MAX_IMAGES) {
      unavailable.push({ path: file, reason: `over the limit of ${MAX_IMAGES} images` });
      continue;
    }
    try {
      const { size } = await stat(file);
      if (size > MAX_IMAGE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) {
        unavailable.push({ path: file, reason: "too large to attach" });
        continue;
      }
      if (/\.html?$/i.test(file)) {
        unavailable.push({ path: file, reason: "page with no local images" });
        continue;
      }
      const bytes = await readFile(file);
      const mimeType = sniffImageMime(bytes);
      if (!mimeType) {
        unavailable.push({ path: file, reason: "not a PNG, JPEG, GIF or WebP image" });
        continue;
      }
      totalBytes += bytes.length;
      attached.unshift({ path: file, data: bytes.toString("base64"), mimeType });
    } catch (error) {
      unavailable.push({ path: file, reason: readFailure(error) });
    }
  }

  // An agent often moves a screenshot after linking it: the copy it kept already covers that link.
  const attachedNames = new Set(attached.map((image) => path.basename(image.path)));
  return {
    images: attached.map(({ data, mimeType }) => ({ data, mimeType })),
    attached: attached.map((image) => image.path),
    unavailable: unavailable
      .filter((entry) => !attachedNames.has(path.basename(entry.path)))
      .toReversed()
      .slice(-MAX_UNAVAILABLE),
  };
}
