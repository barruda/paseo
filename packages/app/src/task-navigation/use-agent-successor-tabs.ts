// CUSTOM(agent-successor): mounted once for the whole app. When an agent with a successor (see
// agent-successor.ts) is archived, its Desk and workspace tabs switch to the successor and its
// composer draft moves along. It runs in a store subscription, before React renders the archive,
// so the Desk's archive-close (desk-screen.tsx) and the workspace tab pruning never see the tab.
import { useEffect } from "react";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  type AgentSuccessorFollow,
  draftToCarry,
  planAgentSuccessorFollows,
} from "./agent-successor";
import { detectNewlyArchived } from "./desk-archive-close";
import { isAssistantDeskInView } from "@/assistant-sidebar/open"; // CUSTOM(assistant-desk-newest)
import { ASSISTANT_DESK_ID, useDesksStore } from "./desks-store";

function carryDraft({ serverId, fromAgentId, toAgentId }: AgentSuccessorFollow): void {
  const drafts = useDraftStore.getState();
  const fromKey = buildDraftStoreKey({ serverId, agentId: fromAgentId });
  const toKey = buildDraftStoreKey({ serverId, agentId: toAgentId });
  const draft = draftToCarry(drafts.getDraftInput(fromKey), drafts.getDraftInput(toKey));
  if (!draft) return;
  drafts.saveDraftInput({ draftKey: toKey, draft });
  drafts.clearDraftInput({ draftKey: fromKey, lifecycle: "abandoned" });
}

function followWorkspaceTabs(follow: AgentSuccessorFollow): void {
  const { serverId, fromAgentId, toAgentId, toWorkspaceId } = follow;
  const layouts = useWorkspaceLayoutStore.getState();
  for (const workspaceKey of Object.keys(layouts.layoutByWorkspace)) {
    if (!workspaceKey.startsWith(`${serverId}:`)) continue;
    // A successor in another workspace would be pruned from this one; the tab keeps the old agent.
    if (toWorkspaceId && workspaceKey !== `${serverId}:${toWorkspaceId}`) continue;
    const tabs = layouts.getWorkspaceTabs(workspaceKey);
    const agentTabs = (agentId: string) =>
      tabs.filter((tab) => tab.target.kind === "agent" && tab.target.agentId === agentId);
    const followed = agentTabs(fromAgentId);
    if (followed.length === 0) continue;
    let showsSuccessor = agentTabs(toAgentId).length > 0;
    for (const tab of followed) {
      if (showsSuccessor) {
        layouts.closeTab(workspaceKey, tab.tabId);
        continue;
      }
      layouts.replaceTab(workspaceKey, tab.tabId, { kind: "agent", agentId: toAgentId });
      showsSuccessor = true;
    }
    // A pinned archived agent would get its tab back on the next reconcile.
    layouts.unpinAgent(workspaceKey, fromAgentId);
  }
}

export function followAgentSuccessor(follow: AgentSuccessorFollow): void {
  // The draft moves first, so the successor's composer finds it when it mounts.
  carryDraft(follow);
  useDesksStore.getState().followAgentTabs({
    serverId: follow.serverId,
    from: follow.fromAgentId,
    to: follow.toAgentId,
    toWorkspaceId: follow.toWorkspaceId,
    // CUSTOM(assistant-desk-newest): while the user reads the assistant Desk, the old tab stays
    // and the archived callout offers the new session.
    exceptDeskIds: isAssistantDeskInView() ? [ASSISTANT_DESK_ID] : undefined,
  });
  followWorkspaceTabs(follow);
}

export function useAgentSuccessorTabs(): void {
  useEffect(() => {
    let seen = new Map<string, boolean>();
    // The session store changes many times a second while agents stream; rescan only when an
    // agents map was replaced.
    let lastMaps: unknown[] = [];
    const check = () => {
      const byServer = new Map<string, ReadonlyMap<string, Agent>>();
      for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
        if (session.hasHydratedAgents) byServer.set(serverId, session.agents);
      }
      const maps = [...byServer.values()];
      if (maps.length === lastMaps.length && maps.every((map, index) => map === lastMaps[index]))
        return;
      lastMaps = maps;
      const { next, newlyArchived } = detectNewlyArchived(seen, byServer);
      seen = next;
      if (newlyArchived.length === 0) return;
      for (const follow of planAgentSuccessorFollows(newlyArchived, byServer).follows) {
        try {
          followAgentSuccessor(follow);
        } catch (error) {
          console.warn("[AgentSuccessor] Could not move the tabs to the new agent", {
            follow,
            error,
          });
        }
      }
    };
    check();
    return useSessionStore.subscribe(check);
  }, []);
}
