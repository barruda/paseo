import { describe, expect, it } from "vitest";
import { dropOnLanes, laneOrder, layoutLanes } from "./model";

const GAP = 4;
const tabs = (...ids: string[]) => ids.map((id) => ({ id, width: 100 }));

describe("layoutLanes", () => {
  it("packs tabs without positions into the first row, in list order", () => {
    const layout = layoutLanes({ tabs: tabs("a", "b", "c"), positions: {}, width: 1000, gap: GAP });
    expect(layout.rowCount).toBe(1);
    expect(layout.positions).toEqual({
      a: { row: 0, x: 0 },
      b: { row: 0, x: 104 },
      c: { row: 0, x: 208 },
    });
  });

  it("keeps gaps between placed tabs", () => {
    const layout = layoutLanes({
      tabs: tabs("a", "b"),
      positions: { a: { row: 0, x: 0 }, b: { row: 0, x: 500 } },
      width: 1000,
      gap: GAP,
    });
    expect(layout.positions.b).toEqual({ row: 0, x: 500 });
  });

  it("packs tabs without a spot around the sticky ones, in list order", () => {
    const layout = layoutLanes({
      tabs: tabs("a", "b", "s", "c"),
      positions: { s: { row: 0, x: 150 } },
      width: 1000,
      gap: GAP,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 0 },
      s: { row: 0, x: 150 },
      b: { row: 0, x: 254 },
      c: { row: 0, x: 358 },
    });
    expect(layout.sticky).toEqual({ s: { row: 0, x: 150 } });
  });

  it("closes the gap of a closed tab nobody moved", () => {
    const layout = layoutLanes({ tabs: tabs("a", "c"), positions: {}, width: 1000, gap: GAP });
    expect(layout.positions.c).toEqual({ row: 0, x: 104 });
  });

  it("opens a new tab on a second row when the first is full", () => {
    const layout = layoutLanes({ tabs: tabs("a", "b", "c"), positions: {}, width: 210, gap: GAP });
    expect(layout.rowCount).toBe(2);
    expect(layout.positions.c).toEqual({ row: 1, x: 0 });
  });

  it("slides tabs back inside a narrower row, then hands overflow to the next row", () => {
    const layout = layoutLanes({
      tabs: tabs("a", "b", "c"),
      positions: { a: { row: 0, x: 0 }, b: { row: 0, x: 400 }, c: { row: 0, x: 800 } },
      width: 210,
      gap: GAP,
    });
    expect(layout.positions.a).toEqual({ row: 0, x: 0 });
    expect(layout.positions.b).toEqual({ row: 0, x: 104 });
    expect(layout.positions.c).toEqual({ row: 1, x: 0 });
  });

  it("drops empty rows", () => {
    const layout = layoutLanes({
      tabs: tabs("a"),
      positions: { a: { row: 1, x: 40 } },
      width: 1000,
      gap: GAP,
    });
    expect(layout.positions.a).toEqual({ row: 0, x: 40 });
  });
});

describe("dropOnLanes", () => {
  const packed = { a: { row: 0, x: 0 }, b: { row: 0, x: 104 }, c: { row: 0, x: 208 } };

  it("drops a tab alone in the middle of a new second row", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: packed,
      width: 1000,
      gap: GAP,
      tabId: "c",
      tabWidth: 100,
      row: 1,
      x: 450,
    });
    expect(layout.rowCount).toBe(2);
    expect(layout.positions.c).toEqual({ row: 1, x: 450 });
    expect(layout.positions.b).toEqual({ row: 0, x: 104 });
  });

  it("caps the row at one past the last", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b"),
      positions: { a: { row: 0, x: 0 }, b: { row: 0, x: 104 } },
      width: 1000,
      gap: GAP,
      tabId: "b",
      tabWidth: 100,
      row: 5,
      x: 0,
    });
    expect(layout.positions.b).toEqual({ row: 1, x: 0 });
  });

  it("fits a tab into a wide enough gap without moving its neighbors", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c", "d"),
      positions: {
        a: { row: 0, x: 0 },
        b: { row: 0, x: 300 },
        c: { row: 0, x: 600 },
        d: { row: 0, x: 800 },
      },
      width: 1000,
      gap: GAP,
      tabId: "d",
      tabWidth: 100,
      row: 0,
      x: 350,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 0 },
      b: { row: 0, x: 300 },
      c: { row: 0, x: 600 },
      d: { row: 0, x: 404 },
    });
  });

  it("doesn't shove the tabs to its right while dragged a little", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: packed,
      width: 1000,
      gap: GAP,
      tabId: "a",
      tabWidth: 100,
      row: 0,
      x: 40,
    });
    expect(layout.positions).toEqual(packed);
  });

  it("moved right past a neighbor, swaps with it like a reorder", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: packed,
      width: 1000,
      gap: GAP,
      tabId: "a",
      tabWidth: 100,
      row: 0,
      x: 120,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 104 },
      b: { row: 0, x: 0 },
      c: { row: 0, x: 208 },
    });
  });

  it("moved left past a neighbor, swaps with it like a reorder", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: packed,
      width: 1000,
      gap: GAP,
      tabId: "c",
      tabWidth: 100,
      row: 0,
      x: 90,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 0 },
      b: { row: 0, x: 208 },
      c: { row: 0, x: 104 },
    });
  });

  it("dropped between two packed tabs of another row, pushes only the right ones", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c", "z"),
      positions: { ...packed, z: { row: 1, x: 0 } },
      width: 1000,
      gap: GAP,
      tabId: "z",
      tabWidth: 100,
      row: 0,
      x: 60,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 0 },
      b: { row: 0, x: 208 },
      c: { row: 0, x: 312 },
      z: { row: 0, x: 104 },
    });
  });

  it("takes a tab from another pane", () => {
    const layout = dropOnLanes({
      tabs: tabs("a"),
      positions: { a: { row: 0, x: 0 } },
      width: 1000,
      gap: GAP,
      tabId: "z",
      tabWidth: 80,
      row: 0,
      x: 300,
    });
    expect(layout.positions.z).toEqual({ row: 0, x: 300 });
  });
});

describe("dropOnLanes with tabs nobody moved", () => {
  it("moved right past a neighbor, snaps beside it and only the moved tab sticks", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: {},
      width: 1000,
      gap: GAP,
      tabId: "a",
      tabWidth: 100,
      row: 0,
      x: 120,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 104 },
      b: { row: 0, x: 0 },
      c: { row: 0, x: 208 },
    });
    expect(layout.sticky).toEqual({ a: { row: 0, x: 104 } });
  });

  it("dropped far from its neighbors, stays there and the rest packs around it", () => {
    const layout = dropOnLanes({
      tabs: tabs("a", "b", "c"),
      positions: {},
      width: 1000,
      gap: GAP,
      tabId: "a",
      tabWidth: 100,
      row: 0,
      x: 600,
    });
    expect(layout.positions).toEqual({
      a: { row: 0, x: 600 },
      b: { row: 0, x: 0 },
      c: { row: 0, x: 104 },
    });
  });
});

it("laneOrder walks rows top to bottom, left to right", () => {
  expect(
    laneOrder({ a: { row: 1, x: 0 }, b: { row: 0, x: 300 }, c: { row: 0, x: 10 } }, [
      "a",
      "b",
      "c",
    ]),
  ).toEqual(["c", "b", "a"]);
});
