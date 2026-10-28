import {
  getLastWorkspaceSelection,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import type { HistorySearchTabTarget } from "@/workspace-tabs/model";

// CUSTOM(history-search-tabs): a search made on the History screen becomes a tab in the last
// workspace, or in the current Desk in Tasks mode, and the app goes there.

/** False when there is no workspace to hold the tab; History then shows the results itself. */
export function openHistorySearchTab(target: HistorySearchTabTarget): boolean {
  const selection = getLastWorkspaceSelection();
  if (!selection) return false;
  navigateToWorkspace({ ...selection, target });
  return true;
}
