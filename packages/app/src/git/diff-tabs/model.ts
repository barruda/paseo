// CUSTOM(changes-diff-tab): which open tab a Changes file click reuses.
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The diff tab to retarget at `target`, or null to open a new tab. Only a file diff opened from
 * the Changes tree (a working diff with a focus path) reuses a tab, and only when "Open in
 * different tabs" is off.
 */
export function findDiffTabToReuse<T extends { target: WorkspaceTabTarget }>(input: {
  tabs: readonly T[];
  target: WorkspaceTabTarget;
  openInNewTabs: boolean;
}): T | null {
  if (input.openInNewTabs) return null;
  if (input.target.kind !== "working_diff" || !input.target.focusPath) return null;
  return input.tabs.find((tab) => tab.target.kind === "working_diff") ?? null;
}
