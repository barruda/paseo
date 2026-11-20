import { expect, it } from "vitest";
import {
  MENU_EDGE,
  MENU_WIDTH,
  clampMenuPosition,
  menuSize,
  panelCardFor,
} from "../client/task-panel-state";

it("keeps the card menu inside the viewport near the right and bottom edges", () => {
  const viewport = { width: 400, height: 300 };
  const size = menuSize(5);
  expect(clampMenuPosition({ x: 390, y: 290 }, viewport, size)).toEqual({
    x: viewport.width - MENU_WIDTH - MENU_EDGE,
    y: viewport.height - size.height - MENU_EDGE,
  });
  expect(clampMenuPosition({ x: 100, y: 50 }, viewport, size)).toEqual({
    x: 100,
    y: 50,
  });
  expect(clampMenuPosition({ x: 0, y: 0 }, viewport, size)).toEqual({
    x: MENU_EDGE,
    y: MENU_EDGE,
  });
});

it("pins the menu to the edge when the viewport is smaller than it", () => {
  expect(
    clampMenuPosition(
      { x: 100, y: 100 },
      { width: 100, height: 80 },
      menuSize(5),
    ),
  ).toEqual({ x: MENU_EDGE, y: MENU_EDGE });
});

it("one panel at a time: the open id decides which card the panel shows", () => {
  const cards = [{ id: "a" }, { id: "b" }];
  expect(panelCardFor(cards, "a")).toEqual(cards[0]);
  expect(panelCardFor(cards, "b")).toEqual(cards[1]);
  expect(panelCardFor(cards, null)).toBeNull();
  expect(panelCardFor(cards, "gone")).toBeNull();
});
