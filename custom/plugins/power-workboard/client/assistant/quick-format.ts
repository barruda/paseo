// CUSTOM(assistant-quick): pure helpers of the sidebar status row and the quick-message popover.
import type { QuickMessage, QuickStatus } from "../../shared/quick";

export type QuickColor =
  | "statusSuccess"
  | "statusWarning"
  | "statusDanger"
  | "foregroundMuted";

export function quickVisual(status: QuickStatus): {
  icon: string;
  color: QuickColor;
} {
  switch (status) {
    case "ok":
      return { icon: "CircleCheck", color: "statusSuccess" };
    case "needs-input":
      return { icon: "TriangleAlert", color: "statusWarning" };
    case "error":
      return { icon: "CircleX", color: "statusDanger" };
    case "pending":
      return { icon: "Clock", color: "foregroundMuted" };
  }
}

export interface QuickStrings {
  pending: string;
  idle: string;
}

export function quickLabel(item: QuickMessage | null, s: QuickStrings): string {
  if (!item) return s.idle;
  if (item.status === "pending") return s.pending;
  return item.message ?? s.pending;
}

/** Where a press on a message goes: the assistant chat, scrolled to that message. */
export function conversationTarget(
  item: QuickMessage,
): { agentId: string; turnStartedAt: string } | null {
  if (!item.agentId) return null;
  return { agentId: item.agentId, turnStartedAt: item.sentAt };
}

export function quickPollMs(items: readonly QuickMessage[]): number {
  return items.some((item) => item.status === "pending") ? 2_000 : 15_000;
}
