import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const BTW_TIMELINE_KIND = "btw";
export const BTW_TIMELINE_VERSION = 1;

const turnFields = {
  question: z.string(),
  status: z.enum(["asking", "answered", "failed"]),
  answer: z.string().nullable(),
  error: z.string().nullable(),
  askedAt: z.string(),
  durationMs: z.number().nullable(),
};

/** A question asked after the first answer, from the card. */
export const btwFollowUpSchema = z.object({
  ...turnFields,
  kind: z.enum(["question", "tldr"]),
  fileNames: z.array(z.string()),
});

export type BtwFollowUp = z.output<typeof btwFollowUpSchema>;

/** The first question's fields at the top, for rows written before follow-ups existed. */
export const btwTimelineSchema = z.object({
  /** The row's own id: the card's renderer is not told it. */
  id: z.string().optional(),
  ...turnFields,
  followUps: z.array(btwFollowUpSchema).optional(),
});

export type BtwTimelineData = z.output<typeof btwTimelineSchema>;
type BtwTurn = Pick<BtwTimelineData, keyof typeof turnFields>;

/** Adds the card right away and fills in the answer when it arrives. */
export const askBtwRpc = defineRpc({
  name: "ask",
  input: z.object({ agentId: z.string().min(1), question: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});

/** Asks a follow-up (or a TLDR) in an existing card; the answer lands in the same card. */
export const followUpBtwRpc = defineRpc({
  name: "follow-up",
  input: z.object({
    agentId: z.string().min(1),
    cardId: z.string().min(1),
    /** The card as the client sees it, in case the daemon no longer has it in memory. */
    card: btwTimelineSchema,
    kind: z.enum(["question", "tldr"]),
    question: z.string(),
    files: z.array(z.object({ fileName: z.string(), mimeType: z.string(), path: z.string() })),
  }),
  output: z.object({ ok: z.literal(true) }),
});

export const TLDR_QUESTION = "TLDR";
export const TLDR_PROMPT =
  "TLDR of your last answer in this side thread: the gist in two or three short lines.";

// The row keeps every answer; the plugin row limit is 64 KiB.
const MAX_ROW_ANSWER_CHARS = 48 * 1024;

function fitAnswer(answer: string, maxChars: number): string {
  return answer.length > maxChars ? `${answer.slice(0, maxChars)}\n\n[…]` : answer;
}

export function answeredData<Turn extends BtwTurn>(
  asked: Turn,
  result: { answer: string | null; error: string | null },
  durationMs: number,
  maxChars = MAX_ROW_ANSWER_CHARS,
): Turn {
  if (result.error) return { ...asked, status: "failed", error: result.error, durationMs };
  const answer = result.answer ?? "Claude declined to answer this side question.";
  return { ...asked, status: "answered", answer: fitAnswer(answer, maxChars), durationMs };
}

/** What a follow-up may still take of the row once the earlier answers are counted. */
export function remainingAnswerChars(card: BtwTimelineData): number {
  const used = [card, ...(card.followUps ?? [])].reduce(
    (total, turn) => total + (turn.answer?.length ?? 0),
    0,
  );
  return Math.max(1024, MAX_ROW_ANSWER_CHARS - used);
}

export function cardTurns(card: BtwTimelineData): BtwTurn[] {
  return [card, ...(card.followUps ?? [])];
}

/** The answered turns, as the side question's history. */
export function threadHistory(card: BtwTimelineData): { question: string; answer: string }[] {
  return cardTurns(card).flatMap((turn) =>
    turn.status === "answered" && turn.answer
      ? [{ question: turn.question, answer: turn.answer }]
      : [],
  );
}

export function isAsking(card: BtwTimelineData): boolean {
  return cardTurns(card).some((turn) => turn.status === "asking");
}

/** The card as text, for Copy and for a branch's context. */
export function formatThread(card: BtwTimelineData): string {
  const lines = ["A side conversation (/btw) about this session, after the chat history above:"];
  for (const [index, turn] of cardTurns(card).entries()) {
    const followUp = index > 0 ? card.followUps?.[index - 1] : undefined;
    const files = followUp?.fileNames.length ? ` (attached: ${followUp.fileNames.join(", ")})` : "";
    lines.push(
      "",
      `Q: ${turn.question}${files}`,
      `A: ${turn.answer ?? turn.error ?? "(no answer)"}`,
    );
  }
  return lines.join("\n");
}
