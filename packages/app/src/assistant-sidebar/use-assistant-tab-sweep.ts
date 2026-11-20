// CUSTOM(assistant-desk): mounted once for the whole app; see sweep.ts. Also finishes the open of a
// chat the session did not list yet when it was opened (`pending`).
import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { ASSISTANT_DESK_ID, deskTabs, useDesksStore } from "@/task-navigation/desks-store";
import type { AssistantAgentFacts } from "./model";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { openAssistantDesk, sessionAgent, showAssistantChatFor } from "./open";
import { useAssistantSidebarStore } from "./store";
import {
  planAssistantTabSweep,
  pruneKnownTabs,
  tabKeys,
  type SweepDeskTab,
  type SweepLayoutTab,
} from "./sweep";

/** Shows the pending chat once the session lists its agent with a workspace. */
function finishPending(): void {
  const store = useAssistantSidebarStore.getState();
  const { pending } = store;
  if (!pending || !sessionAgent(pending.serverId, pending.agentId)?.workspaceId) return;
  store.setPending(null);
  const desks = useDesksStore.getState();
  const previousDeskId = desks.activeDeskId;
  showAssistantChatFor(pending, store.chat);
  // Selecting the Desk is only wanted if the user is still on it; otherwise stay where they are.
  if (previousDeskId !== ASSISTANT_DESK_ID) useDesksStore.getState().selectDesk(previousDeskId);
}

function collectTabs(): { deskTabs: SweepDeskTab[]; layoutTabs: SweepLayoutTab[] } {
  const desks = useDesksStore.getState().desks.flatMap((desk) =>
    deskTabs(desk).map((tab) => ({
      id: tab.id,
      serverId: tab.serverId,
      target: tab.target,
      deskId: desk.id,
    })),
  );
  const layouts = useWorkspaceLayoutStore.getState();
  const layoutTabs = Object.keys(layouts.layoutByWorkspace).flatMap((workspaceKey) =>
    layouts.getWorkspaceTabs(workspaceKey).map((tab) => ({
      workspaceKey,
      tabId: tab.tabId,
      target: tab.target,
    })),
  );
  return { deskTabs: desks, layoutTabs };
}

export function useAssistantTabSweep(): void {
  useEffect(() => {
    let known: Set<string> | null = null;
    let sweeping = false;
    let lastAgentMaps: unknown[] = [];
    let lastDesks: unknown = null;
    let lastLayouts: unknown = null;

    const sweep = () => {
      if (sweeping) return;
      if (!useDesksStore.persist.hasHydrated() || !useWorkspaceLayoutStore.persist.hasHydrated())
        return;
      finishPending();
      const tabs = collectTabs();
      if (!known) known = tabKeys(tabs);
      else known = pruneKnownTabs(known, tabs);
      const sessions = useSessionStore.getState().sessions;
      // The plan keeps an archived chat's tab (Conversations' "Open in Desk") and everything in
      // the assistant Desk: only a live chat outside that Desk is swept.
      const plan = planAssistantTabSweep({
        ...tabs,
        known,
        sweepChats: useTaskNavigationStore.getState().enabled,
        agentFor: (serverId, agentId): AssistantAgentFacts | undefined =>
          sessions[serverId]?.agents.get(agentId) ?? sessions[serverId]?.agentDetails.get(agentId),
      });
      if (plan.deskTabIds.length === 0 && plan.layoutTabs.length === 0) return;
      sweeping = true;
      try {
        const desks = useDesksStore.getState();
        for (const tabId of plan.deskTabIds) desks.closeTab(tabId);
        const layouts = useWorkspaceLayoutStore.getState();
        for (const tab of plan.layoutTabs) {
          layouts.closeTab(tab.workspaceKey, tab.tabId);
          // A pinned agent would get its tab back on the next reconcile.
          layouts.unpinAgent(tab.workspaceKey, tab.agentId);
        }
      } finally {
        sweeping = false;
      }
      if (plan.reveal) openAssistantDesk({ chat: plan.reveal });
    };

    // The session store changes many times a second while agents stream; rescan only when an
    // agents map was replaced.
    const onSession = () => {
      const maps = Object.values(useSessionStore.getState().sessions).map((s) => s.agents);
      if (maps.length === lastAgentMaps.length && maps.every((map, i) => map === lastAgentMaps[i]))
        return;
      lastAgentMaps = maps;
      sweep();
    };

    const unsubscribers = [
      // Only tab changes matter, not focus, widths or tab state.
      useDesksStore.subscribe((state) => {
        if (state.desks === lastDesks) return;
        lastDesks = state.desks;
        sweep();
      }),
      useWorkspaceLayoutStore.subscribe((state) => {
        if (state.layoutByWorkspace === lastLayouts) return;
        lastLayouts = state.layoutByWorkspace;
        sweep();
      }),
      useSessionStore.subscribe(onSession),
      useDesksStore.persist.onFinishHydration(sweep),
      useWorkspaceLayoutStore.persist.onFinishHydration(sweep),
    ];
    onSession();
    sweep();
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
