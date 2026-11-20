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
