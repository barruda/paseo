// CUSTOM(factory): the factory revision (docs/factory.md, "Loading and revisions"): git `HEAD`, plus
// `+dirty.<content hash>` while there are uncommitted changes. `--no-optional-locks` keeps git
// from rewriting `.git/index`, which the shadow watcher would take for a change.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["--no-optional-locks", ...args], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** null outside a git repository or before its first commit. */
export async function factoryRevision(root: string): Promise<string | null> {
  let head: string;
  try {
    head = (await git(root, "rev-parse", "HEAD")).trim();
  } catch {
    return null;
  }
  const status = await git(
    root,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  );
  if (!status) return head;
  const hash = createHash("sha256").update(status);
  // Entries are `XY path\0`; a rename adds its old path as the next entry.
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry[0] === "R" || entry[0] === "C") index++;
    const file = entry.slice(3);
    try {
      hash.update(file).update(await readFile(path.join(root, file)));
    } catch {
      hash.update(`${file}\0deleted`);
    }
  }
  return `${head}+dirty.${hash.digest("hex").slice(0, 12)}`;
}
