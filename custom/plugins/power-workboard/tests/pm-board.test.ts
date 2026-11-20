// CUSTOM(pm-board): the Project Manager's own board, its cards, the user's answer and reopen, and
// the overview the PM reads.
import { describe, expect, it, vi } from "vitest";
import { fixture } from "./fixtures";
import { Workboard } from "../server/workboard";
import { buildOverview } from "../server/assistant/views";
import {
  decidePmCardOnBoard,
  reopenPmCardOnBoard,
} from "../server/assistant/pm-board";
import { assistantDataSchema } from "../shared/assistant";
import {
  buildPmOverview,
  newPmCard,
  pmCardLinkTargets,
  pmWaitingCount,
  PM_CARD_LIMIT,
} from "../shared/pm-board";

const now = "2026-11-20T12:00:00.000Z";

async function pmBoard() {
  let clock = Date.parse(now);
  const setup = fixture();
  await setup.store.load();
  const board = new Workboard(setup.host, setup.store, () => clock);
  return {
    board,
    setup,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** A board seeded directly, so a limit test does not create hundreds of cards through the store. */
function seedCards(count: number, archived = false, start = 0) {
  return Array.from({ length: count }, (_, index) =>
    newPmCard(`pm-seed${String(start + index).padStart(4, "0")}`, now, {
      kind: "notice",
      title: `Notice ${start + index}`,
    }),
  ).map((card) => (archived ? { ...card, status: "archived" as const } : card));
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

describe("decidedBy on updates", () => {
  it("leaves a notice without a decider when it is updated", async () => {
    const { board, advance } = await pmBoard();
    const notice = await board.pmCardCreate({
      kind: "notice",
      title: "Aviso",
    });
    expect(notice.status).toBe("decided");
    expect(notice.decidedBy).toBeNull();
    expect(notice.decidedAt).toBeNull();

    advance(1_000);
    const updated = await board.pmCardUpdate(notice.id, {
      status: "decided",
      findings: "Mais contexto.",
    });
    expect(updated.decidedBy).toBeNull();
    expect(updated.decidedAt).toBeNull();
  });

  it("records the decider when a proposal becomes decided", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar agora?",
    });
    const decided = await board.pmCardUpdate(card.id, {
      status: "decided",
      decision: "Publico amanhã",
    });
    expect(decided.decidedBy).toBe("pm");
    expect(decided.decidedAt).not.toBeNull();
  });
});

describe("the 500-card limit", () => {
  it("drops the oldest archived card before any active one", async () => {
    const { board, setup } = await pmBoard();
    await setup.store.update((data) => {
      data.assistant.pmBoard.cards = [
        ...seedCards(PM_CARD_LIMIT - 1),
        ...seedCards(1, true, PM_CARD_LIMIT - 1),
      ];
    });
    const created = await board.pmCardCreate({
      kind: "notice",
      title: "O 501º",
    });
    const cards = board.pmCards();
    expect(cards).toHaveLength(PM_CARD_LIMIT);
    expect(cards.some((card) => card.id === created.id)).toBe(true);
    expect(cards.some((card) => card.status === "archived")).toBe(false);
    // No active card was dropped.
    for (const seeded of seedCards(PM_CARD_LIMIT - 1))
      expect(cards.some((card) => card.id === seeded.id)).toBe(true);
  });

  it("keeps every card when there is nothing archived to drop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { board, setup } = await pmBoard();
      await setup.store.update((data) => {
        data.assistant.pmBoard.cards = seedCards(PM_CARD_LIMIT);
      });
      const created = await board.pmCardCreate({
        kind: "notice",
        title: "O 501º",
      });
      const cards = board.pmCards();
      expect(cards).toHaveLength(PM_CARD_LIMIT + 1);
      expect(cards.some((card) => card.id === created.id)).toBe(true);
      for (const seeded of seedCards(PM_CARD_LIMIT))
        expect(cards.some((card) => card.id === seeded.id)).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("no archived card is left to drop"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("closing a card without an answer", () => {
  it("refuses a proposal decided with no decision and no answer", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar agora?",
    });
    await expect(
      board.pmCardUpdate(card.id, { status: "decided" }),
    ).rejects.toThrow(/non-empty decision or answer/);
    await expect(board.pmCardDecide(card.id, { by: "pm" })).rejects.toThrow(
      /non-empty answer or one of its options/,
    );
  });

  it("refuses a proposal decided with only the decision text", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar agora?",
    });
    await expect(
      board.pmCardDecide(card.id, { decision: "Publico amanhã", by: "pm" }),
    ).rejects.toThrow(/non-empty answer or one of its options/);
  });

  it("records the answer when the PM decides a proposal", async () => {
    const { board } = await pmBoard();
    const card = await board.pmCardCreate({
      kind: "proposal",
      title: "Publicar?",
      question: "Publicar agora?",
    });
    const decided = await board.pmCardDecide(card.id, {
      decision: "Publico amanhã",
      answer: "Amanhã",
      by: "pm",
    });
    expect(decided.status).toBe("decided");
    expect(decided.answer).toBe("Amanhã");
    expect(decided.decision).toBe("Publico amanhã");
  });
});

describe("PM card links", () => {
  it("labels a task with its ticket number and a report with its id", () => {
    const card = newPmCard("pm-1", now, {
      kind: "notice",
      title: "N",
      links: {
        taskIds: ["abcdef12-1111-2222-3333-444455556666", "deadbeef"],
        reportIds: ["cafebabe-1111-2222-3333-444455556666"],
        packageIds: [],
      },
    });
    expect(
      pmCardLinkTargets(card, {
        "abcdef12-1111-2222-3333-444455556666": 42,
      }),
    ).toEqual([
      {
        kind: "task",
        id: "abcdef12-1111-2222-3333-444455556666",
        label: "#42",
      },
      { kind: "task", id: "deadbeef", label: "deadbeef" },
      {
        kind: "report",
        id: "cafebabe-1111-2222-3333-444455556666",
        label: "cafebabe",
      },
    ]);
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
