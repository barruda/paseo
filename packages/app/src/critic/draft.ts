// CUSTOM(draft-composer-ready): a draft's critic, set up in the sheet before the session exists.
// The create request carries the "enabled" label, so the daemon leaves the first turn's
// "finished" notification to the critic, and the first message carries the notice the agent
// would get after a toggle. Once the agent exists, its config goes to the plugin.

import {
  buildCriticNotice,
  CRITIC_ENABLED_LABEL,
  CRITIC_PLUGIN_ID,
  CRITIC_RPC,
} from "@getpaseo/protocol/critic";
import type { CriticClient } from "./rpc";
import { useCriticStore, type CriticDraftSetup } from "./store";

export interface CriticDraftCreateExtras {
  labels: Record<string, string>;
  /** The first message with the notice in front; unchanged when it is empty or the critic is off. */
  prompt: string;
}

/** What the create request adds for the draft's critic. Pure; `setup` is the draft's sheet save. */
export function buildCriticDraftCreateExtras(
  setup: CriticDraftSetup | undefined,
  prompt: string,
): CriticDraftCreateExtras {
  if (!setup?.config.enabled) return { labels: {}, prompt };
  return {
    labels: { [CRITIC_ENABLED_LABEL]: "true" },
    // An empty first message starts no turn; the notice waits for the next one instead.
    prompt: prompt.trim() ? buildCriticNotice(true) + prompt : prompt,
  };
}

export function criticDraftCreateExtras(draftKey: string, prompt: string): CriticDraftCreateExtras {
  return buildCriticDraftCreateExtras(useCriticStore.getState().drafts[draftKey], prompt);
}

/** Hands the draft's critic to the new agent. A failure leaves the critic off for it. */
export async function applyCriticDraft(input: {
  client: Pick<CriticClient, "invokePluginRpc">;
  draftKey: string;
  agentId: string;
  prompt: string;
}): Promise<void> {
  const store = useCriticStore.getState();
  const setup = store.takeDraft(input.draftKey);
  if (!setup) return;
  await input.client.invokePluginRpc(CRITIC_PLUGIN_ID, CRITIC_RPC.setConfig, {
    agentId: input.agentId,
    config: setup.config,
    saveAsDefault: setup.saveAsDefault,
  });
  store.setModel(input.agentId, `${setup.config.provider}/${setup.config.model}`);
  if (setup.config.enabled && !input.prompt.trim()) store.toggleNotice(input.agentId, true);
}
