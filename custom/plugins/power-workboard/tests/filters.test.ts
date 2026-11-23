import { describe, expect, it } from "vitest";
import { cardSchema, newTask, type Board, type Card } from "../shared/model";
import {
  archiveListCards,
  archiveOutcomes,
  archivedBoardCards,
  archivedByColumn,
  archivedColumn,
  visibleCards,
} from "../client/board-utils";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  parseFilters,
} from "../client/filters";

const card = (id: string, overrides: Partial<Card> = {}): Card =>
  cardSchema.parse({
    ...newTask(id, `Task ${id}`, "2026-01-01T00:00:00Z"),
    stage: "todo",
    labels: [],
    managedLabels: [],
    changeRequest: null,
    changeRequestUnavailable: false,
    activity: "idle",
    dueAt: null,
    agents: [],
    ...overrides,
  });
const request: NonNullable<Card["changeRequest"]> = {
  forge: "gitlab",
  number: 1,
  url: "https://example.com/mr/1",
  title: "Fix",
  state: "open",
  checksStatus: "failure",
  reviewDecision: "changes_requested",
};
const cards = [
  card("draft"),
  card("running", {
    workspaceId: "w1",
    projectId: "p1",
    activity: "running",
    changeRequest: request,
  }),
  card("waiting", {
    workspaceId: "w2",
    projectId: "p1",
    activity: "waiting",
    changeRequest: { ...request, state: "draft" },
  }),
  card("merged", { changeRequest: { ...request, state: "merged" } }),
  card("unavailable", {
    changeRequest: request,
    changeRequestUnavailable: true,
  }),
  card("missing-unavailable", { changeRequestUnavailable: true }),
  card("unknown", { changeRequest: { ...request, state: "unknown" } }),
];
const board = { cards } as Board;

describe("remembered board filters", () => {
  it("restores only supported values and recovers from corrupt storage", () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("[]")).toEqual(DEFAULT_FILTERS);
    expect(
      parseFilters(
        JSON.stringify({
          projectId: "p1",
          search: "test",
          attentionOnly: true,
          activity: "running",
          changeRequest: "merged",
          showArchived: true,
          archivedLimit: "20",
        }),
      ),
    ).toEqual({
      projectId: "p1",
      packageId: "all",
      search: "test",
      attentionOnly: true,
      activity: "running",
      changeRequest: "merged",
      showArchived: true,
      archivedLimit: "20",
    });
    expect(parseFilters(null)).toMatchObject({
      showArchived: false,
      archivedLimit: "10",
    });
    expect(
      parseFilters(JSON.stringify({ showArchived: 1, archivedLimit: "7" })),
    ).toMatchObject({ showArchived: false, archivedLimit: "10" });
    expect(
      parseFilters(JSON.stringify({ activity: "removed", search: "keep" })),
    ).toEqual({ ...DEFAULT_FILTERS, search: "keep" });
  });
  it("counts actual conditions without treating whitespace as a filter", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: "  " })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        projectId: "none",
        activity: "idle",
        changeRequest: "none",
        attentionOnly: true,
        search: " x ",
      }),
    ).toBe(5);
  });
});

describe("combined board filters", () => {
  it("intersects agent, request, project, search, and attention filters", () => {
    expect(
      visibleCards(board, "p1", "RUNNING", true, {
        activity: "running",
        changeRequest: "open",
      }).map((card) => card.id),
    ).toEqual(["running"]);
    expect(
      visibleCards(board, "p1", "", false, {
        activity: "waiting",
        changeRequest: "open",
      }),
    ).toEqual([]);
    expect(
      visibleCards(board, "all", "", false, {
        activity: "waiting",
        changeRequest: "draft",
      }).map((card) => card.id),
    ).toEqual(["waiting"]);
  });
  it("distinguishes no request, unknown state, and unavailable stale data", () => {
    const ids = (changeRequest: "none" | "unknown" | "unavailable") =>
      visibleCards(board, "all", "", false, {
        activity: "all",
        changeRequest,
      }).map((card) => card.id);
    expect(ids("none")).toEqual(["draft"]);
    expect(ids("unknown")).toEqual(["unknown"]);
    expect(ids("unavailable")).toEqual(["unavailable", "missing-unavailable"]);
  });
  it("limits CI and review action filters to current open or draft requests", () => {
    for (const changeRequest of [
      "checks-failed",
      "changes-requested",
    ] as const) {
      expect(
        visibleCards(board, "all", "", false, {
          activity: "all",
          changeRequest,
        }).map((card) => card.id),
      ).toEqual(["running", "waiting"]);
    }
  });
});

describe("archived cards", () => {
  const archive = (
    status: "archived" | "uncertain" | "external" | "pending",
    stage: string,
    archivedAt: string | null,
    kind: "automatic" | "draft" = "automatic",
  ): Card["archived"] => ({
    operationId: "op",
    kind,
    status,
    stage,
    group: null,
    startedAt: "2026-02-01T00:00:00Z",
    archivedAt,
    lastConversationAt: null,
    detail: "d",
  });
  const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}T00:00:00Z`;
  const many = Array.from({ length: 60 }, (_, i) =>
    card(`a${String(i).padStart(2, "0")}`, {
      archived: archive("archived", "done", day((i % 28) + 1)),
      projectId: i % 2 ? "p1" : "p2",
      title: i === 5 ? "Needle" : `Task ${i}`,
    }),
  );
  const extra = [
    card("pending", { archived: archive("pending", "done", null) }),
    card("uncertain", { archived: archive("uncertain", "done", null) }),
    card("external", { archived: archive("external", "done", day(30)) }),
    card("plain"),
  ];
  const all = { cards: [...many, ...extra] } as Board;
  const on = (archivedLimit: "10" | "20" | "50" | "all", more = {}) => ({
    ...DEFAULT_FILTERS,
    showArchived: true,
    archivedLimit,
    ...more,
  });
  it("counts showArchived as one condition", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, showArchived: true })).toBe(
      1,
    );
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, archivedLimit: "all" }),
    ).toBe(0);
  });
  it("is empty unless enabled and applies the limit newest first", () => {
    expect(archivedBoardCards(all, "all", "", false, DEFAULT_FILTERS)).toEqual(
      [],
    );
    const ten = archivedBoardCards(all, "all", "", false, on("10"));
    expect(ten).toHaveLength(10);
    expect(ten[0].id).toBe("external");
    expect(archivedBoardCards(all, "all", "", false, on("20"))).toHaveLength(
      20,
    );
    expect(archivedBoardCards(all, "all", "", false, on("50"))).toHaveLength(
      50,
    );
    const everything = archivedBoardCards(all, "all", "", false, on("all"));
    expect(everything).toHaveLength(61);
    const times = everything.map((c) => Date.parse(c.archived!.archivedAt!));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const ids = everything.map((c) => c.id);
    for (const id of ["pending", "uncertain", "plain"])
      expect(ids).not.toContain(id);
  });
  it("respects project and search before the limit", () => {
    const byProject = archivedBoardCards(all, "p1", "", false, on("all"));
    expect(byProject).toHaveLength(30);
    expect(byProject.every((c) => c.projectId === "p1")).toBe(true);
    expect(
      archivedBoardCards(all, "all", "needle", false, on("10")).map(
        (c) => c.id,
      ),
    ).toEqual(["a05"]);
    expect(
      archivedBoardCards(
        all,
        "all",
        "hidden",
        false,
        on("10"),
        new Map([["a07", "a hidden note"]]),
      ).map((c) => c.id),
    ).toEqual(["a07"]);
  });
  it("lists every archive except in-flight pending ones, newest first", () => {
    const list = archiveListCards([
      card("plain"),
      card("pending", { archived: archive("pending", "done", null) }),
      card("old", { archived: archive("archived", "done", day(1)) }),
      card("draft", {
        archived: archive("archived", "done", day(5), "draft"),
      }),
      card("uncertain", { archived: archive("uncertain", "done", null) }),
      card("external", { archived: archive("external", "done", day(3)) }),
    ]);
    expect(list.map((c) => c.id)).toEqual([
      "draft",
      "external",
      "old",
      "uncertain",
    ]);
  });
  it("offers Restore on every archive and Confirm only when the outcome is unknown", () => {
    const outcomes = (archived: Card["archived"]) =>
      archiveOutcomes(card("x", { archived }));
    expect(outcomes(archive("archived", "done", day(1)))).toEqual(["restore"]);
    expect(outcomes(archive("archived", "done", day(1), "draft"))).toEqual([
      "restore",
    ]);
    expect(outcomes(archive("external", "done", null))).toEqual([
      "confirm",
      "restore",
    ]);
    expect(outcomes(archive("uncertain", "done", null))).toEqual([
      "confirm",
      "restore",
    ]);
  });
  it("places a card in its original column or falls back to the done group", () => {
    const groups = [
      { id: "todo", kind: "todo" },
      { id: "finished", kind: "done" },
    ] as never;
    const here = card("here", {
      archived: archive("archived", "todo", day(2)),
    });
    const gone = card("gone", {
      archived: archive("archived", "removed", day(1)),
    });
    expect(archivedColumn(here, groups)).toBe("todo");
    expect(archivedColumn(gone, groups)).toBe("finished");
    expect(archivedByColumn([here, gone], groups)).toEqual({
      todo: [here],
      finished: [gone],
    });
  });
});
