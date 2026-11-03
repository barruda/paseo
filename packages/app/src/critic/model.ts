// CUSTOM(critic): a second model reviews each answer before the user reads it (the `critic`
// plugin runs the loop). The chat hides the answers the critic is reading or rejected (the
// critic's card shows them on demand), hides the feedback the critic sends back to the agent,
// and strips the notice the app puts in front of the user's message when the critic is toggled.

import {
  CRITIC_PLUGIN_ID,
  CRITIC_TIMELINE_KIND,
  CriticReviewDataSchema,
  criticStatusHidesAnswer,
  isCriticFeedbackMessage,
  stripCriticNotice,
  type CriticReviewData,
  type CriticReviewStatus,
} from "@getpaseo/protocol/critic";
import type { StreamItem } from "@/types/stream";

/** The review a critic row carries, or null when the item is not a valid critic row. */
export function criticReviewOf(item: StreamItem): CriticReviewData | null {
  if (item.kind !== "plugin") return null;
  if (item.pluginId !== CRITIC_PLUGIN_ID || item.itemKind !== CRITIC_TIMELINE_KIND) return null;
  const parsed = CriticReviewDataSchema.safeParse(item.data);
  return parsed.success ? parsed.data : null;
}

/** Items to drop: feedback messages, and assistant answers before a hiding critic row. */
function hiddenItems(items: readonly StreamItem[]): Set<StreamItem> {
  const hidden = new Set<StreamItem>();
  let sinceUserMessage: StreamItem[] = [];
  for (const item of items) {
    if (item.kind === "user_message") {
      if (isCriticFeedbackMessage(item.text)) hidden.add(item);
      sinceUserMessage = [];
      continue;
    }
    if (item.kind === "assistant_message") {
      sinceUserMessage.push(item);
      continue;
    }
    const review = criticReviewOf(item);
    if (review && criticStatusHidesAnswer(review.status)) {
      for (const answer of sinceUserMessage) hidden.add(answer);
      sinceUserMessage = [];
    }
  }
  return hidden;
}

function present(items: StreamItem[], hidden: ReadonlySet<StreamItem>): StreamItem[] {
  let changed = false;
  const next: StreamItem[] = [];
  for (const item of items) {
    if (hidden.has(item)) {
      changed = true;
      continue;
    }
    if (item.kind === "user_message") {
      const text = stripCriticNotice(item.text);
      if (text !== item.text) {
        changed = true;
        next.push({ ...item, text });
        continue;
      }
    }
    next.push(item);
  }
  return changed ? next : items;
}

/**
 * Hides the rounds the critic did not approve. The live head continues the tail's last turn, so
 * both are read as one sequence. Returns the same arrays when nothing changes.
 */
export function hideCriticRounds(
  tail: StreamItem[],
  head: StreamItem[],
): { tail: StreamItem[]; head: StreamItem[] } {
  const hidden = hiddenItems([...tail, ...head]);
  return { tail: present(tail, hidden), head: present(head, hidden) };
}

/** The status of the last critic row, for the composer icon. */
export function latestCriticStatus(items: readonly StreamItem[]): CriticReviewStatus | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    const review = criticReviewOf(item);
    if (review) return review.status;
  }
  return null;
}

/** The composer icon's tooltip. */
export function describeCritic(input: {
  enabled: boolean;
  model: string | null;
  status: CriticReviewStatus | null;
}): string[] {
  if (!input.enabled) return ["Critic: off"];
  const lines = [input.model ? `Critic: on · ${input.model}` : "Critic: on"];
  if (input.status) lines.push(`Last review: ${CRITIC_STATUS_LABELS[input.status]}`);
  return lines;
}

export const CRITIC_STATUS_LABELS: Record<CriticReviewStatus, string> = {
  reviewing: "reviewing…",
  approved: "approved",
  rejected: "sent back to the agent",
  limit: "not approved after the last round",
  question: "agent asked you something",
  waiting: "agent is waiting on background work",
  failed: "failed",
  canceled: "canceled",
};
