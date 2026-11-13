// CUSTOM(jev-router): asks the host's `jev-router` plugin, right before a draft's session is
// created, whether its first prompt should start on a cheaper model. A host without the plugin,
// a slow plugin or any error leaves the config as selected.

import { JEV_ROUTER_PLUGIN_ID, JEV_ROUTER_RPC } from "@getpaseo/protocol/jev-router";
import { pluginRegistry } from "@/plugins/registry";
import { applyJevRoute, isThreadDraft, type DraftRouteConfig } from "./model";
import { useJevSkipNextStore } from "./skip-next";

/** route.py's own timeout tops out at 10 s; past this the session starts as selected. */
const CLIENT_TIMEOUT_MS = 15_000;

/**
 * Returns the config to create the session with, plus `labels` for the create request when Jev
 * answered. `autoSubmitted` (a setup that sends itself, not a message the user typed) is not routed,
 * nor is a thread (a fork or /btw carrying the previous conversation; see `isThreadDraft`).
 */
export async function routeDraftAgent<Config extends DraftRouteConfig & { cwd: string }>(input: {
  serverId: string;
  prompt: string;
  images: readonly unknown[] | undefined;
  autoSubmitted: boolean;
  /** The create request's attachments, to spot a thread's chat history. */
  attachments: unknown;
  config: Config;
}): Promise<{ config: Config; createOptions: { labels?: Record<string, string> } }> {
  const routed = await route(input);
  return {
    config: routed.config,
    createOptions: Object.keys(routed.labels).length > 0 ? { labels: routed.labels } : {},
  };
}

async function route<Config extends DraftRouteConfig & { cwd: string }>(input: {
  serverId: string;
  prompt: string;
  images: readonly unknown[] | undefined;
  autoSubmitted: boolean;
  attachments: unknown;
  config: Config;
}): Promise<{ config: Config; labels: Record<string, string> }> {
  // An empty first message (a session started for voice or for a `!` command) has nothing to judge.
  if (input.autoSubmitted || input.config.provider !== "claude" || !input.prompt.trim())
    return { config: input.config, labels: {} };
  // A thread keeps its model: switching it would invalidate the prompt cache the thread warmed.
  if (isThreadDraft(input.attachments)) return { config: input.config, labels: {} };
  // The route icon's press skips this one creation; the next new agent routes again.
  if (useJevSkipNextStore.getState().consume(input.serverId))
    return { config: input.config, labels: {} };
  const plugin = pluginRegistry
    .getSnapshot()
    .find((item) => item.serverId === input.serverId && item.id === JEV_ROUTER_PLUGIN_ID);
  if (!plugin) return { config: input.config, labels: {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      plugin.invoke(JEV_ROUTER_RPC.route, {
        prompt: input.prompt,
        cwd: input.config.cwd,
        images: input.images?.length ?? 0,
        provider: input.config.provider,
        model: input.config.model ?? null,
        thinkingOptionId: input.config.thinkingOptionId ?? null,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CLIENT_TIMEOUT_MS);
      }),
    ]);
    return applyJevRoute(input.config, output);
  } catch (error) {
    console.warn("[jev-router] routing failed; starting as selected", error);
    return { config: input.config, labels: {} };
  } finally {
    clearTimeout(timer);
  }
}
