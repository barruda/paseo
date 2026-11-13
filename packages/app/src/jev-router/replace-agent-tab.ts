// CUSTOM(jev-router): puts a restarted session in the tab of the agent it replaces, instead of
// opening a new tab beside it. With Desks on, the tab lives in the desks store (any Desk); else in
// the workspace layout store. Returns false when no tab shows the old agent (the caller then opens
// the new agent the usual way).

import { deskTabs, useDesksStore } from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

interface ReplaceAgentTabInput {
  serverId: string;
  workspaceId: string;
  oldAgentId: string;
  newAgentId: string;
}

/**
 * Desks mode: retargets the desk tab showing the old agent (same kind, so it keeps its id, pane,
 * focus, owner and preview status) and moves the sidebar's "opened" sort entry to the new agent.
 * Nothing in the desks store closes tabs when an agent is archived, and the tab no longer points
 * at the old agent anyway.
 */
export function replaceDeskAgentTab(input: ReplaceAgentTabInput): boolean {
  const state = useDesksStore.getState();
  for (const desk of state.desks) {
    const tab = deskTabs(desk).find(
      (candidate) =>
        candidate.serverId === input.serverId &&
        candidate.target.kind === "agent" &&
        candidate.target.agentId === input.oldAgentId,
    );
    if (!tab) continue;
    state.updateTab(tab.id, {
      target: { kind: "agent", agentId: input.newAgentId },
      serverId: tab.serverId,
      workspaceId: tab.workspaceId,
    });
    const oldKey = `${input.serverId}:${input.oldAgentId}`;
    const { [oldKey]: _dropped, ...openedAt } = useDesksStore.getState().openedAt;
    useDesksStore.setState({
      openedAt: { ...openedAt, [`${input.serverId}:${input.newAgentId}`]: Date.now() },
    });
    return true;
  }
  return false;
}

export function replaceAgentTabInPlace(input: ReplaceAgentTabInput): boolean {
  if (useTaskNavigationStore.getState().enabled && replaceDeskAgentTab(input)) return true;
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (!workspaceKey) return false;
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[workspaceKey];
  if (!layout) return false;
  const oldTab = collectAllTabs(layout.root).find(
    (tab) => tab.target.kind === "agent" && tab.target.agentId === input.oldAgentId,
  );
  if (!oldTab) return false;
  // Same kind, so the tab keeps its id, pane position and focus; only its agent changes.
  return (
    store.replaceTab(workspaceKey, oldTab.tabId, { kind: "agent", agentId: input.newAgentId }) !==
    null
  );
}
