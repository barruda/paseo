// CUSTOM(commit-selection): a commit waits when the list on screen is behind the working tree.
import { useCallback } from "react";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { changesDifferFromList } from "./model";

/**
 * Resolves true when the list matches the daemon's current changes. Otherwise it
 * alerts the user, refreshes the list, and resolves false so the commit stops.
 */
export function useCommitGuard(input: {
  serverId: string;
  cwd: string;
  files: readonly ParsedDiffFile[];
  ignoreWhitespace: boolean;
  onRefresh: () => void;
}): () => Promise<boolean> {
  const { serverId, cwd, files, ignoreWhitespace, onRefresh } = input;
  const client = useHostRuntimeClient(serverId);
  return useCallback(async () => {
    if (!client) return true;
    const current = await client.getCheckoutDiff(cwd, { mode: "uncommitted", ignoreWhitespace });
    if (current.error || !changesDifferFromList(files, current.files)) return true;
    onRefresh();
    await confirmDialog({
      title: "Changes changed since last sync",
      message:
        "Files changed since this list was loaded. The list is refreshed; review it, then commit again.",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
    });
    return false;
  }, [client, cwd, files, ignoreWhitespace, onRefresh]);
}
