// CUSTOM(assistant-sidebar): the Projects Assistant chat never stays as a tab of its own. Tabs
// restored from storage close silently; a tab some path opens later (a row of the Tasks sidebar,
// a launcher that reaches the Desk directly) closes and the sidebar tab shows instead.
import type { AssistantChatRef } from "./model";

interface SweepTarget {
  kind: string;
  agentId?: string;
}

export interface SweepDeskTab {
  id: string;
  serverId: string;
  target: SweepTarget;
}

export interface SweepLayoutTab {
  workspaceKey: string;
  tabId: string;
  target: SweepTarget;
}

export interface AssistantTabSweep {
  deskTabIds: string[];
  layoutTabs: { workspaceKey: string; tabId: string; agentId: string }[];
  /** The chat a new tab asked for, to show in the sidebar instead. */
  reveal: AssistantChatRef | null;
}

export const deskTabKey = (tabId: string) => `desk:${tabId}`;
export const layoutTabKey = (workspaceKey: string, tabId: string) =>
  `layout:${workspaceKey}:${tabId}`;

function serverOf(workspaceKey: string): string {
  return workspaceKey.slice(0, workspaceKey.indexOf(":"));
}

export function tabKeys(input: {
  deskTabs: readonly SweepDeskTab[];
  layoutTabs: readonly SweepLayoutTab[];
}): Set<string> {
  return new Set([
    ...input.deskTabs.map((tab) => deskTabKey(tab.id)),
    ...input.layoutTabs.map((tab) => layoutTabKey(tab.workspaceKey, tab.tabId)),
  ]);
}

/**
 * `known` holds the keys of tabs that were already there when the app started. Tabs that went
 * away drop out, so a tab that comes back with the same key counts as newly opened and reveals
 * the sidebar instead of closing silently.
 */
export function pruneKnownTabs(
  known: ReadonlySet<string>,
  input: { deskTabs: readonly SweepDeskTab[]; layoutTabs: readonly SweepLayoutTab[] },
): Set<string> {
  const present = tabKeys(input);
  return new Set([...known].filter((key) => present.has(key)));
}

/** `known` holds the keys of tabs that were already there when the app started. */
export function planAssistantTabSweep(input: {
  deskTabs: readonly SweepDeskTab[];
  layoutTabs: readonly SweepLayoutTab[];
  isAssistant: (serverId: string, agentId: string) => boolean;
  known: ReadonlySet<string>;
}): AssistantTabSweep {
  const plan: AssistantTabSweep = { deskTabIds: [], layoutTabs: [], reveal: null };
  for (const tab of input.deskTabs) {
    const agentId = tab.target.kind === "agent" ? tab.target.agentId : undefined;
    if (!agentId || !input.isAssistant(tab.serverId, agentId)) continue;
    plan.deskTabIds.push(tab.id);
    if (!input.known.has(deskTabKey(tab.id))) plan.reveal = { serverId: tab.serverId, agentId };
  }
  for (const tab of input.layoutTabs) {
    const agentId = tab.target.kind === "agent" ? tab.target.agentId : undefined;
    const serverId = serverOf(tab.workspaceKey);
    if (!agentId || !input.isAssistant(serverId, agentId)) continue;
    plan.layoutTabs.push({ workspaceKey: tab.workspaceKey, tabId: tab.tabId, agentId });
    if (!input.known.has(layoutTabKey(tab.workspaceKey, tab.tabId))) {
      plan.reveal = { serverId, agentId };
    }
  }
  return plan;
}
