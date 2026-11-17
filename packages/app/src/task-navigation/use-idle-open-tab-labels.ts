// CUSTOM(idle-closed-tab): mounted once for the whole app. Tells each connected host which agents
// this client has a tab open for, through the `paseo.idle-open-tab.<clientId>` label. The daemon
// releases an agent with no open tab after the shorter idle period.
import { getIdleOpenTabLabel } from "@getpaseo/protocol/agent-labels";
import { useEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import { getOrCreateClientId } from "@/utils/client-id";
import { deskTabs, useDesksStore } from "./desks-store";
import { getIdleLabelWrites, selectOpenAgentIds, type OpenTabRef } from "./idle-open-tab-labels";
import { useTaskNavigationStore } from "./store";

const RETRY_MS = 2_000;
const PENDING_TTL_MS = 5_000;

function isHydrated(): boolean {
  return (
    useDesksStore.persist.hasHydrated() &&
    useWorkspaceLayoutStore.persist.hasHydrated() &&
    useTaskNavigationStore.persist.hasHydrated()
  );
}

function collectOpenTabs(): { desk: OpenTabRef[]; layout: OpenTabRef[]; tasksMode: boolean } {
  const desk: OpenTabRef[] = [];
  for (const entry of useDesksStore.getState().desks) {
    for (const tab of deskTabs(entry)) {
      if (tab.target.kind === "agent") {
        desk.push({ serverId: tab.serverId, agentId: tab.target.agentId });
      }
    }
  }
  const layout: OpenTabRef[] = [];
  for (const [key, workspaceLayout] of Object.entries(
    useWorkspaceLayoutStore.getState().layoutByWorkspace,
  )) {
    const serverId = key.slice(0, key.indexOf(":"));
    for (const tab of collectAllTabs(workspaceLayout.root)) {
      if (tab.target.kind === "agent") layout.push({ serverId, agentId: tab.target.agentId });
    }
  }
  return { desk, layout, tasksMode: useTaskNavigationStore.getState().enabled };
}

export function useIdleOpenTabLabels(): void {
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInputs: unknown[] = [];
    const pending = new Map<string, number>();
    let running = false;
    let again = false;

    const scheduleRetry = () => {
      retryTimer ??= setTimeout(() => {
        retryTimer = null;
        lastInputs = [];
        void run();
      }, RETRY_MS);
    };

    async function writeServer(
      serverId: string,
      agents: ReturnType<typeof useSessionStore.getState>["sessions"][string]["agents"],
      open: Set<string> | undefined,
      label: string,
    ) {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) return;
      const writes = getIdleLabelWrites({
        label,
        openAgentIds: open ?? new Set<string>(),
        agents,
        pending: new Set(pending.keys()),
      });
      for (const write of writes) {
        const key = `${write.agentId}:${write.value}`;
        pending.set(key, Date.now());
        try {
          await client.updateAgent(write.agentId, { labels: { [label]: write.value } });
        } catch (error) {
          pending.delete(key);
          console.warn("[IdleOpenTabLabels] Failed to update the idle tab label", {
            error,
            agentId: write.agentId,
          });
          scheduleRetry();
        }
      }
    }

    async function run() {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          if (disposed || !isHydrated()) return;
          const { desk, layout, tasksMode } = collectOpenTabs();
          const open = selectOpenAgentIds({ tasksMode, deskTabs: desk, layoutTabs: layout });
          const label = getIdleOpenTabLabel(await getOrCreateClientId());
          const now = Date.now();
          for (const [key, at] of pending) if (now - at > PENDING_TTL_MS) pending.delete(key);
          const sessions = useSessionStore.getState().sessions;
          for (const [serverId, session] of Object.entries(sessions)) {
            if (session.serverInfo?.features?.idleRuntimeCleanupClosedTabSetting !== true) continue;
            if (!session.hasHydratedAgents) continue;
            await writeServer(serverId, session.agents, open.get(serverId), label);
          }
        } while (again);
      } catch (error) {
        console.warn("[IdleOpenTabLabels] Failed to report open tabs", { error });
      } finally {
        running = false;
      }
    }

    // The session store changes many times a second while agents stream; rerun only when the tab
    // sources or an agents map were replaced.
    const check = () => {
      const sessions = useSessionStore.getState().sessions;
      const inputs: unknown[] = [
        useDesksStore.getState().desks,
        useWorkspaceLayoutStore.getState().layoutByWorkspace,
        useTaskNavigationStore.getState().enabled,
      ];
      for (const [serverId, session] of Object.entries(sessions)) {
        inputs.push(serverId, session.agents, session.hasHydratedAgents, session.serverInfo);
      }
      if (inputs.length === lastInputs.length && inputs.every((v, i) => v === lastInputs[i])) {
        return;
      }
      lastInputs = inputs;
      void run();
    };
    check();
    const unsubscribers = [
      useSessionStore.subscribe(check),
      useDesksStore.subscribe(check),
      useWorkspaceLayoutStore.subscribe(check),
      useTaskNavigationStore.subscribe(check),
      useDesksStore.persist.onFinishHydration(check),
      useWorkspaceLayoutStore.persist.onFinishHydration(check),
      useTaskNavigationStore.persist.onFinishHydration(check),
    ];
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
