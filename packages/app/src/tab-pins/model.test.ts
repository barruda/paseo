import { describe, expect, it } from "vitest";
import { reorderForPinToggle } from "./model";

describe("reorderForPinToggle", () => {
  it("moves a newly pinned tab to the far left when nothing is pinned", () => {
    expect(reorderForPinToggle({ tabIds: ["a", "b", "c"], pinned: new Set(), tabId: "c" })).toEqual(
      ["c", "a", "b"],
    );
  });

  it("moves a newly pinned tab right after the pinned ones", () => {
    expect(
      reorderForPinToggle({
        tabIds: ["p1", "p2", "a", "b"],
        pinned: new Set(["p1", "p2"]),
        tabId: "b",
      }),
    ).toEqual(["p1", "p2", "b", "a"]);
  });

  it("moves an unpinned tab to the start of the unpinned tabs", () => {
    expect(
      reorderForPinToggle({
        tabIds: ["p1", "p2", "p3", "a"],
        pinned: new Set(["p1", "p2", "p3"]),
        tabId: "p1",
      }),
    ).toEqual(["p2", "p3", "p1", "a"]);
  });

  it("leaves the order alone for a tab that is not in the row", () => {
    expect(reorderForPinToggle({ tabIds: ["a", "b"], pinned: new Set(), tabId: "x" })).toEqual([
      "a",
      "b",
    ]);
  });
});
