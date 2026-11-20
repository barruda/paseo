// CUSTOM(packages): multiple selection on the board.
import { expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  clearSelection,
  longPressCard,
  marqueeIds,
  marqueeSelection,
  pressCard,
  rangeSelection,
  toggleSelection,
} from "../client/selection";

const order = ["a", "b", "c", "d"];

it("ctrl/cmd toggles a card and keeps the last one as the anchor", () => {
  let state = pressCard(EMPTY_SELECTION, "b", { ctrlKey: true }, order);
  expect([...state.ids]).toEqual(["b"]);
  expect(state.anchor).toBe("b");
  state = pressCard(state, "d", { metaKey: true }, order);
  expect([...state.ids]).toEqual(["b", "d"]);
  state = pressCard(state, "b", { ctrlKey: true }, order);
  expect([...state.ids]).toEqual(["d"]);
});

it("shift extends the interval in the column order", () => {
  const first = pressCard(EMPTY_SELECTION, "b", {}, order, true);
  const range = rangeSelection(first, "d", order);
  expect([...range.ids]).toEqual(["b", "c", "d"]);
  expect(range.anchor).toBe("b");
});

it("a plain press outside selection keeps the state; inside it toggles", () => {
  expect(pressCard(EMPTY_SELECTION, "a", {}, order)).toEqual(EMPTY_SELECTION);
  const selected = toggleSelection(EMPTY_SELECTION, "a");
  expect(pressCard(selected, "b", {}, order, true).ids.has("b")).toBe(true);
});

it("touch long-press enters selection, then toggles", () => {
  const first = longPressCard(EMPTY_SELECTION, "c");
  expect([...first.ids]).toEqual(["c"]);
  const second = longPressCard(first, "a");
  expect([...second.ids]).toEqual(["c", "a"]);
  expect(clearSelection().ids.size).toBe(0);
});

// CUSTOM(packages): a marquee drag on a column selects the cards it touches.
const bounds = [
  { id: "a", top: 0, height: 40 },
  { id: "b", top: 50, height: 40 },
  { id: "c", top: 100, height: 40 },
];

it("a marquee selects the cards it overlaps, in column order", () => {
  expect(
    marqueeIds({ left: 4, top: 10, right: 200, bottom: 60 }, bounds, 300),
  ).toEqual(["a", "b"]);
  expect(
    marqueeIds({ left: 200, top: 60, right: 4, bottom: 10 }, bounds, 300),
  ).toEqual(["a", "b"]);
  expect(
    marqueeIds({ left: 4, top: 45, right: 200, bottom: 105 }, bounds, 300),
  ).toEqual(["b", "c"]);
  expect(
    marqueeIds({ left: 4, top: 200, right: 200, bottom: 260 }, bounds, 300),
  ).toEqual([]);
  // Outside the column's width, even a matching vertical range selects nothing.
  expect(
    marqueeIds({ left: 400, top: 0, right: 500, bottom: 200 }, bounds, 300),
  ).toEqual([]);
});

it("a marquee replaces the selection, or adds to it with a modifier", () => {
  const first = marqueeSelection(EMPTY_SELECTION, ["a", "b"], false);
  expect([...first.ids]).toEqual(["a", "b"]);
  expect(first.anchor).toBe("b");
  const added = marqueeSelection(first, ["c"], true);
  expect([...added.ids]).toEqual(["a", "b", "c"]);
  expect(marqueeSelection(first, [], false)).toEqual(EMPTY_SELECTION);
});
