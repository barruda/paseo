import { expect, it } from "vitest";
import {
  MENU_EDGE,
  MENU_WIDTH,
  clampMenuPosition,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  loadPanelWidthFrom,
  menuSize,
  middleClickHandler,
  middleClickPanel,
  openPanel,
  panelCardFor,
  resizedPanelWidth,
  savePanelWidthTo,
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

it("clamps the panel width to its bounds and the board's share of the container", () => {
  expect(clampPanelWidth(100, 1600)).toBe(PANEL_MIN_WIDTH);
  expect(clampPanelWidth(2000, 2000)).toBe(PANEL_MAX_WIDTH);
  expect(clampPanelWidth(700, 800)).toBe(440);
  expect(clampPanelWidth(500, 500)).toBe(PANEL_MIN_WIDTH);
  expect(clampPanelWidth(500.4, 0)).toBe(500);
  expect(clampPanelWidth(Number.NaN, 1600)).toBe(PANEL_DEFAULT_WIDTH);
});

it("dragging the left edge leftwards widens the panel", () => {
  expect(resizedPanelWidth(400, 1000, 900, 2000)).toBe(500);
  expect(resizedPanelWidth(400, 1000, 1050, 2000)).toBe(350);
  expect(resizedPanelWidth(400, 1000, 0, 2000)).toBe(PANEL_MAX_WIDTH);
  expect(resizedPanelWidth(400, 1000, 2000, 2000)).toBe(PANEL_MIN_WIDTH);
});

it("remembers the panel width per host and survives bad storage", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  expect(loadPanelWidthFrom(storage, "a")).toBe(PANEL_DEFAULT_WIDTH);
  expect(savePanelWidthTo(storage, "a", 512)).toBe(true);
  expect(loadPanelWidthFrom(storage, "a")).toBe(512);
  expect(loadPanelWidthFrom(storage, "b")).toBe(PANEL_DEFAULT_WIDTH);
  for (const garbage of ["nope", '"x"', "null", "{}"]) {
    data.set("power-workboard:panel-width:a", garbage);
    expect(loadPanelWidthFrom(storage, "a")).toBe(PANEL_DEFAULT_WIDTH);
  }
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(loadPanelWidthFrom(throwing, "a")).toBe(PANEL_DEFAULT_WIDTH);
  expect(savePanelWidthTo(throwing, "a", 500)).toBe(false);
});

it("the Agent view needs an agent", () => {
  expect(openPanel("t", "agent", "a1")).toEqual({
    taskId: "t",
    view: "agent",
    agentId: "a1",
  });
  expect(openPanel("t", "agent", null)).toEqual({
    taskId: "t",
    view: "ticket",
    agentId: null,
  });
  expect(openPanel("t", "ticket", "a1").agentId).toBeNull();
});

it("a middle click on the Open agent link shows the agent, elsewhere the ticket", () => {
  expect(
    middleClickPanel({ taskId: "t", agentId: "a1", onAgentLink: true }).view,
  ).toBe("agent");
  expect(
    middleClickPanel({ taskId: "t", agentId: null, onAgentLink: true }).view,
  ).toBe("ticket");
  expect(
    middleClickPanel({ taskId: "t", agentId: "a1", onAgentLink: false }),
  ).toEqual({ taskId: "t", view: "ticket", agentId: null });
});

it("the middle click handler reacts to button 1 only", () => {
  const calls: string[] = [];
  const handler = middleClickHandler(() => calls.push("cb"));
  const event = (button: number) => ({
    button,
    preventDefault: () => void calls.push("prevent"),
    stopPropagation: () => void calls.push("stop"),
  });
  handler(event(0));
  expect(calls).toEqual([]);
  handler(event(1));
  expect(calls).toEqual(["prevent", "stop", "cb"]);
});
