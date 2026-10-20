import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { TLDR_PROMPT, type TldrAgent, tldrPillWorkspace } from "../shared/tldr";

const PAGE_LIMIT = 200;

/** Adds a TLDR pill to every open agent's composer. Returns the cleanup. */
export function contributeTldrPills(client: PluginClientContext): () => void {
  const pills = new Map<string, { workspaceId: string; handle: PluginButtonRegistration }>();
  const lifetime = new AbortController();
  let stopped = false;

  const remove = (agentId: string) => {
    pills.get(agentId)?.handle.remove();
    pills.delete(agentId);
  };

  const sync = (agent: TldrAgent) => {
    if (stopped) return;
    const workspaceId = tldrPillWorkspace(agent);
    if (!workspaceId) return remove(agent.id);
    if (pills.get(agent.id)?.workspaceId === workspaceId) return;
    remove(agent.id);
    const agentId = agent.id;
    const handle = client.addComposerPill({
      id: "tldr",
      workspaceId,
      agentId,
      button: {
        title: "Ask the agent for a TLDR",
        label: "TLDR",
        icon: "ScrollText",
        behavior: {
          kind: "action",
          onPress: async () => {
            await client.paseo.agents.ref(agentId).send(TLDR_PROMPT);
          },
        },
      },
    });
    pills.set(agentId, { workspaceId, handle });
  };

  // The snapshot holds only the first page; read the rest so older agents get a pill too.
  const readRemainingPages = async (cursor: string | null | undefined) => {
    while (cursor) {
      if (stopped) return;
      const page = await client.paseo.agents.list({
        page: { limit: PAGE_LIMIT, cursor },
        signal: lifetime.signal,
      });
      for (const { agent } of page.entries) sync(agent);
      cursor = page.pageInfo.nextCursor;
    }
  };

  void client.paseo.agents
    .list({ subscribe: {}, page: { limit: PAGE_LIMIT }, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries, pageInfo }) => {
          for (const agentId of pills.keys()) remove(agentId);
          for (const { agent } of entries) sync(agent);
          readRemainingPages(pageInfo.nextCursor).catch((error) => {
            if (!stopped) console.error("tldr: failed to list agents", error);
          });
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else sync(update.agent);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!stopped) console.error("tldr: agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const agentId of pills.keys()) remove(agentId);
  };
}
