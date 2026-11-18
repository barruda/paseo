import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { resolveBase } from "./assistant/task-git";
const execute = promisify(execFile);

/** Read only: never fetch, stash, commit, push, or remove a worktree. */
export async function checkGitSafety(
  directory: string,
  isGit: boolean,
  policyBase: string | null = null,
): Promise<string | null> {
  try {
    if (!isAbsolute(directory) || !(await stat(directory)).isDirectory())
      return "directory-unavailable";
  } catch {
    return "directory-unavailable";
  }
  const git = async (...args: string[]) =>
    (
      await execute("git", ["-C", directory, ...args], {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      })
    ).stdout.trim();
  try {
    try {
      await git("rev-parse", "--show-toplevel");
    } catch (error) {
      const stderr =
        error && typeof error === "object" && "stderr" in error
          ? String(error.stderr)
          : "";
      return !isGit && stderr.includes("not a git repository")
        ? null
        : "git-unknown";
    }
    if (await git("status", "--porcelain=v1", "--untracked-files=all"))
      return "git-dirty";
    let branch: string;
    try {
      branch = await git("symbolic-ref", "--quiet", "--short", "HEAD");
    } catch {
      return "git-detached";
    }
    // Work already contained in the task's base branch is safe, upstream or not.
    // Exit 1 means "not an ancestor"; any other failure means the base is unusable.
    let unmerged = false;
    const base = await resolveBase(directory, policyBase);
    if (base) {
      try {
        await git("merge-base", "--is-ancestor", "HEAD", base.ref);
        return null;
      } catch (error) {
        unmerged =
          !!error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 1;
      }
    }
    const noUpstream = unmerged ? "git-unmerged" : "git-no-upstream";
    let remote: string;
    let merge: string;
    try {
      await git("rev-parse", "--verify", "@{upstream}");
      remote = await git("config", `branch.${branch}.remote`);
      merge = await git("config", `branch.${branch}.merge`);
    } catch {
      return noUpstream;
    }
    if (remote === ".") return noUpstream;
    if (Number(await git("rev-list", "--count", "@{upstream}..HEAD")) > 0)
      return "git-unpushed";
    // A stale tracking ref is insufficient evidence that the branch still exists remotely.
    const remoteTip = (
      await git("ls-remote", "--exit-code", remote, merge)
    ).split(/\s/)[0];
    if (remoteTip !== (await git("rev-parse", "@{upstream}")))
      return "git-unknown";
    return null;
  } catch {
    return "git-unknown";
  }
}
