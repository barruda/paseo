import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeTldrPills } from "./client/pills";
import { sendTldr } from "./client/prompt";

export default function contribute(client: PluginClientContext) {
  const removePills = contributeTldrPills(client);
  const removeCommand = client.addSlashCommand({
    name: "tldr",
    description: "Send the saved TLDR message to the agent, like the TLDR button.",
    argumentHint: "",
    context: "agent",
    async onSubmit({ agent, paseo, rpc }) {
      await sendTldr({ paseo, rpc }, agent.id);
    },
  });
  return () => {
    removeCommand();
    removePills();
  };
}
