import type { OpenInSidePanePreferences } from "@/hooks/use-settings";
import { openDeskTargetInMainContent } from "@/task-navigation/open-desk-target";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface OpenSubagentTabInput {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
  preferences: OpenInSidePanePreferences;
  parentTabId?: string | null;
}

/**
 * Opens a subagent row's target as a tab and focuses it. In Tasks mode the Desk owns the tabs, so
 * the open goes there first; a tab placed in the workspace layout would never render.
 */
export function openSubagentTab(input: OpenSubagentTabInput): string | null {
  // CUSTOM(desks): same bridge as the other supporting views (see open-supporting-view.ts), in
  // the main content so a focused bottom-panel terminal does not take the subagent tab.
  const deskTabId = openDeskTargetInMainContent({
    workspaceKey: input.workspaceKey,
    target: input.target,
  });
  if (deskTabId) return deskTabId;
  return openPreferredWorkspaceTarget({
    workspaceKey: input.workspaceKey,
    target: input.target,
    source: "subagents",
    preferences: input.preferences,
    parentTabId: input.parentTabId,
  });
}
