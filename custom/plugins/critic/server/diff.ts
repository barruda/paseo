import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fitText, MAX_DIFF_CHARS } from "../shared/review";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/** `git status --short` plus `git diff HEAD`, cut to fit; a note when cwd is not a checkout. */
export async function readWorkspaceDiff(cwd: string): Promise<string> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return "(The workspace is not a git checkout: no diff.)";
  }
  const status = await git(cwd, ["status", "--short"]);
  if (!status.trim()) return "(No uncommitted changes.)";
  let diff: string;
  try {
    diff = await git(cwd, ["diff", "HEAD"]);
  } catch {
    // A repository without commits has no HEAD.
    diff = await git(cwd, ["diff", "--cached"]);
  }
  const untracked = status
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3));
  return fitText(
    [
      "git status --short:",
      status.trimEnd(),
      untracked.length
        ? "\n(Untracked files are listed above; their content is not in the diff.)"
        : "",
      "",
      diff.trimEnd(),
    ].join("\n"),
    MAX_DIFF_CHARS,
  );
}
