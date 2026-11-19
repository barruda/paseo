import { describe, expect, it } from "vitest";
import { deskStatusOf } from "../shared/desk-status";

const groups = [
  { id: "ready", kind: "ready" },
  { id: "review", kind: "review" },
  { id: "qa", kind: "review" },
];
const card = (id: string, stage: string, archived: string | null = null) => ({
  id,
  stage,
  archived: archived ? { status: archived } : null,
});
const board = (cards: ReturnType<typeof card>[] = [], running: number[] = []) =>
  ({
    orchestratorStatus: Object.fromEntries(
      running.map((count, index) => [`o${index}`, { running: count }]),
    ),
    settings: { groups },
    cards,
  }) as Parameters<typeof deskStatusOf>[0];

describe("deskStatusOf", () => {
  it("is all zeros for an empty board", () => {
    expect(deskStatusOf(board(), {})).toEqual({
      running: 0,
      review: 0,
      needsYou: 0,
    });
  });
  it("sums running across orchestrators", () => {
    expect(deskStatusOf(board([], [2, 3, 0]), {}).running).toBe(5);
  });
  it("counts review-kind cards and skips archived ones", () => {
    const cards = [
      card("a", "review"),
      card("b", "ready"),
      card("c", "review", "archived"),
      card("d", "review", "external"),
    ];
    expect(deskStatusOf(board(cards), {}).review).toBe(1);
  });
  it("counts a custom review group id", () => {
    expect(deskStatusOf(board([card("a", "qa")]), {}).review).toBe(1);
  });
  it("counts needs-you deliveries of live existing cards only", () => {
    const cards = [card("a", "ready"), card("b", "ready", "archived")];
    const deliveries = {
      a: { stage: "needs-you" },
      b: { stage: "needs-you" },
      ghost: { stage: "needs-you" },
      c: { stage: "verifying" },
    };
    expect(deskStatusOf(board(cards), deliveries).needsYou).toBe(1);
  });
});
