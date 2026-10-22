import { describe, expect, it } from "vitest";
import { resolveTopRightPaneId } from "@/components/split-container-top-right";
import type { SplitNode } from "@/stores/workspace-layout-store";

const pane = (id: string, hidden = false): SplitNode => ({
  kind: "pane",
  pane: { id, tabIds: [], focusedTabId: null, ...(hidden ? { hidden } : {}) },
});
const group = (
  id: string,
  direction: "horizontal" | "vertical",
  children: SplitNode[],
): SplitNode => ({
  kind: "group",
  group: { id, direction, children, sizes: children.map(() => 1 / children.length) },
});

describe("resolveTopRightPaneId", () => {
  it("returns the only pane", () => {
    expect(resolveTopRightPaneId(pane("a"), null)).toBe("a");
  });

  it("takes the rightmost column and the top row", () => {
    const root = group("root", "horizontal", [
      pane("left"),
      group("right", "vertical", [pane("top-right"), pane("bottom-right")]),
    ]);
    expect(resolveTopRightPaneId(root, null)).toBe("top-right");
  });

  it("skips hidden panes", () => {
    const root = group("root", "horizontal", [pane("left"), pane("right", true)]);
    expect(resolveTopRightPaneId(root, null)).toBe("left");
  });

  it("follows the maximized pane", () => {
    const root = group("root", "horizontal", [pane("left"), pane("right")]);
    expect(resolveTopRightPaneId(root, "left")).toBe("left");
  });
});
