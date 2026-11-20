import { Platform, type ViewStyle } from "react-native";
import { columnWidth } from "./board-utils";
import { DEFAULT_FILTERS, parseFilters, type BoardFilters } from "./filters";

type KeyEvent = {
  key: string;
  altKey?: boolean;
  metaKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};
declare const window: {
  localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
  getSelection?(): { removeAllRanges(): void } | null;
};
declare const document: {
  body: { style: { userSelect: string; cursor: string } };
  addEventListener(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (event: any) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (event: any) => void,
    capture?: boolean,
  ): void;
};

const storageKey = (host: string) => `power-workboard:column-widths:${host}`;

export function loadBoardFilters(host: string): BoardFilters {
  if (Platform.OS !== "web") return DEFAULT_FILTERS;
  try {
    return parseFilters(
      window.localStorage.getItem(`power-workboard:filters:${host}`),
    );
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveBoardFilters(host: string, filters: BoardFilters): boolean {
  if (Platform.OS !== "web") return true;
  try {
    window.localStorage.setItem(
      `power-workboard:filters:${host}`,
      JSON.stringify(filters),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadColumnWidths(host: string): Record<string, number> {
  if (Platform.OS !== "web") return {};
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(storageKey(host)) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, width]) => typeof width === "number" && Number.isFinite(width),
        )
        .map(([id, width]) => [id, columnWidth(width as number)]),
    );
  } catch {
    return {};
  }
}

export function saveColumnWidths(
  host: string,
  widths: Record<string, number>,
): boolean {
  if (Platform.OS !== "web") return true;
  try {
    window.localStorage.setItem(storageKey(host), JSON.stringify(widths));
    return true;
  } catch {
    return false;
  }
}

export function dragCursor(resize = false): ViewStyle {
  return Platform.OS === "web"
    ? ({
        cursor: resize ? "col-resize" : "grab",
        touchAction: "none",
      } as unknown as ViewStyle)
    : {};
}

// CUSTOM(board-drag-selection): a mousedown on a drag area starts a native text selection, and
// react-native-web drops every mousemove once a selection terminates the gesture it is about to
// hand to the handle (the column and resize handles only take over after 6 px). The drag then
// never starts and the browser keeps extending the selection over the board. Cancelling the
// mousedown default and clearing the ranges fixes that; focus is restored by hand because
// preventDefault stops the browser from focusing the area.
export function dragAreaProps(disabled = false) {
  if (Platform.OS !== "web") return {};
  return {
    onMouseDown(event: {
      button?: number;
      preventDefault(): void;
      currentTarget?: { focus?: () => void } | null;
    }) {
      if (disabled || (event.button !== undefined && event.button !== 0))
        return;
      event.preventDefault();
      window.getSelection?.()?.removeAllRanges();
      event.currentTarget?.focus?.();
    },
  };
}

export function noSelectText(): ViewStyle {
  return Platform.OS === "web"
    ? ({ userSelect: "none" } as unknown as ViewStyle)
    : {};
}

export function keyboardProps(
  onKey: (key: string, event: KeyEvent) => boolean,
) {
  if (Platform.OS !== "web") return {};
  return {
    onKeyDown(event: KeyEvent) {
      if (onKey(event.key, event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

/** CUSTOM(task-panel): close the ticket panel on Esc, without stealing other keys. */
export function onEscapeKey(onEscape: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const onKey = (event: KeyEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

export function toggleButtonState(selected: boolean) {
  return Platform.OS === "web"
    ? { "aria-pressed": selected }
    : { accessibilityState: { selected } };
}

// CUSTOM(packages): a marquee drag on a column. The listeners live until the mouse is released
// or Esc cancels it; the caller only deals with page coordinates and the additive flag.
export function marqueeGesture(
  onMove: (pageX: number, pageY: number) => void,
  onEnd: () => void,
): () => void {
  if (Platform.OS !== "web") return () => {};
  const move = (event: {
    pageX: number;
    pageY: number;
    preventDefault(): void;
  }) => {
    event.preventDefault();
    onMove(event.pageX, event.pageY);
  };
  const up = () => finish();
  const key = (event: { key: string; preventDefault(): void }) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish();
  };
  const finish = () => {
    cleanup();
    onEnd();
  };
  const cleanup = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.removeEventListener("keydown", key, true);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.addEventListener("keydown", key, true);
  return finish;
}

// CUSTOM(packages): pointer-based drag from a card to a package rail, web and desktop only.
// RNW does not forward HTML5 drag props, so the card records itself on pointerdown and the rail
// that receives the pointerup assigns it. A plain click clears the card on the document's
// pointerup before it can leak into a later drag.
let packageDragCard: string | null = null;

export function packageCardPointer(id: string): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    onPointerDown: () => {
      packageDragCard = id;
      const clear = () => {
        packageDragCard = null;
        document.removeEventListener("pointerup", clear);
      };
      document.addEventListener("pointerup", clear);
    },
  };
}

export function packageRailPointer(
  onDropCard: (cardId: string) => void,
  onOver: (over: boolean) => void,
): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    onPointerEnter: () => {
      if (packageDragCard) onOver(true);
    },
    onPointerLeave: () => onOver(false),
    onPointerUp: () => {
      const cardId = packageDragCard;
      packageDragCard = null;
      onOver(false);
      if (cardId) onDropCard(cardId);
    },
  };
}

export function duringDrag(cancel: () => void, resize = false): () => void {
  if (Platform.OS !== "web") return () => {};
  const { cursor, userSelect } = document.body.style;
  document.body.style.cursor = resize ? "col-resize" : "grabbing";
  document.body.style.userSelect = "none";
  window.getSelection?.()?.removeAllRanges();
  const onKey = (event: KeyEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", cancel);
  return () => {
    document.body.style.cursor = cursor;
    document.body.style.userSelect = userSelect;
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", cancel);
  };
}
