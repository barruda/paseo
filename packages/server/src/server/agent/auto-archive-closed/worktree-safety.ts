// CUSTOM(auto-archive-worktrees): the git half of the worktree archive rule. Read-only: a worktree
// is safe to remove only when nothing in it is uncommitted and its HEAD is already in the base.
import { stat } from "node:fs/promises";
import { runGitCommand } from "../../../utils/run-git-command.js";

const GIT_TIMEOUT_MS = 30_000;
const GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const result = await runGitCommand(args, {
      cwd,
      envOverlay: GIT_ENV,
      timeout: GIT_TIMEOUT_MS,
      acceptExitCodes: [0, 1],
    });
    return { ok: result.exitCode === 0, stdout: result.stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * True when the worktree directory exists, has no modified or untracked files (ignored files such
 * as node_modules do not count), and HEAD is an ancestor of `baseRef`. Anything unresolvable is
 * false: unmerged work is never archived.
 */
export async function isWorktreeSafeToArchive(input: {
  worktreeRoot: string;
  baseRef: string | null;
}): Promise<boolean> {
  const { worktreeRoot, baseRef } = input;
  if (!baseRef) return false;
  try {
    if (!(await stat(worktreeRoot)).isDirectory()) return false;
  } catch {
    return false;
  }
  const status = await git(worktreeRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok || status.stdout.trim() !== "") return false;
  const base = await git(worktreeRoot, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  if (!base.ok) return false;
  return (await git(worktreeRoot, ["merge-base", "--is-ancestor", "HEAD", base.stdout.trim()])).ok;
}
