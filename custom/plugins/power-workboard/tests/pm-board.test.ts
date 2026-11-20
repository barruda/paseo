// CUSTOM(pm-board): the Project Manager's own board, its cards, the user's answer and reopen, and
// the overview the PM reads.
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { Workboard } from "../server/workboard";
import { buildOverview } from "../server/assistant/views";
import {
  decidePmCardOnBoard,
  reopenPmCardOnBoard,
} from "../server/assistant/pm-board";
import { assistantDataSchema } from "../shared/assistant";
import { buildPmOverview, newPmCard, pmWaitingCount } from "../shared/pm-board";

const now = "2026-11-20T12:00:00.000Z";

async function pmBoard() {
  let clock = Date.parse(now);
  const setup = fixture();
  await setup.store.load();
  const board = new Workboard(setup.host, setup.store, () => clock);
  return {
    board,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const option = (id: string, label: string, gains: string | null = null) => ({
  id,
  label,
  gains,
  costs: null,
});

describe("PM card model", () => {
  it("defaults a board saved before this feature to an empty PM board", () => {
    expect(assistantDataSchema.parse({}).pmBoard).toEqual({ cards: [] });
  });

  it("starts each kind in its column and checks the recommendation", () => {
    const options = [option("a", "Sim")];
    const proposal = newPmCard("pm-1", now, {
      kind: "proposal",
      title: "Publicar?",
      options,
      recommend: "b",
    });
    expect(proposal.status).toBe("waiting");
    // A recommendation of no option is dropped, not stored.
    expect(proposal.recommend).toBeNull();

    const decision = newPmCard("pm-2", now, {
      kind: "decision",
      title: "Usei o orquestrador X",
      decision: "Usei o orquestrador X",
    });
    expect(decision.status).toBe("decided");
    expect(decision.decidedBy).toBe("pm");
    expect(decision.decidedAt).toBe(now);

    expect(
      newPmCard("pm-3", now, { kind: "investigation", title: "X" }).status,
    ).toBe("investigating");
    expect(newPmCard("pm-4", now, { kind: "notice", title: "Y" }).status).toBe(
      "decided",
    );
  });
});

describe("PM board store", () => {
  it("creates, updates and archives a card without touching the task board", async () => {
    const { board, advance } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "investigation",
      title: "Personagens: restaurar ou deixar apagado?",
      findings: "Li o histórico do projeto.",
    });
    expect(card.id).toMatch(/^pm-[0-9a-f]{8}$/);
    expect(board.pmCards()).toHaveLength(1);
    expect(board.snapshot().cards).toEqual([]);

    advance(1_000);
    const updated = await board.pmCardUpdate(card.id, {
      status: "waiting",
      findings: "O histórico aponta para restaurar.",
    });
    expect(updated.status).toBe("waiting");
    expect(updated.findings).toBe("O histórico aponta para restaurar.");
    expect(updated.updatedAt > card.updatedAt).toBe(true);

    const archived = await board.pmCardArchive(card.id);
    expect(archived.status).toBe("archived");
    expect(pmWaitingCount(board.pmCards())).toBe(0);
  });

  it("records a user's answer, refuses an unknown option and reopens the card", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar o site agora?",
      options: [option("a", "Sim", "entrega hoje"), option("b", "Esperar")],
      recommend: "a",
    });

    await expect(
      board.pmCardDecide(card.id, { optionId: "z", by: "user" }),
    ).rejects.toThrow(/no option/);

    const decided = await board.pmCardDecide(card.id, {
      optionId: "a",
      by: "user",
    });
    expect(decided.status).toBe("decided");
    expect(decided.decidedBy).toBe("user");
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.answer).toBe("Sim");
    expect(decided.answerOptionId).toBe("a");

    const reopened = await board.pmCardReopen(card.id);
    expect(reopened.status).toBe("waiting");
    expect(reopened.decidedBy).toBeNull();
    expect(reopened.decidedAt).toBeNull();
    expect(reopened.answer).toBeNull();
    expect(reopened.answerOptionId).toBeNull();
    expect(reopened.decision).toBeNull();
  });
});

describe("the user's answer reaches the PM chat", () => {
  it("moves the card and sends the option in one message", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar o site agora?",
      options: [option("a", "Sim", "entrega hoje")],
      recommend: "a",
    });
    const sent: string[] = [];
    const result = await decidePmCardOnBoard(
      board,
      async (text) => {
        sent.push(text);
        return "q-1";
      },
      { cardId: card.id, optionId: "a" },
    );

    expect(result.card.status).toBe("decided");
    expect(result.card.decidedBy).toBe("user");
    expect(result.messageId).toBe("q-1");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Resposta a "Publicar o site agora?"');
    expect(sent[0]).toContain(card.id);
    expect(sent[0]).toContain("escolho a (Sim)");
  });

  it("sends a written answer and reports a failed message", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Nome do projeto",
      question: "Qual nome usar?",
    });
    const sent: string[] = [];
    const result = await decidePmCardOnBoard(
      board,
      async (text) => {
        sent.push(text);
        return null;
      },
      { cardId: card.id, answer: "Ana" },
    );
    expect(result.card.status).toBe("decided");
    expect(result.card.answer).toBe("Ana");
    expect(result.messageId).toBeNull();
    expect(sent[0]).toContain("Ana");
  });

  it("reopens the card and tells the PM", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "decision",
      title: "Usei o orquestrador X",
      decision: "Usei o orquestrador X",
    });
    const sent: string[] = [];
    const result = await reopenPmCardOnBoard(
      board,
      async (text) => {
        sent.push(text);
        return "q-2";
      },
      card.id,
    );
    expect(result.card.status).toBe("waiting");
    expect(result.card.decidedBy).toBeNull();
    expect(sent[0]).toContain("Reabri a decisão");
    expect(sent[0]).toContain(card.id);
  });
});

describe("the overview's PM section", () => {
  it("counts the columns and lists the cards waiting for the user", async () => {
    const { board } = await pmBoard();
    await board.pmCardCreate({ kind: "investigation", title: "Inv" });
    const waiting = await board.pmCardCreate({
      kind: "proposal",
      title: "Prop",
      question: "Q?",
    });
    await board.pmCardCreate({
      kind: "decision",
      title: "Dec",
      decision: "ok",
    });
    const notice = await board.pmCardCreate({ kind: "notice", title: "N" });
    await board.pmCardArchive(notice.id);

    const source = board.assistantSource();
    const pm = buildPmOverview(source.data.assistant.pmBoard);
    expect(pm).toMatchObject({
      investigating: 1,
      waiting: 1,
      decided: 1,
      archived: 1,
    });
    expect(pm.cards.map((card) => card.id)).toEqual([waiting.id]);
    expect(pm.cards[0].question).toBe("Q?");
    // The dashboard overview carries the same section for the PM.
    expect(buildOverview(source).pm).toEqual(pm);
  });
});
