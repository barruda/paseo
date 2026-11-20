// CUSTOM(assistant-desk): the live Projects Assistant chat only stays as a tab of its own Desk
// (ASSISTANT_DESK_ID). Its tabs anywhere else are closed: tabs restored from storage silently, a
// tab some path opens later (a launcher that reaches a Desk directly) closes and the assistant
// Desk shows the chat instead. The Explorer's `projects_assistant` tab is a mirror of the Desk, not
// a chat tab, so it is never swept. An archived chat is not swept either: opening it from
// Conversations shows that conversation in a normal tab.
import { ASSISTANT_DESK_ID } from "@/task-navigation/desks-store";
import { isLiveAssistantChatAgent, type AssistantAgentFacts, type AssistantChatRef } from "./model";

interface SweepTarget {
  kind: string;
  agentId?: string;
}

export interface SweepDeskTab {
  id: string;
  deskId: string;
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
  /** The chat a new tab asked for, to show in the assistant Desk instead. */
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
 * away drop out, so a tab that comes back with the same key counts as newly opened and asks for
 * the assistant Desk instead of closing silently.
 */
export function pruneKnownTabs(
  known: ReadonlySet<string>,
  input: { deskTabs: readonly SweepDeskTab[]; layoutTabs: readonly SweepLayoutTab[] },
): Set<string> {
  const present = tabKeys(input);
  return new Set([...known].filter((key) => present.has(key)));
}

/**
 * `known` holds the keys of tabs that were already there when the app started. Only tabs of a
 * live chat are swept, and never the ones inside the assistant Desk.
 */
export function planAssistantTabSweep(input: {
  deskTabs: readonly SweepDeskTab[];
  layoutTabs: readonly SweepLayoutTab[];
  agentFor: (serverId: string, agentId: string) => AssistantAgentFacts | undefined | null;
  known: ReadonlySet<string>;
  /** False outside Tasks mode, where there is no assistant Desk: chat tabs are left alone. */
  sweepChats?: boolean;
}): AssistantTabSweep {
  const plan: AssistantTabSweep = { deskTabIds: [], layoutTabs: [], reveal: null };
  const isAssistant = (serverId: string, agentId: string) =>
    input.sweepChats !== false && isLiveAssistantChatAgent(input.agentFor(serverId, agentId));
  for (const tab of input.deskTabs) {
    if (tab.deskId === ASSISTANT_DESK_ID) continue;
    const agentId = tab.target.kind === "agent" ? tab.target.agentId : undefined;
    if (!agentId || !isAssistant(tab.serverId, agentId)) continue;
    plan.deskTabIds.push(tab.id);
    if (!input.known.has(deskTabKey(tab.id))) plan.reveal = { serverId: tab.serverId, agentId };
  }
  for (const tab of input.layoutTabs) {
    // The Explorer's Projects Assistant tab mirrors the Desk; it is not a chat tab.
    if (tab.target.kind === "projects_assistant") continue;
    const agentId = tab.target.kind === "agent" ? tab.target.agentId : undefined;
    const serverId = serverOf(tab.workspaceKey);
    if (!agentId || !isAssistant(serverId, agentId)) continue;
    plan.layoutTabs.push({ workspaceKey: tab.workspaceKey, tabId: tab.tabId, agentId });
    if (!input.known.has(layoutTabKey(tab.workspaceKey, tab.tabId))) {
      plan.reveal = { serverId, agentId };
    }
  }
  return plan;
}
