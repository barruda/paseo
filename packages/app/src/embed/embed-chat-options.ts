// CUSTOM(agent-embed): the board's agent iframe hides a few composer controls. Dictation and
// Voice mode stay on: the iframe allows the microphone and the pipeline shows both buttons.
import type { AppSettings } from "@/hooks/use-settings/storage";

export const EMBED_HIDDEN_CHAT_OPTIONS: Record<string, boolean> = {
  "feature:plan_mode": false,
  "feature:fast_mode": false,
  "model-shortcut": false,
  jev: false,
};

/** Provider speed controls (`fast_mode`, Codex's `service_tier`, Cursor's `fast`) use the zap. */
export const EMBED_HIDDEN_FEATURE_ICONS: ReadonlySet<string> = new Set(["zap"]);

const embedChatOptionsCache = new WeakMap<object, AppSettings["chatOptions"]>();

export function withEmbedChatOptions(
  chatOptions: AppSettings["chatOptions"],
): AppSettings["chatOptions"] {
  let merged = embedChatOptionsCache.get(chatOptions);
  if (!merged) {
    merged = { ...chatOptions, ...EMBED_HIDDEN_CHAT_OPTIONS };
    embedChatOptionsCache.set(chatOptions, merged);
  }
  return merged;
}

/** Outside embed mode the same object comes back, so the normal app is untouched. */
export function resolveChatOptionsForEmbed(
  chatOptions: AppSettings["chatOptions"],
  embed: boolean,
): AppSettings["chatOptions"] {
  return embed ? withEmbedChatOptions(chatOptions) : chatOptions;
}

export function isEmbedHiddenFeature(feature: { icon?: string }): boolean {
  return feature.icon !== undefined && EMBED_HIDDEN_FEATURE_ICONS.has(feature.icon);
}
