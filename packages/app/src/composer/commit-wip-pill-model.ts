// CUSTOM(commit-wip): what the Commit: wip pill offers next. After a commit it offers Git push,
// until the checkout changes again. Nothing here watches files: the pill reads the `!<command>`
// card's status from the agent's stream and `isDirty` from the workspace descriptor the daemon
// already sends.
import type { StreamItem } from "@/types/stream";

/** The shell-command plugin's `/wip` runs the same command (custom/plugins/shell-command/client/shortcut-commands.ts). */
export const COMMIT_WIP_COMMAND = "git add . && git commit -m 'wip'";
export const GIT_PUSH_COMMAND = "git push";

export type CommitWipStep = "commit" | "push";
export type ShellCommandOutcome = "running" | "succeeded" | "failed";

const SHELL_COMMAND_PLUGIN_ID = "shell-command";
// A run's card lands near the end of the stream; looking further back only costs time.
const SCAN_LIMIT = 40;

export const COMMIT_WIP_STEP_COMMAND: Record<CommitWipStep, string> = {
  commit: COMMIT_WIP_COMMAND,
  push: GIT_PUSH_COMMAND,
};

/** A checkout that is clean with commits the remote lacks opens on Git push. */
export function initialCommitWipStep(input: {
  isDirty: boolean | null;
  aheadOfOrigin: number | null;
}): CommitWipStep {
  return input.isDirty === false && (input.aheadOfOrigin ?? 0) > 0 ? "push" : "commit";
}

export interface ShellCommandRun {
  id: string;
  status: string;
  exitCode: number | null;
}

/** The newest card of `command` among the last items of the agent's stream (head first). */
export function findLatestShellCommandRun(
  lists: readonly (readonly StreamItem[] | undefined)[],
  command: string,
): ShellCommandRun | null {
  let scanned = 0;
  for (const items of lists) {
    if (!items) continue;
    for (let index = items.length - 1; index >= 0 && scanned < SCAN_LIMIT; index--, scanned++) {
      const item = items[index];
      if (item?.kind !== "plugin" || item.pluginId !== SHELL_COMMAND_PLUGIN_ID) continue;
      const data = item.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (data.command !== command || typeof data.id !== "string") continue;
      return {
        id: data.id,
        status: typeof data.status === "string" ? data.status : "running",
        exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
      };
    }
  }
  return null;
}

/** How the run started after `previousId` (the newest card when the pill was pressed) went. */
export function shellCommandOutcome(
  run: ShellCommandRun | null,
  previousId: string | null,
): ShellCommandOutcome {
  if (!run || run.id === previousId || run.status === "running") return "running";
  return run.status === "completed" && run.exitCode === 0 ? "succeeded" : "failed";
}

/** A good commit offers Git push and a good push offers Commit: wip; a failure offers a retry. */
export function stepAfterRun(step: CommitWipStep, outcome: ShellCommandOutcome): CommitWipStep {
  if (outcome !== "succeeded") return step;
  return step === "commit" ? "push" : "commit";
}
