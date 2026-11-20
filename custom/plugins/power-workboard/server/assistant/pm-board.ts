// CUSTOM(pm-board): the two actions the user takes on a PM card. Both record the change on the
// card and tell the Project Manager chat, so the PM can act on what the user decided. Kept here,
// apart from the RPC wiring, so the message and the status change are tested together.
import {
  pmAnswerOption,
  pmAnswerText,
  pmReopenText,
  type PmCard,
} from "../../shared/pm-board";

/** What a user's answer or a reopen does to the board. */
export interface PmBoardPort {
  pmCardDecide(
    id: string,
    input: {
      optionId?: string | null;
      answer?: string | null;
      by: "user";
    },
  ): Promise<PmCard>;
  pmCardReopen(id: string): Promise<PmCard>;
}

/** Sends a message to the PM chat; null when it could not be sent. */
export type SendPmMessage = (text: string) => Promise<string | null>;

export interface PmCardActionResult {
  card: PmCard;
  messageId: string | null;
}

/** Records the user's answer on the card, then messages the PM with it. */
export async function decidePmCardOnBoard(
  board: PmBoardPort,
  send: SendPmMessage,
  input: {
    cardId: string;
    optionId?: string | null;
    answer?: string | null;
  },
): Promise<PmCardActionResult> {
  const card = await board.pmCardDecide(input.cardId, {
    optionId: input.optionId,
    answer: input.answer,
    by: "user",
  });
  const option = pmAnswerOption(card, card.answerOptionId);
  const messageId = await send(
    pmAnswerText(card, option, input.answer ?? null),
  );
  return { card, messageId };
}

/** Sends a decided card back to "Esperando você" and tells the PM. */
export async function reopenPmCardOnBoard(
  board: PmBoardPort,
  send: SendPmMessage,
  cardId: string,
): Promise<PmCardActionResult> {
  const card = await board.pmCardReopen(cardId);
  const messageId = await send(pmReopenText(card));
  return { card, messageId };
}
