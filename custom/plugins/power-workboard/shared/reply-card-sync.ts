// CUSTOM(pm-chat-sync): keeps a chat reply's `pwb` block in step with the Project Manager board
// card it cites as `[pm:<id>]`. The chat card reads the card's live state (the Decisões page's own
// poll) and draws the block as pending, decided or archived; an option tapped in the chat decides
// the card through the same RPC the Decisões page uses. Pure functions, so the mapping is tested
// without a renderer.
import {
  normalizeWord,
  type ParsedReply,
  type ReplyOption,
} from "./reply-protocol";
import type { PmCard, PmDecider } from "./pm-board";

/** The card a block is about: the `seu` line's `[pm:<id>]`, else the question's. */
export function replyPmCardId(reply: ParsedReply): string | null {
  return reply.yours?.pmCardIds[0] ?? reply.question?.pmCardIds[0] ?? null;
}

/**
 * How the block draws, from its card:
 * - `none`: the block cites no card, or the cards have not loaded yet; it draws as it always did.
 * - `missing`: the card is gone (deleted, another host); it also draws as it always did.
 * - `pending`: the card still needs someone (Investigating, Esperando você).
 * - `decided`: green, with the chosen option and who decided.
 * - `archived`: neutral, labeled archived.
 */
export type ReplyCardView =
  | { state: "none" }
  | { state: "missing"; cardId: string }
  | { state: "pending"; card: PmCard }
  | {
      state: "decided";
      card: PmCard;
      /** Null for a notice, which starts decided without a decider. */
      by: PmDecider | null;
      at: string | null;
      /** The block's option that matches the card's answer; null when none does. */
      optionId: string | null;
      /** What was decided, in one line: the decision, the answer or the option's label. */
      text: string | null;
    }
  | { state: "archived"; card: PmCard };

/** The view of a block, from the card id it cites and the board's cards (undefined: not loaded). */
export function replyCardView(
  cardId: string | null,
  cards: readonly PmCard[] | undefined,
  options: readonly ReplyOption[] = [],
): ReplyCardView {
  if (!cardId || !cards) return { state: "none" };
  const card = cards.find((item) => item.id === cardId);
  if (!card) return { state: "missing", cardId };
  if (card.status === "archived") return { state: "archived", card };
  if (card.status !== "decided") return { state: "pending", card };
  const chosen = card.options.find((item) => item.id === card.answerOptionId);
  return {
    state: "decided",
    card,
    by: card.decidedBy,
    at: card.decidedAt ?? card.updatedAt,
    optionId: replyOptionForCard(card, options),
    text: card.decision?.trim() || card.answer?.trim() || chosen?.label || null,
  };
}

const sameLabel = (left: string, right: string) =>
  normalizeWord(left) === normalizeWord(right);

/** The card's option a block option stands for: the same id, else the same label. */
export function cardOptionFor(
  card: PmCard,
  option: Pick<ReplyOption, "id" | "label">,
): string | null {
  const byId = card.options.find((item) => item.id === option.id);
  if (byId) return byId.id;
  return (
    card.options.find((item) => sameLabel(item.label, option.label))?.id ?? null
  );
}

/** The block option the card's answer names: by the card option's id or label, else the answer. */
export function replyOptionForCard(
  card: PmCard,
  options: readonly ReplyOption[],
): string | null {
  const chosen = card.options.find((item) => item.id === card.answerOptionId);
  if (chosen) {
    const match =
      options.find((item) => item.id === chosen.id) ??
      options.find((item) => sameLabel(item.label, chosen.label));
    if (match) return match.id;
  }
  const answer = card.answer?.trim();
  if (!answer) return null;
  return (
    options.find(
      (item) => sameLabel(item.id, answer) || sameLabel(item.label, answer),
    )?.id ?? null
  );
}

/**
 * The `workboard.assistant.pm.card.decide` input for an option tapped in the chat. The card's own
 * option when one matches; otherwise the option's label as the answer, so the card still records
 * what the user chose.
 */
export function chatPickDecideInput(
  card: PmCard,
  option: Pick<ReplyOption, "id" | "label">,
): { cardId: string; optionId: string | null; answer: string | null } {
  const optionId = cardOptionFor(card, option);
  return {
    cardId: card.id,
    optionId,
    answer: optionId ? null : option.label.trim() || option.id,
  };
}

/** Only a card waiting for the user takes an answer from the chat. */
export function chatCanDecide(view: ReplyCardView): boolean {
  return view.state === "pending" && view.card.status === "waiting";
}

/** "14:32" for today, "20/11 14:32" for another day, in local time; "" for a bad date. */
export function decidedTimeLabel(iso: string | null, now: number): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay
    ? time
    : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}
