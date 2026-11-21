import { describe, expect, it } from "vitest";
import { headerCycleItems, nextHeaderCycleItem, type HeaderCycleItem } from "./header-cycle";

const WORKBOARD = "power-workboard";

function cycle(input: { surfaces?: string[]; desks: string[]; projectManager?: boolean }) {
  return headerCycleItems({
    surfaceIds: input.surfaces ?? [WORKBOARD],
    deskIds: input.desks,
    projectManager: input.projectManager ?? true,
  });
}

function next(
  items: HeaderCycleItem[],
  position: Partial<{
    selectedSurfaceId: string | null;
    projectManagerCurrent: boolean;
    activeDeskId: string;
  }>,
) {
  return nextHeaderCycleItem(items, {
    selectedSurfaceId: null,
    projectManagerCurrent: false,
    activeDeskId: "main",
    ...position,
  });
}

describe("header cycle", () => {
  it("lists the items in header order", () => {
    expect(cycle({ desks: ["main", "second"] })).toEqual([
      { kind: "surface", id: WORKBOARD },
      { kind: "desk", id: "main" },
      { kind: "desk", id: "second" },
      { kind: "project-manager" },
    ]);
  });

  it("goes Desk -> next Desk -> Project Manager -> Workboard -> first Desk", () => {
    const items = cycle({ desks: ["main", "second"] });
    expect(next(items, { activeDeskId: "main" })).toEqual({ kind: "desk", id: "second" });
    expect(next(items, { activeDeskId: "second" })).toEqual({ kind: "project-manager" });
    expect(next(items, { activeDeskId: "second", projectManagerCurrent: true })).toEqual({
      kind: "surface",
      id: WORKBOARD,
    });
    expect(next(items, { activeDeskId: "second", selectedSurfaceId: WORKBOARD })).toEqual({
      kind: "desk",
      id: "main",
    });
  });

  it("goes Workboard -> Desk -> Project Manager with one Desk", () => {
    const items = cycle({ desks: ["main"] });
    expect(next(items, { selectedSurfaceId: WORKBOARD })).toEqual({ kind: "desk", id: "main" });
    expect(next(items, {})).toEqual({ kind: "project-manager" });
    expect(next(items, { projectManagerCurrent: true })).toEqual({
      kind: "surface",
      id: WORKBOARD,
    });
  });

  it("skips the Workboard when its chip is not in the header", () => {
    const items = cycle({ surfaces: [], desks: ["main", "second"] });
    expect(next(items, { projectManagerCurrent: true })).toEqual({ kind: "desk", id: "main" });
    expect(next(items, { activeDeskId: "second" })).toEqual({ kind: "project-manager" });
  });

  it("skips the Project Manager when its button is not in the header", () => {
    const items = cycle({ desks: ["main", "second"], projectManager: false });
    expect(next(items, { activeDeskId: "second" })).toEqual({ kind: "surface", id: WORKBOARD });
    // A focus left in the Project Manager tab does not count without the button.
    expect(next(items, { activeDeskId: "main", projectManagerCurrent: true })).toEqual({
      kind: "desk",
      id: "second",
    });
  });

  it("puts the selected Workboard before the Project Manager focus and the active Desk", () => {
    const items = cycle({ desks: ["main", "second"] });
    expect(
      next(items, {
        selectedSurfaceId: WORKBOARD,
        projectManagerCurrent: true,
        activeDeskId: "main",
      }),
    ).toEqual({ kind: "desk", id: "main" });
  });

  it("puts the Project Manager focus before the active Desk", () => {
    const items = cycle({ desks: ["main", "second"] });
    expect(next(items, { activeDeskId: "main", projectManagerCurrent: true })).toEqual({
      kind: "surface",
      id: WORKBOARD,
    });
  });

  it("starts at the first item when nothing in the cycle is current", () => {
    const items = cycle({ desks: ["main"] });
    expect(next(items, { activeDeskId: "gone" })).toEqual({ kind: "surface", id: WORKBOARD });
    expect(next(items, { selectedSurfaceId: "closed-surface", activeDeskId: "gone" })).toEqual({
      kind: "surface",
      id: WORKBOARD,
    });
  });

  it("returns null with nothing to cycle through", () => {
    expect(next(cycle({ surfaces: [], desks: [], projectManager: false }), {})).toBeNull();
  });
});
