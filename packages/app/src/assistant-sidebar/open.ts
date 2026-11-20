// CUSTOM(assistant-desk): every way to the Projects Assistant chat ends here. The chat has its own
// Desk (ASSISTANT_DESK_ID) that always reuses the same tab; this selects it and shows the last
// workspace's route so the Desk screen is on screen.
import { focusChatComposer } from "@/chat-esc-focus/registry";
import { isWeb } from "@/constants/platform";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import {
  ASSISTANT_DESK_ID,
  deskTabs,
  useDesksStore,
  type DeskTab,
  type DeskTabInput,
} from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import {
  isAssistantChatAgent,
  isLiveAssistantChatAgent,
  planAssistantDeskRefresh,
  resolveAssistantChat,
  type AssistantChatRef,
} from "./model";
import { assistantAgentMaps } from "./session-agent-maps";
import { useAssistantSidebarStore } from "./store";

export function sessionAgent(serverId: string, agentId: string) {
  const session = useSessionStore.getState().sessions[serverId];
  return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
}

/**
 * Whether the session knows this agent as a live Projects Assistant chat. An archived chat is
 * left to ordinary navigation: it opens as the normal tab the user asked for.
 */
export function isAssistantChatInSession(serverId: string, agentId: string): boolean {
  const agent = sessionAgent(serverId, agentId);
  return isLiveAssistantChatAgent(agent);
}

/** The chat the assistant Desk shows right now; see resolveAssistantChat. */
export function currentAssistantChat(preferredServerId: string | null): AssistantChatRef | null {
  const { agentsByServer, hydratedServerIds } = assistantAgentMaps(
    useSessionStore.getState().sessions,
  );
  return resolveAssistantChat({
    remembered: useAssistantSidebarStore.getState().chat,
    agentsByServer,
    preferredServerId,
    hydratedServerIds,
  });
}

/** The tab input that shows `chat` in the assistant Desk. */
export function assistantChatTab(chat: AssistantChatRef, workspaceId: string): DeskTabInput {
  return {
    serverId: chat.serverId,
    workspaceId,
    target: { kind: "agent", agentId: chat.agentId },
  };
}

/**
 * Whether a tab of the assistant Desk is a chat tab: an agent tab of any assistant chat the
 * session knows (live or archived), or of the previously remembered chat.
 */
export function isAssistantChatTab(tab: DeskTab, remembered: AssistantChatRef | null): boolean {
  if (tab.target.kind !== "agent") return false;
  const { agentId } = tab.target;
  if (remembered && remembered.serverId === tab.serverId && remembered.agentId === agentId) {
    return true;
  }
  return isAssistantChatAgent(sessionAgent(tab.serverId, agentId));
}

/** Puts `chat` in the assistant Desk and selects it. False when the session lacks its workspace. */
export function showAssistantChatFor(chat: AssistantChatRef, remembered: AssistantChatRef | null) {
  const workspaceId = sessionAgent(chat.serverId, chat.agentId)?.workspaceId;
  if (!workspaceId) return false;
  useDesksStore.getState().showAssistantChat({
    tab: assistantChatTab(chat, workspaceId),
    isChatTab: (tab) => isAssistantChatTab(tab, remembered),
  });
  return true;
}

const FOCUS_RETRY_MS = 100;
const FOCUS_GIVE_UP_MS = 3000;

/** Focuses the chat's composer once its tab has mounted it. */
function focusComposerSoon(preferredServerId: string | null): void {
  const startedAt = Date.now();
  const attempt = () => {
    const chat = currentAssistantChat(preferredServerId);
    if (chat && focusChatComposer(chat.serverId, chat.agentId)) return;
    if (Date.now() - startedAt < FOCUS_GIVE_UP_MS) setTimeout(attempt, FOCUS_RETRY_MS);
  };
  setTimeout(attempt, FOCUS_RETRY_MS);
}

/**
 * Shows the Projects Assistant chat in its own Desk. `chat` is the chat to show; null keeps the
 * remembered one. Returns the route shown, or null when Tasks mode is off (the caller falls back
 * to ordinary navigation).
 */
export function openAssistantDesk(input: {
  chat: AssistantChatRef | null;
  focusComposer?: boolean;
}): string | null {
  const store = useAssistantSidebarStore.getState();
  const remembered = store.chat;
  const chat = input.chat ?? currentAssistantChat(null);
  if (chat) store.setChat(chat);
  if (!useTaskNavigationStore.getState().enabled) return null;
  let chatWorkspaceId: string | undefined;
  if (chat) {
    chatWorkspaceId = sessionAgent(chat.serverId, chat.agentId)?.workspaceId ?? undefined;
    if (chatWorkspaceId) {
      showAssistantChatFor(chat, remembered);
      store.setPending(null);
    } else {
      // Created a moment ago: the session does not list it yet; useAssistantTabSweep finishes.
      store.setPending(chat);
      useDesksStore.getState().selectAssistantDesk();
    }
  } else {
    useDesksStore.getState().selectAssistantDesk();
  }
  // The board chip covers the Desks.
  useDeskWorkboardStore.getState().deselect();
  const last =
    getLastWorkspaceSelection() ??
    (chat && chatWorkspaceId ? { serverId: chat.serverId, workspaceId: chatWorkspaceId } : null);
  let route = "";
  if (last) {
    route = buildHostWorkspaceRoute(last.serverId, last.workspaceId);
    navigateToHostWorkspaceRoute(route);
  }
  // Web only: a keyboard popping up on a phone is not wanted.
  if ((input.focusComposer ?? true) && isWeb) {
    focusComposerSoon(chat?.serverId ?? null);
  }
  return route;
}

/**
 * CUSTOM(assistant-desk-newest): whether the user is looking at the assistant Desk: Tasks mode on,
 * the Desk active and the board chip (which covers the Desks) not selected.
 */
export function isAssistantDeskInView(): boolean {
  return (
    useTaskNavigationStore.getState().enabled &&
    useDesksStore.getState().activeDeskId === ASSISTANT_DESK_ID &&
    useDeskWorkboardStore.getState().selected === null
  );
}

/**
 * CUSTOM(assistant-desk-newest): points the assistant Desk's stale chat tab at the newest live chat
 * (state-based, see planAssistantDeskRefresh) without selecting the Desk. Returns whether it could
 * decide: false while Tasks mode is off, the Desk is missing, or the chat's session has not
 * loaded its agents, so the caller can retry.
 */
export function refreshAssistantDesk(input: { force: boolean }): boolean {
  if (!useTaskNavigationStore.getState().enabled) return false;
  const desk = useDesksStore.getState().desks.find((entry) => entry.id === ASSISTANT_DESK_ID);
  if (!desk) return false;
  const current = currentAssistantChat(null);
  if (!current) return false;
  if (!useSessionStore.getState().sessions[current.serverId]?.hasHydratedAgents) return false;
  if (!isAssistantChatInSession(current.serverId, current.agentId)) return true;
  const workspaceId = sessionAgent(current.serverId, current.agentId)?.workspaceId;
  if (!workspaceId) return false;
  const remembered = useAssistantSidebarStore.getState().chat;
  const isChatTab = (tab: DeskTab) => isAssistantChatTab(tab, remembered);
  const target = planAssistantDeskRefresh({
    tabs: deskTabs(desk),
    current,
    isChatTab,
    inView: isAssistantDeskInView(),
    force: input.force,
  });
  if (target) {
    useDesksStore
      .getState()
      .showAssistantChat({ tab: assistantChatTab(target, workspaceId), isChatTab, select: false });
    useAssistantSidebarStore.getState().setChat(target);
  }
  return true;
}
