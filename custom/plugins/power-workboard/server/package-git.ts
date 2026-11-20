// CUSTOM(packages): the git primitives a package's optional integration branch needs. The merge
// itself goes through the daemon's own merge RPC; this file only creates the branch, reads a ref
// and lends the branch to a temporary worktree so that merge can run from it.
import { rm } from "node:fs/promises";
import { runGit, type GitExec } from "./package-gate";

export interface PackageGitOps {
  /** Creates `branch` at `base` when it does not exist; leaves an existing branch alone. */
  ensureBranch(
    projectDirectory: string,
    branch: string,
    base: string,
  ): Promise<"created" | "exists">;
  /** The commit a ref points at, or null when the ref does not exist. */
  refCommit(projectDirectory: string, ref: string): Promise<string | null>;
  /** Whether git accepts the name as a branch (`check-ref-format --branch`). */
  validBranch(projectDirectory: string, branch: string): Promise<boolean>;
  /** Adds (or replaces) a worktree checked out on the branch. */
  addWorktree(
    projectDirectory: string,
    worktree: string,
    branch: string,
  ): Promise<void>;
  /** Removes a worktree added by `addWorktree`; a missing one is not an error. */
  removeWorktree(projectDirectory: string, worktree: string): Promise<void>;
  /**
   * Merges `source` into `branch` in a temporary worktree, without touching the project's
   * checkout. A conflict aborts the merge and throws the git error.
   */
  mergeIntoBranch(
    projectDirectory: string,
    worktree: string,
    branch: string,
    source: string,
  ): Promise<void>;
}

export function packageGitOps(exec: GitExec = runGit): PackageGitOps {
  const exists = async (projectDirectory: string, ref: string) => {
    try {
      await exec([
        "-C",
        projectDirectory,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${ref}`,
      ]);
      return true;
    } catch {
      return false;
    }
  };
  return {
    async ensureBranch(projectDirectory, branch, base) {
      if (await exists(projectDirectory, branch)) return "exists";
      await exec(["-C", projectDirectory, "branch", branch, base]);
      return "created";
    },
    async refCommit(projectDirectory, ref) {
      try {
        return (
          await exec([
            "-C",
            projectDirectory,
            "rev-parse",
            "--verify",
            `${ref}^{commit}`,
          ])
        ).trim();
      } catch {
        return null;
      }
    },
    async validBranch(projectDirectory, branch) {
      try {
        await exec([
          "-C",
          projectDirectory,
          "check-ref-format",
          "--branch",
          branch,
        ]);
        return true;
      } catch {
        return false;
      }
    },
    async addWorktree(projectDirectory, worktree, branch) {
      await exec([
        "-C",
        projectDirectory,
        "worktree",
        "remove",
        "--force",
        worktree,
      ]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true }).catch(
        () => undefined,
      );
      await exec([
        "-C",
        projectDirectory,
        "worktree",
        "add",
        "--force",
        worktree,
        branch,
      ]);
    },
    async removeWorktree(projectDirectory, worktree) {
      await exec([
        "-C",
        projectDirectory,
        "worktree",
        "remove",
        "--force",
        worktree,
      ]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true }).catch(
        () => undefined,
      );
    },
    async mergeIntoBranch(projectDirectory, worktree, branch, source) {
      await this.addWorktree(projectDirectory, worktree, branch);
      try {
        await exec(["-C", worktree, "merge", "--no-edit", source]);
      } catch (error) {
        await exec(["-C", worktree, "merge", "--abort"]).catch(() => undefined);
        throw error;
      } finally {
        await this.removeWorktree(projectDirectory, worktree);
      }
    },
  };
}
