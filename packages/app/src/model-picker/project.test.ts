import { describe, expect, it, vi } from "vitest";
import {
  buildProjectPickerItems,
  currentProjectLabel,
  planProjectPick,
  type ModelPickerProjectSource,
} from "./project";

function source(overrides: Partial<ModelPickerProjectSource> = {}): ModelPickerProjectSource {
  return {
    selectedId: "b",
    options: [
      { id: "a", label: "DreamMMO" },
      { id: "b", label: "paseo" },
      { id: "c", label: "warp-web-custom" },
    ],
    select: vi.fn(),
    ...overrides,
  };
}

describe("buildProjectPickerItems", () => {
  it("puts the current project first without a query", () => {
    const items = buildProjectPickerItems(source(), "");
    expect(items.map((item) => item.option.id)).toEqual(["b", "a", "c"]);
    expect(items[0].current).toBe(true);
  });

  it("filters and ranks by the query", () => {
    expect(buildProjectPickerItems(source(), "wa").map((item) => item.option.id)).toEqual(["c"]);
    expect(buildProjectPickerItems(source(), "zzz")).toEqual([]);
  });
});

describe("currentProjectLabel", () => {
  it("names the selected project, or None", () => {
    expect(currentProjectLabel(source())).toBe("paseo");
    expect(currentProjectLabel(source({ selectedId: null }))).toBe("None");
  });
});

describe("planProjectPick", () => {
  it("does nothing for the current project", () => {
    expect(planProjectPick(source(), "b")).toBe("none");
  });

  it("selects in place, or closes the picker when the pick leaves the composer", () => {
    expect(planProjectPick(source(), "a")).toBe("select");
    expect(planProjectPick(source({ leavesComposer: true }), "a")).toBe("select-and-close");
  });
});
