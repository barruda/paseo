// CUSTOM(steer-pending): what a steered user message shows while Claude has not started it.
import type { StreamItem } from "@/types/stream";

export type SteerMessageState = "pending" | "cancelled" | "delivered";

const NO_IDS: readonly string[] = [];

/** Pending: show the badge and X. Cancelled: hide the bubble. Anything else renders as usual. */
export function resolveSteerMessageState(input: {
  clientMessageId: string | undefined;
  pendingSteerMessageIds: readonly string[] | undefined;
  cancelledSteerMessageIds: readonly string[] | undefined;
}): SteerMessageState {
  const { clientMessageId } = input;
  if (!clientMessageId) return "delivered";
  if ((input.cancelledSteerMessageIds ?? NO_IDS).includes(clientMessageId)) return "cancelled";
  if ((input.pendingSteerMessageIds ?? NO_IDS).includes(clientMessageId)) return "pending";
  return "delivered";
}

/**
 * Drops the bubbles of cancelled steers. The daemon timeline is append-only, so the row stays
 * there; Claude never saw the message, so hiding it is accurate. Returns the same array when
 * nothing is hidden.
 */
export function hideCancelledSteers(
  items: StreamItem[],
  cancelledSteerMessageIds: readonly string[] | undefined,
): StreamItem[] {
  if (!cancelledSteerMessageIds || cancelledSteerMessageIds.length === 0) return items;
  const kept = items.filter(
    (item) =>
      item.kind !== "user_message" ||
      item.clientMessageId === undefined ||
      !cancelledSteerMessageIds.includes(item.clientMessageId),
  );
  return kept.length === items.length ? items : kept;
}

/**
 * The text a user message was sent with. The chat shows a projection (the spoken-input envelope is
 * stripped), so re-sending the displayed text would lose it. Looks the row up by id in the
 * unprojected lists and falls back to the displayed text.
 */
export function findSourceUserMessageText(
  sources: readonly (readonly StreamItem[])[],
  itemId: string,
  fallback: string,
): string {
  for (const list of sources) {
    for (const item of list) {
      if (item.kind === "user_message" && item.id === itemId) return item.text;
    }
  }
  return fallback;
}
