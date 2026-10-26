import { execFile } from "node:child_process";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";

// CUSTOM(worktree-pill-merged): for agents whose status summary says the work is done, checks
// every few seconds whether their worktree is already merged into the main checkout, and records
// it as `merged` on the summary. The Worktree pill then turns green with a check. "Merged" means
// what the pill's Merge action produces: the worktree is clean and its HEAD is contained in the
// HEAD of the main checkout (whatever branch that has checked out, not the repo's default).
// New changes in the worktree make it dirty or move its HEAD past the main checkout, so the mark
// goes away until the next merge.

const POLL_MS = 10_000;
const GIT_TIMEOUT_MS = 5_000;

export type WorktreeGit = (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;

const runGit: WorktreeGit = (cwd, args) =>
  new Promise((resolve) => {
    execFile(
      "git",
      args,
      // Reading status must not take the index lock an agent's own git commands need.
      { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
      (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }),
    );
  });

/**
 * Whether the linked worktree at `cwd` is clean and its HEAD is in the main checkout's HEAD.
 * Null when `cwd` is not a linked worktree or git fails.
 */
export async function readWorktreeMerged(
  cwd: string,
  git: WorktreeGit = runGit,
): Promise<boolean | null> {
  const dirs = await git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
  ]);
  if (!dirs.ok) return null;
  const [gitDir, commonDir] = dirs.stdout.trim().split("\n");
  if (!gitDir || !commonDir || gitDir === commonDir) return null;
  const status = await git(cwd, ["status", "--porcelain"]);
  if (!status.ok) return null;
  if (status.stdout.trim()) return false;
  // The common dir's HEAD is the main checkout's HEAD.
  const mainHead = await git(cwd, ["--git-dir", commonDir, "rev-parse", "HEAD"]);
  if (!mainHead.ok || !mainHead.stdout.trim()) return null;
  const ancestor = await git(cwd, ["merge-base", "--is-ancestor", "HEAD", mainHead.stdout.trim()]);
  return ancestor.ok;
}

export interface WorktreeMergeStatusOptions {
  agentManager: Pick<AgentManager, "listAgents" | "getStatusSummary" | "setStatusSummary">;
  logger: pino.Logger;
  git?: WorktreeGit;
  pollMs?: number;
}

export class WorktreeMergeStatus {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly options: WorktreeMergeStatusOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.options.pollMs ?? POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const { agentManager, logger } = this.options;
    try {
      for (const agent of agentManager.listAgents()) {
        if (!agentManager.getStatusSummary(agent.id)?.done) continue;
        const merged = (await readWorktreeMerged(agent.cwd, this.options.git)) === true;
        // The summary may have been rewritten while git ran.
        const current = agentManager.getStatusSummary(agent.id);
        if (!current?.done || (current.merged ?? false) === merged) continue;
        agentManager.setStatusSummary(agent.id, { ...current, merged });
      }
    } catch (error) {
      logger.warn({ err: error }, "worktree merge status failed");
    } finally {
      this.polling = false;
    }
  }
}
