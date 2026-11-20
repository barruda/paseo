// CUSTOM(packages): the pure part of dragging a card onto a package rail. A click on a card must
// never assign it, so a drag only counts after the pointer moves past the threshold, and a rail
// never receives the package the card is already in.
export const PACKAGE_DRAG_THRESHOLD = 8;

export interface PackageDragState {
  cardId: string;
  startX: number;
  startY: number;
  moved: boolean;
}

export function beginPackageDrag(
  cardId: string,
  x: number,
  y: number,
): PackageDragState {
  return { cardId, startX: x, startY: y, moved: false };
}

export function movePackageDrag(
  state: PackageDragState | null,
  x: number,
  y: number,
): PackageDragState | null {
  if (!state || state.moved) return state;
  const distance = Math.hypot(x - state.startX, y - state.startY);
  if (distance < PACKAGE_DRAG_THRESHOLD) return state;
  return { ...state, moved: true };
}

/** Entering another rail is a drag even when the pointer moved less than the threshold. */
export function markPackageDragMoved(
  state: PackageDragState | null,
): PackageDragState | null {
  return state?.moved ? state : state ? { ...state, moved: true } : null;
}

/** The card to assign, or null for a click (and for a drag that never left the start). */
export function endPackageDrag(state: PackageDragState | null): string | null {
  return state?.moved ? state.cardId : null;
}

/** A card already in the target package (or already outside every package) is not reassigned. */
export function canAssignPackage(
  currentPackageId: string | null,
  targetPackageId: string | null,
): boolean {
  return currentPackageId !== targetPackageId;
}
