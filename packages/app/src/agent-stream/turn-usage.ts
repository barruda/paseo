import type { PluginTimelineStreamItem, StreamItem } from "@/types/stream";
import type { StreamStrategy } from "./strategy";
import { continuesResponse } from "./turn-membership";

// CUSTOM(turn-usage-inline): the token-ledger plugin appends one usage row after each finished
// turn. The footer draws it on its own line, so the stream folds it into the footer instead.
const TURN_USAGE_PLUGIN_ID = "token-ledger";
const TURN_USAGE_ITEM_KIND = "turn-usage";

export function isTurnUsageItem(item: StreamItem): item is PluginTimelineStreamItem {
  return (
    item.kind === "plugin" &&
    item.pluginId === TURN_USAGE_PLUGIN_ID &&
    item.itemKind === TURN_USAGE_ITEM_KIND
  );
}

/** The usage row the plugin recorded for the response whose last assistant message is `startIndex`. */
export function findTurnUsageItem(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  startIndex: number;
}): PluginTimelineStreamItem | null {
  const { strategy, items } = input;
  let previous: StreamItem | null = items[input.startIndex] ?? null;
  for (
    let index = strategy.getNeighborIndex(input.startIndex, "below");
    index >= 0 && index < items.length;
    index = strategy.getNeighborIndex(index, "below")
  ) {
    const item = items[index];
    if (!item || !continuesResponse(previous, item)) {
      return null;
    }
    if (isTurnUsageItem(item)) {
      return item;
    }
    previous = item;
  }
  return null;
}
