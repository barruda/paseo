// CUSTOM(packages): multiple selection on the board.
import { expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  clearSelection,
  longPressCard,
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
