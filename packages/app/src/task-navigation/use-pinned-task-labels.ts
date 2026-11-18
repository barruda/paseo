// CUSTOM(auto-archive-skip-pinned): mounted once for the whole app. Tells each connected host which
// agents this client pinned, through the `paseo.pinned.<clientId>` label, so the daemon skips them
// in auto-archive.
import { getPinnedLabel } from "@getpaseo/protocol/agent-labels";
import { useEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { getOrCreateClientId } from "@/utils/client-id";
import { getPinLabelWrites, selectPinnedAgentIds } from "./pinned-task-labels";
import { usePinnedTasksStore } from "./pinned-tasks-store";

const RETRY_MS = 2_000;
const PENDING_TTL_MS = 5_000;

function isHydrated(): boolean {
  return usePinnedTasksStore.persist.hasHydrated();
}

export function usePinnedTaskLabels(): void {
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
      pinned: Set<string> | undefined,
      label: string,
    ) {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) return;
      const writes = getPinLabelWrites({
        label,
        pinnedAgentIds: pinned ?? new Set<string>(),
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
          console.warn("[PinnedTaskLabels] Failed to update the pinned label", {
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
          const pinned = selectPinnedAgentIds(usePinnedTasksStore.getState().keys);
          const label = getPinnedLabel(await getOrCreateClientId());
          const now = Date.now();
          for (const [key, at] of pending) if (now - at > PENDING_TTL_MS) pending.delete(key);
          const sessions = useSessionStore.getState().sessions;
          for (const [serverId, session] of Object.entries(sessions)) {
            if (session.serverInfo?.features?.autoArchiveSkipPinned !== true) continue;
            if (!session.hasHydratedAgents) continue;
            await writeServer(serverId, session.agents, pinned.get(serverId), label);
          }
        } while (again);
      } catch (error) {
        console.warn("[PinnedTaskLabels] Failed to report pinned sessions", { error });
      } finally {
        running = false;
      }
    }

    // The session store changes many times a second while agents stream; rerun only when the pins
    // or an agents map were replaced.
    const check = () => {
      const sessions = useSessionStore.getState().sessions;
      const inputs: unknown[] = [usePinnedTasksStore.getState().keys];
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
      usePinnedTasksStore.subscribe(check),
      usePinnedTasksStore.persist.onFinishHydration(check),
    ];
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
