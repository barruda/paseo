// CUSTOM(pm-board): the Project Manager's own board. Investigations, proposals and decisions
// between the user and the PM live here, apart from the task board. A card here never starts an
// agent or a workspace: code tasks and code reviews stay on the task board.
import { z } from "zod";
import { taskNumberLabel } from "./task-reference";

export const PM_CARD_KINDS = [
  "investigation",
  "proposal",
  "decision",
  "notice",
] as const;
export const pmCardKindSchema = z.enum(PM_CARD_KINDS);
export type PmCardKind = z.infer<typeof pmCardKindSchema>;

export const PM_CARD_STATUSES = [
  "investigating",
  "waiting",
  "decided",
  "archived",
] as const;
export const pmCardStatusSchema = z.enum(PM_CARD_STATUSES);
export type PmCardStatus = z.infer<typeof pmCardStatusSchema>;

/** Where a card of each kind starts. A proposal is the PM asking; a decision is already made. */
export const PM_KIND_START: Readonly<Record<PmCardKind, PmCardStatus>> = {
  investigation: "investigating",
  proposal: "waiting",
  decision: "decided",
  notice: "decided",
};

/** Who decided: the user on the card, or the PM on its own. */
export const PM_DECIDERS = ["user", "pm"] as const;
export const pmDeciderSchema = z.enum(PM_DECIDERS);
export type PmDecider = z.infer<typeof pmDeciderSchema>;

export const PM_CARD_ID_PREFIX = "pm-";
/** The soft limit: over it, creating a card drops the oldest archived ones, never an active one. */
export const PM_CARD_LIMIT = 500;
export const PM_OPTION_LIMIT = 8;

export const pmCardOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(500),
  gains: z.string().max(1000).nullable().default(null),
  costs: z.string().max(1000).nullable().default(null),
});
export type PmCardOption = z.infer<typeof pmCardOptionSchema>;

/** Links to the task board, by id: tasks and their Reports tickets. */
export const pmCardLinksSchema = z.object({
  taskIds: z.array(z.string()).max(50).default([]),
  reportIds: z.array(z.string()).max(50).default([]),
});
export type PmCardLinks = z.infer<typeof pmCardLinksSchema>;

export const pmCardSchema = z.object({
  id: z.string(),
  kind: pmCardKindSchema,
  status: pmCardStatusSchema,
  title: z.string().trim().min(1).max(500),
  /** The question the user answers, for a proposal; null otherwise. */
  question: z.string().max(5000).nullable().default(null),
  options: z.array(pmCardOptionSchema).max(PM_OPTION_LIMIT).default([]),
  /** An option id the PM recommends, when it names one of the options. */
  recommend: z.string().max(40).nullable().default(null),
  why: z.string().max(2000).nullable().default(null),
  /** What the PM found out, as short markdown. */
  findings: z.string().max(20000).default(""),
  /** What was decided, in one line. */
  decision: z.string().max(5000).nullable().default(null),
  /** The user's answer as written, when they answered in the free-text field. */
  answer: z.string().max(5000).nullable().default(null),
  answerOptionId: z.string().max(40).nullable().default(null),
  decidedBy: pmDeciderSchema.nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  links: pmCardLinksSchema.default(() => pmCardLinksSchema.parse({})),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PmCard = z.infer<typeof pmCardSchema>;

/**
 * Stored inside the board's data (`data.assistant.pmBoard`). The array has no hard maximum: the
 * board keeps every active card and may pass `PM_CARD_LIMIT` when there is nothing archived.
 */
export const pmBoardSchema = z.object({
  cards: z.array(pmCardSchema).default([]),
});
export type PmBoard = z.infer<typeof pmBoardSchema>;

/**
 * The cards to keep after a create. Over the limit, only the oldest archived cards go; an active
 * card is never dropped, so the board can pass the limit when nothing is archived. The array is
 * newest first, so the last archived entry is the oldest one.
 */
export function trimPmCards(
  cards: PmCard[],
  limit: number = PM_CARD_LIMIT,
): PmCard[] {
  if (cards.length <= limit) return cards;
  const kept = [...cards];
  for (
    let index = kept.length - 1;
    index >= 0 && kept.length > limit;
    index--
  ) {
    if (kept[index]!.status === "archived") kept.splice(index, 1);
  }
  return kept;
}

/** What the overview tells the PM: counts per column and the cards waiting for the user. */
export const pmCardSummarySchema = z.object({
  id: z.string(),
  kind: pmCardKindSchema,
  status: pmCardStatusSchema,
  title: z.string(),
  question: z.string().nullable(),
  since: z.string(),
});
export type PmCardSummary = z.infer<typeof pmCardSummarySchema>;

export const pmOverviewSchema = z.object({
  investigating: z.number().int().min(0),
  waiting: z.number().int().min(0),
  decided: z.number().int().min(0),
  archived: z.number().int().min(0),
  /** The cards in `waiting`, newest update first. */
  cards: z.array(pmCardSummarySchema),
});
export type PmOverview = z.infer<typeof pmOverviewSchema>;

export interface PmCardCreateInput {
  kind: PmCardKind;
  title: string;
  question?: string | null;
  options?: PmCardOption[];
  recommend?: string | null;
  why?: string | null;
  findings?: string;
  decision?: string | null;
  decidedBy?: PmDecider | null;
  links?: PmCardLinks;
}

export interface PmCardUpdateInput {
  title?: string;
  question?: string | null;
  options?: PmCardOption[];
  recommend?: string | null;
  why?: string | null;
  findings?: string;
  decision?: string | null;
  status?: PmCardStatus;
  decidedBy?: PmDecider;
  answer?: string | null;
  answerOptionId?: string | null;
  links?: PmCardLinks;
}

/** Kinds whose cards must record a decision or an answer before they can be closed. */
export function pmNeedsAnswerToDecide(kind: PmCardKind): boolean {
  return kind === "proposal" || kind === "decision";
}

/** The recommendation when it names one of the options; null otherwise. */
export function normalizePmRecommend(
  recommend: string | null | undefined,
  options: readonly PmCardOption[],
): string | null {
  return recommend && options.some((option) => option.id === recommend)
    ? recommend
    : null;
}

/** A new card, with the status its kind starts in and the recommendation checked. */
export function newPmCard(
  id: string,
  now: string,
  input: PmCardCreateInput,
): PmCard {
  const options = (input.options ?? []).slice(0, PM_OPTION_LIMIT);
  const decided = input.kind === "decision";
  return {
    id,
    kind: input.kind,
    status: PM_KIND_START[input.kind],
    title: input.title.trim(),
    question: input.question ?? null,
    options,
    recommend: normalizePmRecommend(input.recommend, options),
    why: input.why ?? null,
    findings: input.findings ?? "",
    decision: input.decision ?? null,
    answer: null,
    answerOptionId: null,
    decidedBy: decided ? (input.decidedBy ?? "pm") : null,
    decidedAt: decided ? now : null,
    links: input.links ?? { taskIds: [], reportIds: [] },
    createdAt: now,
    updatedAt: now,
  };
}

/** Cards in a column, newest update first. */
export function pmCardsIn(
  cards: readonly PmCard[],
  status: PmCardStatus,
): PmCard[] {
  return cards
    .filter((card) => card.status === status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** How many cards wait for the user, for the tab and status bar badges. */
export function pmWaitingCount(cards: readonly PmCard[]): number {
  return cards.filter((card) => card.status === "waiting").length;
}

/** A chip under a PM card: a task or a Reports ticket the user can open. */
export interface PmCardLinkTarget {
  kind: "task" | "report";
  id: string;
  /** `#42` for a task with a number, or the id's first 8 characters. */
  label: string;
}

/** The card's links, tasks first, each id once. */
export function pmCardLinkTargets(
  card: PmCard,
  taskNumbers: Readonly<Record<string, number>> = {},
): PmCardLinkTarget[] {
  const unique = (ids: readonly string[]) => [...new Set(ids)];
  return [
    ...unique(card.links.taskIds).map((id) => ({
      kind: "task" as const,
      id,
      label: taskNumberLabel(taskNumbers[id] ?? 0) || id.slice(0, 8),
    })),
    ...unique(card.links.reportIds).map((id) => ({
      kind: "report" as const,
      id,
      label: id.slice(0, 8),
    })),
  ];
}

export function pmCardSummary(card: PmCard): PmCardSummary {
  return {
    id: card.id,
    kind: card.kind,
    status: card.status,
    title: card.title,
    question: card.question,
    since: card.updatedAt,
  };
}

export function buildPmOverview(board: PmBoard | null | undefined): PmOverview {
  const cards = board?.cards ?? [];
  return {
    investigating: pmCardsIn(cards, "investigating").length,
    waiting: pmCardsIn(cards, "waiting").length,
    decided: pmCardsIn(cards, "decided").length,
    archived: pmCardsIn(cards, "archived").length,
    cards: pmCardsIn(cards, "waiting").map(pmCardSummary),
  };
}

/** The option a card's answer names, when the option still exists. */
export function pmAnswerOption(
  card: PmCard,
  optionId: string | null,
): PmCardOption | null {
  if (!optionId) return null;
  return card.options.find((option) => option.id === optionId) ?? null;
}

/**
 * The message a user's answer sends to the PM chat. It names the card id so the PM can record the
 * follow-up on the same card.
 */
export function pmAnswerText(
  card: PmCard,
  option: PmCardOption | null,
  answer: string | null,
): string {
  const target = card.question?.trim() || card.title;
  const body = option
    ? `escolho ${option.id} (${option.label}).`
    : (answer?.trim() ?? "");
  return `Resposta a "${target}" no card ${card.id}: ${body}`;
}

/** The message "Reabrir" sends to the PM chat. */
export function pmReopenText(card: PmCard): string {
  return `Reabri a decisão do card ${card.id}: "${card.title}". Considere de novo.`;
}
