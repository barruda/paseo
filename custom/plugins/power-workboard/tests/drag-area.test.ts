// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { Platform } from "react-native";
import { dragAreaProps, duringDrag, noSelectText } from "../client/web";

// The plugin's tsconfig has no DOM lib, so this test declares the few jsdom globals it uses.
type RangeLike = { selectNodeContents(node: unknown): void };
type SelectionLike = {
  toString(): string;
  rangeCount: number;
  removeAllRanges(): void;
  addRange(range: RangeLike): void;
};
type DragAreaElement = {
  textContent: string;
  focus(): void;
  addEventListener(
    name: string,
    listener: (event: DragMouseEvent) => void,
  ): void;
  dispatchEvent(event: DragMouseEvent): boolean;
};
type DragMouseEvent = {
  defaultPrevented: boolean;
  currentTarget: unknown;
  preventDefault(): void;
};

declare const window: { getSelection(): SelectionLike | null };
declare const document: {
  body: { innerHTML: string; appendChild(node: unknown): void };
  createElement(tag: string): DragAreaElement;
  createRange(): RangeLike;
};
declare const MouseEvent: new (
  type: string,
  init: { bubbles: boolean; cancelable: boolean },
) => DragMouseEvent;

const platform = Platform as unknown as { OS: "native" | "web" };

afterEach(() => {
  platform.OS = "native";
  document.body.innerHTML = "";
});

it("a mousedown on a drag area cancels the selection instead of starting one", () => {
  platform.OS = "web";
  const area = document.createElement("div");
  area.textContent = "Ready to review";
  document.body.appendChild(area);

  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(area);
  selection.addRange(range);
  expect(selection.toString()).toBe("Ready to review");

  let focused = false;
  area.focus = () => {
    focused = true;
  };
  const props = dragAreaProps() as unknown as {
    onMouseDown(event: DragMouseEvent): void;
  };
  area.addEventListener("mousedown", (event) => props.onMouseDown(event));

  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  area.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(selection.toString()).toBe("");
  expect(selection.rangeCount).toBe(0);
  // preventDefault also stops the browser from focusing the area.
  expect(focused).toBe(true);
  expect(noSelectText()).toEqual({ userSelect: "none" });
});

it("a disabled drag area keeps the browser's mousedown behavior", () => {
  platform.OS = "web";
  const props = dragAreaProps(true) as unknown as {
    onMouseDown(event: DragMouseEvent): void;
  };
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  props.onMouseDown(event);
  expect(event.defaultPrevented).toBe(false);
});

it("a drag that begins clears a selection made elsewhere", () => {
  platform.OS = "web";
  const area = document.createElement("div");
  area.textContent = "some text";
  document.body.appendChild(area);
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(area);
  selection.addRange(range);
  expect(selection.toString()).toBe("some text");

  const cleanup = duringDrag(() => {});
  expect(selection.toString()).toBe("");
  cleanup();
});

it("native gets no web handlers and no selection style", () => {
  platform.OS = "native";
  expect(dragAreaProps()).toEqual({});
  expect(noSelectText()).toEqual({});
});
