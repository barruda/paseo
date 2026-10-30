import { settingsRpc } from "@getpaseo/plugin";
import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import { tldrPromptFrom, tldrSettings } from "../shared/tldr";

const readSettings = settingsRpc(tldrSettings.id).read;

/** Sends the saved TLDR message to the agent, as if typed in the composer. */
export async function sendTldr(
  client: Pick<PluginCommandCapabilities, "paseo" | "rpc">,
  agentId: string,
): Promise<void> {
  const prompt = tldrPromptFrom(await client.rpc(readSettings, {}));
  await client.paseo.agents.ref(agentId).send(prompt);
}
