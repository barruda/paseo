// CUSTOM(assistant-desk): the Projects Assistant chat (custom/plugins/power-workboard) lives in
// its own Desk (one reused tab), never as a tab of any other Desk or workspace pane. These are the
// pure rules; see custom/CHANGES.md.
import { AGENT_REPLACES_LABEL, findAgentSuccessor } from "@/task-navigation/agent-successor";

/** The label the plugin's `CHAT_LABEL` puts on the chat agent (value "true"). */
export const ASSISTANT_CHAT_LABEL = "pwb/assistant-chat";

export interface AssistantChatRef {
  serverId: string;
  agentId: string;
}

export interface AssistantAgentFacts {
  labels?: Readonly<Record<string, string>>;
  archivedAt?: Date | null;
  workspaceId?: string | null;
  /** Breaks ties between live chats without depending on the order of the map. */
  createdAt?: Date | null;
}

export function isAssistantChatAgent(agent: AssistantAgentFacts | undefined | null): boolean {
  return agent?.labels?.[ASSISTANT_CHAT_LABEL] === "true";
}

/**
 * A chat the assistant Desk owns. An archived chat is not one: its tab stays exactly where the
 * user opened it (Conversations' "Open in Desk") instead of being swept into the assistant Desk.
 */
export function isLiveAssistantChatAgent(agent: AssistantAgentFacts | undefined | null): boolean {
  return isAssistantChatAgent(agent) && !agent?.archivedAt;
}

/**
 * The chat the assistant Desk shows. The remembered chat while it is live; once it is archived, the
 * live agent that replaces it (a compaction, see CUSTOM(agent-successor)); else any live chat,
 * on `preferredServerId` first (a restart archives the old chat without naming it); else the
 * remembered chat as it is, so the tab shows the archived chat rather than nothing.
 */
export function resolveAssistantChat(input: {
  remembered: AssistantChatRef | null;
  agentsByServer: ReadonlyMap<string, ReadonlyMap<string, AssistantAgentFacts>>;
  preferredServerId: string | null;
  /**
   * Servers whose agent list has loaded. Only there does an unlisted remembered chat mean the
   * chat is gone; before that it may be the chat just created.
   */
  hydratedServerIds?: ReadonlySet<string>;
}): AssistantChatRef | null {
  const { remembered, agentsByServer, preferredServerId, hydratedServerIds } = input;
  if (remembered) {
    const agents = agentsByServer.get(remembered.serverId);
    // The session has not loaded this server yet: keep the remembered chat.
    if (!agents) return remembered;
    const agent = agents.get(remembered.agentId);
    if (agent && !agent.archivedAt) return remembered;
    if (agent) {
      const successor = findAgentSuccessor(agents, remembered.agentId);
      if (successor) return { serverId: remembered.serverId, agentId: successor.agentId };
    }
    // A chat the loaded list no longer has (the app restarted after a restart archived it), or
    // one archived without a named successor: fall through to a live chat, never staying on the
    // old one. An unloaded list may simply not show a chat created a moment ago, so it keeps it.
    if (hydratedServerIds && !hydratedServerIds.has(remembered.serverId)) return remembered;
  }
  // The remembered chat's server first, then the workspace's, then the rest.
  const first = [remembered?.serverId, preferredServerId].filter((id): id is string => !!id);
  const ordered = [...new Set([...first, ...agentsByServer.keys()])];
  for (const serverId of ordered) {
    const agents = agentsByServer.get(serverId);
    if (!agents) continue;
    const live = newestLiveChat(agents);
    if (live) return { serverId, agentId: live };
  }
  return remembered;
}

function newestLiveChat(agents: ReadonlyMap<string, AssistantAgentFacts>): string | null {
  let found: { agentId: string; createdAt: number } | null = null;
  for (const [agentId, agent] of agents) {
    if (agent.archivedAt || !isAssistantChatAgent(agent)) continue;
    const createdAt = agent.createdAt?.getTime() ?? 0;
    // Several live chats only happen in between a restart's create and archive; the later
    // created one is the newer. An id tie-break keeps the choice independent of the map's order.
    if (
      !found ||
      createdAt > found.createdAt ||
      (createdAt === found.createdAt && agentId > found.agentId)
    ) {
      found = { agentId, createdAt };
    }
  }
  return found?.agentId ?? null;
}

/**
 * CUSTOM(assistant-desk-newest): for an archived assistant chat, the live chat to go to instead.
 * Null unless the agent is an archived assistant chat and a different live chat exists.
 * `compacted` is true when some agent on the server names this one in AGENT_REPLACES_LABEL (the
 * plugin's automatic restart on the context limit).
 */
export function newerAssistantChat(input: {
  serverId: string;
  agentId: string;
  agentsByServer: ReadonlyMap<string, ReadonlyMap<string, AssistantAgentFacts>>;
  hydratedServerIds?: ReadonlySet<string>;
}): { chat: AssistantChatRef; compacted: boolean } | null {
  const { serverId, agentId, agentsByServer, hydratedServerIds } = input;
  const agents = agentsByServer.get(serverId);
  const agent = agents?.get(agentId);
  if (!agents || !agent || !isAssistantChatAgent(agent) || !agent.archivedAt) return null;
  const target = resolveAssistantChat({
    remembered: { serverId, agentId },
    agentsByServer,
    preferredServerId: serverId,
    hydratedServerIds,
  });
  if (!target || (target.serverId === serverId && target.agentId === agentId)) return null;
  const targetAgent = agentsByServer.get(target.serverId)?.get(target.agentId);
  if (!targetAgent || targetAgent.archivedAt) return null;
  let compacted = false;
  for (const other of agents.values()) {
    if (other.labels?.[AGENT_REPLACES_LABEL] === agentId) {
      compacted = true;
      break;
    }
  }
  return { chat: target, compacted };
}

/**
 * CUSTOM(assistant-desk-newest): the chat the assistant Desk's stale chat tab should switch to,
 * or null to leave the Desk alone. Nothing changes when `current` is already shown (an old chat
 * opened on purpose next to it stays) or the Desk has no chat tab; while the user is looking at
 * the Desk (`inView`) it only changes when `force` (the Desk just came into view).
 */
export function planAssistantDeskRefresh<
  T extends { serverId: string; target: { kind: string } },
>(input: {
  tabs: readonly T[];
  current: AssistantChatRef | null;
  isChatTab: (tab: T) => boolean;
  inView: boolean;
  force: boolean;
}): AssistantChatRef | null {
  const { tabs, current, isChatTab, inView, force } = input;
  if (!current) return null;
  if (inView && !force) return null;
  const shown = tabs.some(
    (tab) =>
      tab.serverId === current.serverId &&
      tab.target.kind === "agent" &&
      (tab.target as { agentId?: string }).agentId === current.agentId,
  );
  if (shown) return null;
  return tabs.some(isChatTab) ? current : null;
}
