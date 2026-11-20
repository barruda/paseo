// CUSTOM(assistant-sidebar): mounted once for the whole app; see sweep.ts.
import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { deskTabs, useDesksStore } from "@/task-navigation/desks-store";
import type { AssistantAgentFacts } from "./model";
import { openAssistantSidebar } from "./open";
import {
  planAssistantTabSweep,
  pruneKnownTabs,
  tabKeys,
  type SweepDeskTab,
  type SweepLayoutTab,
} from "./sweep";

function collectTabs(): { deskTabs: SweepDeskTab[]; layoutTabs: SweepLayoutTab[] } {
  const desks = useDesksStore.getState().desks.flatMap((desk) => deskTabs(desk));
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
      const tabs = collectTabs();
      if (!known) known = tabKeys(tabs);
      else known = pruneKnownTabs(known, tabs);
      const sessions = useSessionStore.getState().sessions;
      // The plan keeps an archived chat's tab (Conversations' "Open in Desk"): only a live chat
      // belongs in the single sidebar tab.
      const plan = planAssistantTabSweep({
        ...tabs,
        known,
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
      if (plan.reveal) openAssistantSidebar({ chat: plan.reveal });
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
