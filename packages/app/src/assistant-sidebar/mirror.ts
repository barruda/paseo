// CUSTOM(assistant-desk): the Explorer's Project Manager tab is not a second chat. It shows the
// assistant Desk's focused agent tab when that Desk has one, so both views stay on the same chat;
// CUSTOM(pm-sidebar): else the current chat (remembered, its successor, or the newest live one),
// since the right sidebar is the chat's default place and the Desk may not exist. A new chat, a
// compaction successor or a restart swaps the chat in the same Explorer tab. See custom/CHANGES.md.
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

/** CUSTOM(pm-sidebar): the chat the Explorer's Project Manager tab shows. */
export function assistantSidebarChat(
  desks: readonly Desk[],
  current: AssistantMirrorChat | null,
): AssistantMirrorChat | null {
  return assistantDeskChat(desks) ?? current;
}
