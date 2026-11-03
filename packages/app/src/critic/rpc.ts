// CUSTOM(critic): the sheet talks to the `critic` plugin over plugin RPC, then marks the agent
// with a label so the daemon leaves its "finished" notification to the critic.

import {
  CRITIC_ENABLED_LABEL,
  CRITIC_PLUGIN_ID,
  CRITIC_RPC,
  CriticGetConfigOutputSchema,
  type CriticConfig,
} from "@getpaseo/protocol/critic";

export interface CriticClient {
  invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
  updateAgent(agentId: string, updates: { labels?: Record<string, string> }): Promise<void>;
}

export async function loadCriticConfig(
  client: CriticClient,
  agentId: string,
): Promise<CriticConfig> {
  const output = await client.invokePluginRpc(CRITIC_PLUGIN_ID, CRITIC_RPC.getConfig, { agentId });
  return CriticGetConfigOutputSchema.parse(output).config;
}

/**
 * Saves the config, then the label. A failed RPC (plugin missing or off) throws before the label
 * changes, so the daemon never waits on a critic that is not there. Returns whether `enabled`
 * changed, so the caller can queue the notice for the agent's next message.
 */
export async function saveCriticConfig(input: {
  client: CriticClient;
  agentId: string;
  config: CriticConfig;
  saved: CriticConfig | null;
  saveAsDefault: boolean;
}): Promise<{ enabledChanged: boolean }> {
  await input.client.invokePluginRpc(CRITIC_PLUGIN_ID, CRITIC_RPC.setConfig, {
    agentId: input.agentId,
    config: input.config,
    saveAsDefault: input.saveAsDefault,
  });
  await input.client.updateAgent(input.agentId, {
    labels: { [CRITIC_ENABLED_LABEL]: input.config.enabled ? "true" : "false" },
  });
  return { enabledChanged: (input.saved?.enabled ?? false) !== input.config.enabled };
}
