import type { PluginClientContext } from "@getpaseo/plugin/client";
import { parseLaterArgs, sendLaterRpc } from "./shared/later";

export default function contribute(client: PluginClientContext) {
  const removeCommand = client.addSlashCommand({
    name: "later",
    description: "Send a message to this agent later",
    argumentHint: "<5m|1h30m> <message>",
    context: "agent",
    async onSubmit({ args, agent, rpc }) {
      const { delayMs, message } = parseLaterArgs(args);
      await rpc(sendLaterRpc, { agentId: agent.id, delayMs, message });
    },
  });
  return () => {
    removeCommand();
  };
}
