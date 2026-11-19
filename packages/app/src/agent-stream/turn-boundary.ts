import type { StreamItem, TimelinePosition } from "@/types/stream";

export type AssistantTurnForkBoundary =
  | { boundaryCursor: TimelinePosition; boundaryMessageId?: string }
  | { boundaryCursor?: undefined; boundaryMessageId: string };

export function resolveAssistantTurnForkBoundary(input: {
  items: readonly StreamItem[];
  startIndex: number;
  supportsTimelineCursor: boolean;
}): AssistantTurnForkBoundary | undefined {
  const item = input.items[input.startIndex];
  // CUSTOM(timeline-transformer-agent): a plugin row that replaced a reply forks from the reply's
  // timeline cursor. It has no provider message id, so it needs a host that supports cursors.
  if (item?.kind === "plugin" && item.sourceAssistantText !== undefined) {
    return input.supportsTimelineCursor && item.timelineCursor
      ? { boundaryCursor: item.timelineCursor }
      : undefined;
  }
  if (item?.kind !== "assistant_message") {
    return undefined;
  }
  if (input.supportsTimelineCursor && item.timelineCursor) {
    return {
      boundaryCursor: item.timelineCursor,
      ...(item.messageId ? { boundaryMessageId: item.messageId } : {}),
    };
  }
  return item.messageId ? { boundaryMessageId: item.messageId } : undefined;
}
