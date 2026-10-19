import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_ENTRIES = 200;

export interface PathCompletion {
  value: string;
  kind: "file" | "directory";
}

/** Backslash-escapes the characters a shell would split or expand. */
export function escapeShellWord(value: string): string {
  return value.replace(/([\s'"\\$`!&;|<>()*?#[\]{}])/g, "\\$1");
}

function unescapeShellWord(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

/**
 * Lists what `word` can complete to, as a shell does: the folder part resolves against `cwd`
 * (or `~`, or `/`), and the last part is a name prefix. Dotfiles show only for a `.` prefix.
 */
export async function completePath(
  input: { cwd: string; word: string },
  home = os.homedir(),
): Promise<PathCompletion[]> {
  const typed = input.word;
  const slash = typed.lastIndexOf("/");
  // A leading `~` stays as typed in the result; only the lookup expands it.
  const typedDir = slash >= 0 ? typed.slice(0, slash + 1) : "";
  const prefix = unescapeShellWord(slash >= 0 ? typed.slice(slash + 1) : typed);
  const dir = unescapeShellWord(typedDir);
  const expanded = dir === "~/" || dir.startsWith("~/") ? path.join(home, dir.slice(2)) : dir;
  const lookup = path.resolve(input.cwd, expanded || ".");

  let entries: Dirent[];
  try {
    entries = await readdir(lookup, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = entries
    .filter((entry) => entry.name.startsWith(prefix))
    .filter((entry) => prefix.startsWith(".") || !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES);
  return Promise.all(
    matches.map(async (entry): Promise<PathCompletion> => {
      const isDirectory =
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (await isDir(path.join(lookup, entry.name))));
      const value = `${typedDir}${escapeShellWord(entry.name)}${isDirectory ? "/" : ""}`;
      return { value, kind: isDirectory ? "directory" : "file" };
    }),
  );
}

async function isDir(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
