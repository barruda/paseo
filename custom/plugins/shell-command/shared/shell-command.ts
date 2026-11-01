import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHELL_COMMAND_TIMELINE_KIND = "shell-command";
export const SHELL_COMMAND_TIMELINE_VERSION = 1;

export const shellCommandStatusSchema = z.enum(["running", "completed", "failed", "stopped"]);

export const shellCommandTimelineSchema = z.object({
  /** The timeline row id; the renderer needs it to stop the command. */
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  /** Lets Run again file the command under the same project history. Older rows lack it. */
  workspaceId: z.string().optional(),
  status: shellCommandStatusSchema,
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  output: z.string(),
  /**
   * True when the command runs in a pseudo-terminal: typed input is echoed and prompts that need a
   * terminal work. Rows recorded before input existed lack the field.
   */
  interactive: z.boolean().optional(),
  /** True when the head of the output was dropped to fit the timeline row size limit. */
  truncated: z.boolean(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type ShellCommandTimelineData = z.output<typeof shellCommandTimelineSchema>;

export const runShellCommandRpc = defineRpc({
  name: "run",
  input: z.object({
    agentId: z.string().min(1),
    cwd: z.string().min(1),
    command: z.string().min(1),
    /** Files the command under its workspace's project history. Without it, under `cwd`. */
    workspaceId: z.string().min(1).optional(),
  }),
  output: z.object({ id: z.string() }),
});

/** Commands run in the workspace's project (or `cwd` without a workspace), newest first. */
export const shellHistoryRpc = defineRpc({
  name: "history",
  input: z.object({
    cwd: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
  }),
  output: z.object({ commands: z.array(z.string()) }),
});

/**
 * Files and folders whose path starts with `word`, resolved against `cwd` like a shell would
 * (`~/`, absolute, relative). Each `value` replaces `word` as typed: shell-escaped, with a
 * trailing `/` on folders.
 */
export const completePathRpc = defineRpc({
  name: "complete-path",
  input: z.object({ cwd: z.string().min(1), word: z.string() }),
  output: z.object({
    entries: z.array(z.object({ value: z.string(), kind: z.enum(["file", "directory"]) })),
  }),
});

export const stopShellCommandRpc = defineRpc({
  name: "stop",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ stopped: z.boolean() }),
});

/** Writes to a running command's input. Send "\x03" for Ctrl-C and "\x04" for Ctrl-D. */
export const sendShellInputRpc = defineRpc({
  name: "input",
  input: z.object({ id: z.string().min(1), text: z.string().min(1) }),
  output: z.object({ accepted: z.boolean() }),
});

// CUSTOM(git-sync): what the composer's git chips need: unresolved conflicts, and on a main
// checkout the worktrees branched from its current branch that have work to bring in.
export const gitConflictsSchema = z.object({
  /** The checkout holding the conflicts (git's real path). */
  dir: z.string(),
  /** The operation in progress; null for conflicts left without one (a `git stash pop`). */
  operation: z.enum(["merge", "rebase", "cherry-pick", "revert"]).nullable(),
  /** The branch checked out there, null when detached (as during a rebase). */
  currentBranch: z.string().nullable(),
  /** What is coming in: the merged branch, the picked commit, or the rebase's target. */
  incoming: z.string().nullable(),
  files: z.array(z.string()),
});

export const incomingWorktreeSchema = z.object({
  path: z.string(),
  branch: z.string(),
  /** Commits on the worktree's branch that the main checkout's HEAD lacks. */
  ahead: z.number(),
  /** Uncommitted changes in the worktree. */
  dirty: z.boolean(),
});

export const gitSyncStatusSchema = z.object({
  /** True when `cwd` is a linked worktree (not the main checkout). */
  linkedWorktree: z.boolean(),
  /** Conflicts in `cwd`'s own checkout. */
  conflicts: gitConflictsSchema.nullable(),
  /**
   * For a linked worktree: conflicts in the main checkout from merging this worktree's branch
   * (what the Worktree chip's Merge action leaves behind when it conflicts).
   */
  mainConflicts: gitConflictsSchema.nullable(),
  /** For a main checkout on a branch: worktrees created from that branch with work to bring in. */
  incoming: z.array(incomingWorktreeSchema),
});

export type GitConflicts = z.output<typeof gitConflictsSchema>;
export type IncomingWorktree = z.output<typeof incomingWorktreeSchema>;
export type GitSyncStatus = z.output<typeof gitSyncStatusSchema>;

export const gitSyncRpc = defineRpc({
  name: "git-sync",
  input: z.object({ cwd: z.string().min(1) }),
  output: gitSyncStatusSchema,
});

// CUSTOM(git-sync): the "Check sync status between projects" card, posted in the chat.
export const SYNC_REPORT_TIMELINE_KIND = "sync-report";
export const SYNC_REPORT_TIMELINE_VERSION = 1;

const syncCommitSchema = z.object({ sha: z.string(), subject: z.string() });

const syncSideSchema = z.object({
  path: z.string(),
  /** Null when detached. */
  branch: z.string().nullable(),
  /** Files with uncommitted changes. */
  uncommitted: z.number(),
  /** Files with unresolved conflicts right now. */
  conflicts: z.array(z.string()),
});

const syncCommitsSchema = z.object({
  total: z.number(),
  /** Newest first, at most `SYNC_REPORT_COMMIT_LIMIT`. */
  commits: z.array(syncCommitSchema),
});

export const SYNC_REPORT_COMMIT_LIMIT = 8;

export const syncReportSchema = z.object({
  id: z.string(),
  checkedAt: z.string(),
  /** Set when the report could not be made; the other fields are then empty. */
  error: z.string().nullable(),
  worktree: syncSideSchema.nullable(),
  main: syncSideSchema.nullable(),
  /** Commits on the worktree's HEAD that the main checkout's HEAD lacks. */
  toMain: syncCommitsSchema,
  /** Commits on the main checkout's HEAD that the worktree's HEAD lacks. */
  fromMain: syncCommitsSchema,
  /** Files a merge of the two HEADs would conflict on (`git merge-tree`); null when unknown. */
  mergeConflicts: z.array(z.string()).nullable(),
});

export type SyncReportData = z.output<typeof syncReportSchema>;

export const syncReportRpc = defineRpc({
  name: "sync-report",
  input: z.object({ agentId: z.string().min(1), cwd: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});

export type SyncTone = "success" | "warning" | "danger" | "muted";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function syncHint(input: {
  behind: number;
  ahead: number;
  uncommitted: number;
  willConflict: boolean;
}): string {
  if (!input.behind) return "Merge back to main project to bring this work over.";
  if (!input.ahead && !input.uncommitted) return "Pull changes from main project to catch up.";
  return input.willConflict
    ? "Both sides moved and a merge will conflict: pull from main here first and resolve, then merge back."
    : "Both sides moved: pull changes from main project, then merge back to main project.";
}

/** The card's one-line verdict and what to do next. */
export function summarizeSync(data: SyncReportData): {
  headline: string;
  tone: SyncTone;
  hint: string | null;
} {
  if (data.error) return { headline: "Could not check", tone: "danger", hint: null };
  const conflicted = (data.worktree?.conflicts.length ?? 0) + (data.main?.conflicts.length ?? 0);
  if (conflicted > 0) {
    return {
      headline: `${plural(conflicted, "file")} in conflict`,
      tone: "danger",
      hint: "Resolve the conflicts first: the Worktree chip turns into Resolver conflitos.",
    };
  }
  const ahead = data.toMain.total;
  const behind = data.fromMain.total;
  const uncommitted = data.worktree?.uncommitted ?? 0;
  const parts = [
    ahead ? `${plural(ahead, "commit")} to bring to main` : null,
    behind ? `${plural(behind, "commit")} to pull from main` : null,
    uncommitted ? plural(uncommitted, "uncommitted file") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return { headline: "In sync", tone: "success", hint: null };
  const willConflict = (data.mergeConflicts?.length ?? 0) > 0;
  return {
    headline: parts.join(" · "),
    tone: willConflict ? "warning" : "muted",
    hint: syncHint({ behind, ahead, uncommitted, willConflict }),
  };
}
