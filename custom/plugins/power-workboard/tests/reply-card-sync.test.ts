// CUSTOM(pm-chat-sync): a chat reply's `pwb` block follows the PM card it cites, and an option
// tapped in the chat decides the card through the board's own decide path.
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { Workboard } from "../server/workboard";
import { decidePmCardOnBoard } from "../server/assistant/pm-board";
import { newPmCard, type PmCard } from "../shared/pm-board";
import { splitReply, type ReplyOption } from "../shared/reply-protocol";
import {
  cardOptionFor,
  chatCanDecide,
  chatPickDecideInput,
  decidedTimeLabel,
  replyCardView,
  replyOptionForCard,
  replyPmCardId,
} from "../shared/reply-card-sync";

const now = "2026-11-20T12:00:00.000Z";

const proposal = (patch: Partial<PmCard> = {}): PmCard => ({
  ...newPmCard("pm-abc12345", now, {
    kind: "proposal",
    title: "Publicar?",
    question: "Publicar o site agora?",
    options: [
      { id: "a", label: "Merge agora", gains: null, costs: null },
      { id: "b", label: "Esperar o CI", gains: null, costs: null },
    ],
    recommend: "a",
  }),
  ...patch,
});

const blockOptions: ReplyOption[] = [
  { id: "a", label: "Merge agora", gains: null, costs: null },
  { id: "b", label: "Esperar o CI", gains: null, costs: null },
];

const reply = (body: string) => splitReply("```pwb\n" + body + "\n```")!.reply;

describe("replyPmCardId", () => {
  it("reads the card from the seu line, else from the question", () => {
    expect(
      replyPmCardId(
        reply("pergunta: Publicar? [pm:pm-q1]\nseu: decidir [pm:pm-abc12345]"),
      ),
    ).toBe("pm-abc12345");
    expect(
      replyPmCardId(reply("pergunta: Publicar? [pm:pm-q1]\nseu: nada")),
    ).toBe("pm-q1");
    expect(replyPmCardId(reply("seu: decidir o merge [10b1b0d7]"))).toBeNull();
  });
});

describe("replyCardView", () => {
  it("draws as before when the block cites no card or the cards have not loaded", () => {
    expect(replyCardView(null, [proposal()])).toEqual({ state: "none" });
    expect(replyCardView("pm-abc12345", undefined)).toEqual({ state: "none" });
  });

  it("is missing when the card no longer exists", () => {
    expect(replyCardView("pm-gone0000", [proposal()])).toEqual({
      state: "missing",
      cardId: "pm-gone0000",
    });
  });

  it("is pending while the card waits or is being investigated", () => {
    expect(replyCardView("pm-abc12345", [proposal()]).state).toBe("pending");
    expect(
      replyCardView("pm-abc12345", [proposal({ status: "investigating" })])
        .state,
    ).toBe("pending");
  });

  it("is decided by the user with the chosen option", () => {
    const card = proposal({
      status: "decided",
      decidedBy: "user",
      decidedAt: "2026-11-20T14:32:00.000Z",
      answer: "Esperar o CI",
      answerOptionId: "b",
      decision: "Esperar o CI",
    });
    expect(replyCardView(card.id, [card], blockOptions)).toMatchObject({
      state: "decided",
      by: "user",
      at: "2026-11-20T14:32:00.000Z",
      optionId: "b",
      text: "Esperar o CI",
    });
  });

  it("is decided by the PM, with its decision when no option matches", () => {
    const card = proposal({
      status: "decided",
      decidedBy: "pm",
      decidedAt: now,
      decision: "Publico amanhã",
      answer: "Publico amanhã",
    });
    expect(replyCardView(card.id, [card], blockOptions)).toMatchObject({
      state: "decided",
      by: "pm",
      optionId: null,
      text: "Publico amanhã",
    });
  });

  it("is decided without a decider for a notice", () => {
    const card = newPmCard("pm-note0001", now, {
      kind: "notice",
      title: "Atenção",
    });
    expect(replyCardView(card.id, [card])).toMatchObject({
      state: "decided",
      by: null,
    });
  });

  it("is archived once the card is archived", () => {
    const card = proposal({ status: "archived" });
    expect(replyCardView(card.id, [card]).state).toBe("archived");
  });

  it("goes back to pending when the card is reopened", () => {
    const decided = proposal({
      status: "decided",
      decidedBy: "user",
      decidedAt: now,
      answerOptionId: "a",
      answer: "Merge agora",
    });
    expect(replyCardView(decided.id, [decided]).state).toBe("decided");
    const reopened = proposal({ status: "waiting" });
    expect(replyCardView(reopened.id, [reopened]).state).toBe("pending");
  });
});

describe("matching the block's options to the card's", () => {
  it("matches by id, then by label", () => {
    const card = proposal();
    expect(cardOptionFor(card, { id: "b", label: "whatever" })).toBe("b");
    expect(cardOptionFor(card, { id: "x", label: "esperar o ci" })).toBe("b");
    expect(cardOptionFor(card, { id: "x", label: "Outra" })).toBeNull();
  });

  it("finds the block option for the card's answer by id, label or answer text", () => {
    const relabeled: ReplyOption[] = [
      { id: "1", label: "Merge agora", gains: null, costs: null },
      { id: "2", label: "Esperar o CI", gains: null, costs: null },
    ];
    expect(
      replyOptionForCard(proposal({ answerOptionId: "b" }), relabeled),
    ).toBe("2");
    expect(
      replyOptionForCard(
        proposal({ answerOptionId: null, answer: "merge agora" }),
        relabeled,
      ),
    ).toBe("1");
    expect(
      replyOptionForCard(
        proposal({ answerOptionId: null, answer: "outra coisa" }),
        relabeled,
      ),
    ).toBeNull();
  });
});

describe("chat → card", () => {
  it("only a waiting card takes an answer from the chat", () => {
    expect(chatCanDecide(replyCardView("pm-abc12345", [proposal()]))).toBe(
      true,
    );
    for (const status of ["investigating", "decided", "archived"] as const)
      expect(
        chatCanDecide(replyCardView("pm-abc12345", [proposal({ status })])),
      ).toBe(false);
    expect(chatCanDecide(replyCardView("pm-gone0000", [proposal()]))).toBe(
      false,
    );
  });

  it("sends the card's option, or the label as the answer when none matches", () => {
    const card = proposal();
    expect(
      chatPickDecideInput(card, { id: "a", label: "Merge agora" }),
    ).toEqual({ cardId: card.id, optionId: "a", answer: null });
    expect(chatPickDecideInput(card, { id: "z", label: "Outra via" })).toEqual({
      cardId: card.id,
      optionId: null,
      answer: "Outra via",
    });
  });

  it("decides the card on the board with decidedBy user and tells the PM", async () => {
    let clock = Date.parse(now);
    const setup = fixture();
    await setup.store.load();
    const board = new Workboard(setup.host, setup.store, () => clock);
    try {
      const card = await board.pmCardCreate({
        kind: "proposal",
        title: "Publicar?",
        question: "Publicar o site agora?",
        options: [
          { id: "a", label: "Merge agora", gains: null, costs: null },
          { id: "b", label: "Esperar o CI", gains: null, costs: null },
        ],
      });
      clock += 60_000;
      const block = reply(
        [
          "pergunta: Publicar o site agora?",
          "opção: a | Merge agora",
          "opção: b | Esperar o CI",
          "próximo: você",
          `seu: decidir a publicação [pm:${card.id}]`,
        ].join("\n"),
      );
      const before = replyCardView(
        replyPmCardId(block),
        board.pmCards(),
        block.question!.options,
      );
      expect(before.state).toBe("pending");
      if (before.state !== "pending") return;

      const sent: string[] = [];
      await decidePmCardOnBoard(
        board,
        async (text) => {
          sent.push(text);
          return "q-1";
        },
        chatPickDecideInput(before.card, block.question!.options[1]!),
      );

      const after = replyCardView(
        replyPmCardId(block),
        board.pmCards(),
        block.question!.options,
      );
      expect(after).toMatchObject({
        state: "decided",
        by: "user",
        optionId: "b",
      });
      expect(sent[0]).toContain(`no card ${card.id}: escolho b (Esperar o CI)`);

      await board.pmCardReopen(card.id);
      expect(replyCardView(replyPmCardId(block), board.pmCards()).state).toBe(
        "pending",
      );
    } finally {
      board.dispose();
    }
  });
});

describe("decidedTimeLabel", () => {
  it("shows the time today and the date on another day", () => {
    const at = new Date(2026, 10, 20, 9, 5).toISOString();
    expect(decidedTimeLabel(at, new Date(2026, 10, 20, 18, 0).getTime())).toBe(
      "09:05",
    );
    expect(decidedTimeLabel(at, new Date(2026, 10, 21, 8, 0).getTime())).toBe(
      "20/11 09:05",
    );
    expect(decidedTimeLabel(null, Date.now())).toBe("");
    expect(decidedTimeLabel("nope", Date.now())).toBe("");
  });
});
