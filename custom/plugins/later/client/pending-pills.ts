import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import {
  cancelLaterRpc,
  listLaterRpc,
  nextRefreshDelay,
  type PendingLater,
  pillLabel,
} from "../shared/later";

interface Pill {
  registration: PluginButtonRegistration;
  agentId: string;
}

/**
 * One composer pill per pending /later message. The pill shows the send time and a preview; its
 * menu has the cancel action (the pill API has no inline button).
 */
export function createPendingPills(client: PluginClientContext) {
  const pills = new Map<string, Pill>();
  const workspaces = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function workspaceOf(agentId: string): Promise<string | null> {
    const known = workspaces.get(agentId);
    if (known) return known;
    const { entries } = await client.paseo.agents.list();
    for (const { agent } of entries) {
      if (agent.workspaceId) workspaces.set(agent.id, agent.workspaceId);
    }
    return workspaces.get(agentId) ?? null;
  }

  function button(item: PendingLater) {
    return {
      title: "Message scheduled with /later",
      icon: "Clock",
      label: pillLabel(item, new Date()),
      behavior: {
        kind: "menu" as const,
        items: [
          {
            kind: "item" as const,
            id: "cancel",
            title: "Cancel this message",
            icon: "X",
            behavior: {
              kind: "action" as const,
              async onPress() {
                await client.rpc(cancelLaterRpc, { id: item.id });
                await refresh();
              },
            },
          },
        ],
      },
    };
  }

  async function sync(items: PendingLater[]) {
    const wanted = new Set(items.map((item) => item.id));
    for (const [id, pill] of pills) {
      if (wanted.has(id)) continue;
      pill.registration.remove();
      pills.delete(id);
    }
    for (const item of items) {
      const existing = pills.get(item.id);
      if (existing) {
        existing.registration.update(button(item));
        continue;
      }
      const workspaceId = await workspaceOf(item.agentId);
      if (stopped || !workspaceId || pills.has(item.id)) continue;
      pills.set(item.id, {
        agentId: item.agentId,
        registration: client.addComposerPill({
          id: `later-${item.id}`,
          workspaceId,
          agentId: item.agentId,
          button: button(item),
        }),
      });
    }
  }

  function schedule(items: PendingLater[]) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), nextRefreshDelay(items, new Date()));
  }

  let running: Promise<void> = Promise.resolve();
  async function refreshOnce() {
    let items: PendingLater[] = [];
    try {
      items = (await client.rpc(listLaterRpc, {})).items;
      await sync(items);
    } catch (error) {
      console.error("[later] could not refresh pending messages", error);
    }
    schedule(items);
  }

  /** Refetches every agent's pending messages and brings the pills in line, one at a time. */
  function refresh(): Promise<void> {
    const next = running.then(refreshOnce);
    running = next;
    return next;
  }

  return {
    refresh,
    /** Lets /later show its pill before the agent list has been read. */
    rememberWorkspace(agentId: string, workspaceId: string) {
      workspaces.set(agentId, workspaceId);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const pill of pills.values()) pill.registration.remove();
      pills.clear();
    },
  };
}
