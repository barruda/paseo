// CUSTOM(assistant-desk): the Explorer's Projects Assistant tab is a view of the assistant Desk,
// not a second chat. It shows the Desk's focused agent tab, so a new chat, a compaction successor
// or a restart swaps the chat in the same Explorer tab. See custom/CHANGES.md.
import { findPaneById } from "@/stores/workspace-layout-actions";
import {
  ASSISTANT_DESK_ID,
  deskTabs,
  type Desk,
  type DeskTab,
} from "@/task-navigation/desks-store";

export interface AssistantMirrorChat {
  serverId: string;
  agentId: string;
}

function chatOf(tab: DeskTab | undefined): AssistantMirrorChat | null {
  if (!tab || tab.target.kind !== "agent") return null;
  return { serverId: tab.serverId, agentId: tab.target.agentId };
}

/**
 * The chat the assistant Desk shows right now: its focused tab when that is an agent tab, else
 * the agent tab it focused last (a terminal or file in front of the chat), else any agent tab.
 * Null when the Desk is missing or has no agent tab.
 */
export function assistantDeskChat(desks: readonly Desk[]): AssistantMirrorChat | null {
  const desk = desks.find((entry) => entry.id === ASSISTANT_DESK_ID);
  if (!desk) return null;
  const tabs = deskTabs(desk);
  const focusedTabId = findPaneById(desk.layout.root, desk.layout.focusedPaneId)?.focusedTabId;
  const focused = tabs.find((tab) => tab.id === focusedTabId);
  const remembered = desk.agentTabId ? tabs.find((tab) => tab.id === desk.agentTabId) : undefined;
  return (
    chatOf(focused) ?? chatOf(remembered) ?? tabs.map(chatOf).find((chat) => chat !== null) ?? null
  );
}
