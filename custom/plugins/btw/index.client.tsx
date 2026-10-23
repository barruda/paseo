import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BtwCard } from "./client/btw-card";
import {
  askBtwRpc,
  BTW_TIMELINE_KIND,
  BTW_TIMELINE_VERSION,
  btwTimelineSchema,
} from "./shared/btw";

export default function contribute(client: PluginClientContext) {
  const removeCommand = client.addSlashCommand({
    name: "btw",
    description:
      "Ask about this session without interrupting the agent. The answer stays out of its history.",
    argumentHint: "<question>",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      if (!args) throw new Error("Type a question: /btw what did you change so far?");
      await rpc(askBtwRpc, { agentId: agent.id, question: args });
    },
  });
  const removeRenderer = client.addTimelineRenderer({
    kind: BTW_TIMELINE_KIND,
    version: BTW_TIMELINE_VERSION,
    schema: btwTimelineSchema,
    Component: BtwCard,
  });
  return () => {
    removeCommand();
    removeRenderer();
  };
}
