// CUSTOM(pm-sidebar-decisions): pure helpers of the chat sidebar's Decisões list.
import type { PmCard } from "../../../shared/pm-board";

const newestFirst = (left: PmCard, right: PmCard) =>
  right.updatedAt.localeCompare(left.updatedAt);

/**
 * Top to bottom: investigations in progress, then cards waiting for the user. Newest on top in
 * each group, so the card waiting longest is last (the list opens scrolled to the end).
 */
export function pmOpenDecisions(cards: readonly PmCard[]): PmCard[] {
  return [
    ...cards
      .filter((card) => card.status === "investigating")
      .sort(newestFirst),
    ...cards.filter((card) => card.status === "waiting").sort(newestFirst),
  ];
}

/** Cards waiting for the user; investigations do not count. */
export function pmOpenDecisionCount(cards: readonly PmCard[]): number {
  return cards.filter((card) => card.status === "waiting").length;
}

const IMAGE = /!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)[^)]*\)/g;

/** The first Markdown image of the findings or the question with an http(s) or data:image url. */
export function pmCardImage(card: PmCard): string | null {
  for (const text of [card.findings, card.question ?? ""]) {
    for (const match of text.matchAll(IMAGE)) {
      const url = match[1]!.replace(/^<|>$/g, "");
      if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return url;
    }
  }
  return null;
}

/** A short preview: the question of a waiting card, else the findings as plain text. */
export function pmCardSummary(card: PmCard): string {
  const source =
    card.status === "waiting" && card.question?.trim()
      ? card.question
      : card.findings;
  return source
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
