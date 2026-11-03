// CUSTOM(draft-composer-ready): the composer toggles a draft shows before its session exists (the
// keep-cache-warm flame and the critic) store their choice under the draft's key. The create
// request carries what must be there from the first turn; the rest moves to the new agent after.

import { moveCacheWarmupDraftToAgent } from "@/cache-warmup/draft";
import { applyCriticDraft, criticDraftCreateExtras } from "@/critic/draft";
import type { CriticClient } from "@/critic/rpc";

/** The create request's first message and labels; `labels` are the ones it already carries. */
export function draftComposerCreateExtras(input: {
  draftKey: string;
  prompt: string;
  labels?: Record<string, string>;
}): { prompt: string; createOptions: { labels?: Record<string, string> } } {
  const critic = criticDraftCreateExtras(input.draftKey, input.prompt);
  const labels = { ...input.labels, ...critic.labels };
  return {
    prompt: critic.prompt,
    createOptions: Object.keys(labels).length > 0 ? { labels } : {},
  };
}

/** Never throws: the session already exists, so a failure here only costs the critic setup. */
export async function applyDraftComposerExtras(input: {
  client: Pick<CriticClient, "invokePluginRpc">;
  serverId: string;
  draftKey: string;
  agentId: string;
  prompt: string;
}): Promise<void> {
  moveCacheWarmupDraftToAgent({
    serverId: input.serverId,
    draftKey: input.draftKey,
    agentId: input.agentId,
  });
  try {
    await applyCriticDraft(input);
  } catch (error) {
    console.warn("[draft-composer-ready] could not set up the critic for the new agent", error);
  }
}
