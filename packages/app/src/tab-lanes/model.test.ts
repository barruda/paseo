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

  it("opens a new tab right after the tab before it, nudging its neighbor", () => {
    const layout = layoutLanes({
      tabs: tabs("a", "new", "b"),
      positions: { a: { row: 0, x: 0 }, b: { row: 0, x: 120 } },
      width: 1000,
      gap: GAP,
    });
    expect(layout.positions.new).toEqual({ row: 0, x: 104 });
    expect(layout.positions.b).toEqual({ row: 0, x: 208 });
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

  it("moves only the tabs it lands on", () => {
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
      b: { row: 0, x: 246 },
      c: { row: 0, x: 600 },
      d: { row: 0, x: 350 },
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

it("laneOrder walks rows top to bottom, left to right", () => {
  expect(
    laneOrder({ a: { row: 1, x: 0 }, b: { row: 0, x: 300 }, c: { row: 0, x: 10 } }, [
      "a",
      "b",
      "c",
    ]),
  ).toEqual(["c", "b", "a"]);
});
