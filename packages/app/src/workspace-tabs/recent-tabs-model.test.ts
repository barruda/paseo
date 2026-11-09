import { describe, expect, it } from "vitest";
import {
  recentTabOrder,
  stepRecentTabWalk,
  walkableTabIds,
  withVisitFirst,
  TabHistory,
} from "./recent-tabs-model";

describe("mouse tab history", () => {
  it("walks back and forward through visits and drops the forward branch after a new visit", () => {
    const history = new TabHistory();
    for (const id of ["a", "b", "c"]) history.visit(id);
    expect(history.step(-1, ["a", "b", "c"])).toBe("b");
    history.visit("b");
    expect(history.step(1, ["a", "b", "c"])).toBe("c");
    expect(history.step(-1, ["a", "c"])).toBe("a");
    history.visit("d");
    expect(history.step(1, ["a", "b", "c", "d"])).toBeNull();
    expect(history.step(-1, ["a", "d"])).toBe("a");
  });
});

describe("recentTabOrder", () => {
  it("puts the current tab first, then visited tabs, then tabs never visited", () => {
    expect(
      recentTabOrder({
        visits: ["c", "a", "gone"],
        openTabIds: ["a", "b", "c", "d"],
        currentTabId: "d",
      }),
    ).toEqual(["d", "c", "a", "b"]);
  });
});

describe("withVisitFirst", () => {
  it("moves a revisited tab to the front without duplicating it", () => {
    expect(withVisitFirst(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });
});

describe("stepRecentTabWalk", () => {
  const input = {
    scope: "w1",
    visits: ["b", "a", "c"],
    openTabIds: ["a", "b", "c"],
    currentTabId: "b",
    delta: 1 as const,
  };

  it("goes to the previously visited tab on the first press", () => {
    expect(stepRecentTabWalk(null, input)?.tabId).toBe("a");
  });

  it("keeps walking the order frozen at the first press while the walk lasts", () => {
    const first = stepRecentTabWalk(null, input)!;
    const second = stepRecentTabWalk(first.walk, { ...input, visits: ["a"], currentTabId: "a" });
    expect(second?.tabId).toBe("c");
    expect(stepRecentTabWalk(second!.walk, input)?.tabId).toBe("b");
  });

  it("walks backwards with a negative delta", () => {
    expect(stepRecentTabWalk(null, { ...input, delta: -1 })?.tabId).toBe("c");
  });

  it("starts a new walk when the scope changes", () => {
    const first = stepRecentTabWalk(null, input)!;
    const other = stepRecentTabWalk(first.walk, {
      ...input,
      scope: "w2",
      visits: [],
      openTabIds: ["x", "y"],
      currentTabId: "x",
    });
    expect(other?.tabId).toBe("y");
  });

  it("goes back to the most recent walked tab when focus is outside them", () => {
    const fromBottomPanel = { ...input, currentTabId: "terminal" };
    expect(stepRecentTabWalk(null, fromBottomPanel)?.tabId).toBe("b");
    expect(stepRecentTabWalk(null, { ...fromBottomPanel, delta: -1 })?.tabId).toBe("c");
    expect(
      stepRecentTabWalk(null, { ...fromBottomPanel, currentTabId: null, openTabIds: ["b"] })?.tabId,
    ).toBe("b");
  });

  it("does nothing with a single open tab", () => {
    expect(stepRecentTabWalk(null, { ...input, openTabIds: ["b"] })).toBeNull();
  });
});

describe("walkableTabIds", () => {
  const input = { openTabIds: ["a", "b", "c"], pinnedTabIds: ["b"] };

  it("keeps pinned tabs unless asked to skip them", () => {
    expect(walkableTabIds({ ...input, skipPinned: false })).toEqual(["a", "b", "c"]);
    expect(walkableTabIds({ ...input, skipPinned: true })).toEqual(["a", "c"]);
  });

  it("leaves a pinned current tab for the most recent unpinned one", () => {
    const openTabIds = walkableTabIds({ ...input, skipPinned: true });
    const step = stepRecentTabWalk(null, {
      scope: "w1",
      visits: ["b", "c", "a"],
      openTabIds,
      currentTabId: "b",
      delta: 1,
    });
    expect(step?.tabId).toBe("c");
  });
});
