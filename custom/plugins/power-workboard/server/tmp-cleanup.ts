// CUSTOM(unattended-automation): remove first-level entries of the scratch folder that have not
// been touched for a while. The board calls it from its existing tick, at most once an hour, in
// the background: a slow filesystem must not hold the board.
import { lstat, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface TmpCleanupOptions {
  /** Folder whose first-level entries are considered. Never removed itself. */
  path: string;
  /** Entries whose newest mtime is older than this are removed. */
  maxAgeMs: number;
  /** Injected clock, in milliseconds. */
  now: number;
}

export interface TmpCleanupResult {
  removed: string[];
  errors: string[];
}

/** The newest mtime in a tree; symlinks count as themselves and are never followed. */
async function newestMtime(entry: string): Promise<number> {
  const stats = await lstat(entry);
  if (!stats.isDirectory() || stats.isSymbolicLink()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const name of await readdir(entry)) {
    const child = join(entry, name);
    try {
      newest = Math.max(newest, await newestMtime(child));
    } catch {
      // A child that vanished mid-walk cannot be newer than what we already saw.
    }
  }
  return newest;
}

/**
 * Remove the entries of `options.path` whose newest mtime is before the cutoff. Symlinks are
 * unlinked, never followed; the scratch folder itself is never removed. Errors are collected
 * per entry instead of aborting the pass.
 */
export async function cleanupScratchDirectory(
  options: Pick<TmpCleanupOptions, "path" | "maxAgeMs" | "now">,
): Promise<TmpCleanupResult> {
  const result: TmpCleanupResult = { removed: [], errors: [] };
  if (!options.path) return result;
  const cutoff = options.now - options.maxAgeMs;
  let names: string[];
  try {
    names = await readdir(options.path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      result.errors.push(`${options.path}: ${messageOf(error)}`);
    }
    return result;
  }
  for (const name of names) {
    const entry = join(options.path, name);
    try {
      const newest = await newestMtime(entry);
      if (newest >= cutoff) continue;
      const stats = await lstat(entry);
      if (stats.isSymbolicLink()) await unlink(entry);
      else await rm(entry, { recursive: true, force: true });
      result.removed.push(entry);
    } catch (error) {
      result.errors.push(`${entry}: ${messageOf(error)}`);
    }
  }
  return result;
}

/** Whether the hourly pass is due; null ranAt (first tick) means yes. */
export function tmpCleanupDue(
  ranAt: number | null,
  now: number,
  intervalMs: number,
): boolean {
  return ranAt === null || now - ranAt >= intervalMs;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
