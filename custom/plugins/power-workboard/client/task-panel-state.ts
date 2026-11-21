// CUSTOM(task-panel): pure geometry and selection for the ticket panel and its card menu.
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const MENU_EDGE = 8;
export const MENU_WIDTH = 220;
export const MENU_ITEM_HEIGHT = 34;
export const MENU_PADDING = 8;

export function menuSize(itemCount: number): Size {
  return {
    width: MENU_WIDTH,
    height: itemCount * MENU_ITEM_HEIGHT + MENU_PADDING,
  };
}

/** Keep the menu inside the viewport; a viewport smaller than the menu pins it to the edge. */
export function clampMenuPosition(
  point: Point,
  viewport: Size,
  size: Size,
): Point {
  const maxX = Math.max(MENU_EDGE, viewport.width - size.width - MENU_EDGE);
  const maxY = Math.max(MENU_EDGE, viewport.height - size.height - MENU_EDGE);
  return {
    x: Math.max(MENU_EDGE, Math.min(point.x, maxX)),
    y: Math.max(MENU_EDGE, Math.min(point.y, maxY)),
  };
}

/** The panel shows the card with the open id, so opening another ticket replaces the first. */
export function panelCardFor<T extends { id: string }>(
  cards: readonly T[],
  panelTaskId: string | null,
): T | null {
  if (!panelTaskId) return null;
  return cards.find((card) => card.id === panelTaskId) ?? null;
}

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 960;
export const PANEL_DEFAULT_WIDTH = 380;
/** Board space the panel always leaves. */
export const PANEL_BOARD_MIN_WIDTH = 360;

export function clampPanelWidth(width: number, containerWidth: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT_WIDTH;
  const max =
    containerWidth > 0
      ? Math.min(PANEL_MAX_WIDTH, containerWidth - PANEL_BOARD_MIN_WIDTH)
      : PANEL_MAX_WIDTH;
  return Math.round(
    Math.max(PANEL_MIN_WIDTH, Math.min(width, Math.max(max, PANEL_MIN_WIDTH))),
  );
}

/** Dragging the left edge leftwards widens the panel. */
export function resizedPanelWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  containerWidth: number,
): number {
  return clampPanelWidth(startWidth + (startX - currentX), containerWidth);
}

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

declare const localStorage: StorageLike | undefined;

const panelWidthKey = (host: string) => `power-workboard:panel-width:${host}`;

export function loadPanelWidthFrom(storage: StorageLike, host: string): number {
  try {
    const raw = storage.getItem(panelWidthKey(host));
    if (raw === null) return PANEL_DEFAULT_WIDTH;
    const value = JSON.parse(raw);
    if (typeof value !== "number" || !Number.isFinite(value))
      return PANEL_DEFAULT_WIDTH;
    return clampPanelWidth(value, 0);
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

export function savePanelWidthTo(
  storage: StorageLike,
  host: string,
  width: number,
): boolean {
  try {
    storage.setItem(
      panelWidthKey(host),
      JSON.stringify(clampPanelWidth(width, 0)),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadPanelWidth(host: string): number {
  try {
    return typeof localStorage === "undefined"
      ? PANEL_DEFAULT_WIDTH
      : loadPanelWidthFrom(localStorage, host);
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

export function savePanelWidth(host: string, width: number): boolean {
  try {
    return (
      typeof localStorage === "undefined" ||
      savePanelWidthTo(localStorage, host, width)
    );
  } catch {
    return false;
  }
}

export type PanelView = "ticket" | "agent";
export type PanelState = {
  taskId: string;
  view: PanelView;
  agentId: string | null;
};

/** The Agent view needs an agent; without one the panel shows the ticket. */
export function openPanel(
  taskId: string,
  view: PanelView,
  agentId: string | null,
): PanelState {
  if (view === "agent" && agentId) return { taskId, view, agentId };
  return { taskId, view: "ticket", agentId: null };
}

/** Middle click on the Open agent link shows that agent; anywhere else on the card, the ticket. */
export function middleClickPanel(input: {
  taskId: string;
  agentId: string | null;
  onAgentLink: boolean;
}): PanelState {
  return openPanel(
    input.taskId,
    input.onAgentLink ? "agent" : "ticket",
    input.agentId,
  );
}

type MiddleClickEvent = {
  button?: number;
  preventDefault?(): void;
  stopPropagation?(): void;
};

/** Button 1 only. It stops propagation so a click on the link never also opens the card's ticket. */
export function middleClickHandler(
  callback: () => void,
): (event: MiddleClickEvent) => void {
  return (event) => {
    if (event.button !== 1) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    callback();
  };
}
