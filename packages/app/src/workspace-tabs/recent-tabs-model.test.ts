import { describe, expect, it } from "vitest";
import { recentTabOrder, stepRecentTabWalk, withVisitFirst } from "./recent-tabs-model";

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

  it("does nothing with a single open tab", () => {
    expect(stepRecentTabWalk(null, { ...input, openTabIds: ["b"] })).toBeNull();
  });
});
