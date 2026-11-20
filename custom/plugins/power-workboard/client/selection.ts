// CUSTOM(packages): multiple selection on the task board. Pure so the click, modifier and touch
// behavior is unit-tested without React.
export interface SelectionState {
  ids: ReadonlySet<string>;
  /** The last plain selection; Shift extends from it within one column. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
  ids: new Set(),
  anchor: null,
};

export interface SelectionModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function selectionModifiers(event: {
  nativeEvent?: SelectionModifiers;
}): SelectionModifiers {
  const native = event.nativeEvent ?? {};
  return {
    ctrlKey: native.ctrlKey,
    metaKey: native.metaKey,
    shiftKey: native.shiftKey,
  };
}

/** Ctrl/Cmd or Shift, or a plain tap while a selection is active: a toggle. */
export function togglesSelection(
  state: SelectionState,
  modifiers: SelectionModifiers,
): boolean {
  return (
    state.ids.size > 0 ||
    !!modifiers.ctrlKey ||
    !!modifiers.metaKey ||
    !!modifiers.shiftKey
  );
}

export function toggleSelection(
  state: SelectionState,
  id: string,
): SelectionState {
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: ids.size ? id : null };
}

/** Shift+click selects the interval in the card's own column order, anchor included. */
export function rangeSelection(
  state: SelectionState,
  targetId: string,
  order: readonly string[],
): SelectionState {
  const target = order.indexOf(targetId);
  const anchor = state.anchor ? order.indexOf(state.anchor) : -1;
  if (target < 0 || anchor < 0)
    return { ids: new Set([targetId]), anchor: targetId };
  const [start, end] = anchor <= target ? [anchor, target] : [target, anchor];
  return {
    ids: new Set(order.slice(start, end + 1)),
    anchor: state.anchor,
  };
}

/**
 * The state after pressing a card. `active` is the selection mode (touch long-press enters it);
 * `order` is the card's column in display order. A plain press outside selection is the caller's
 * business (it opens the editor); this returns the same state.
 */
export function pressCard(
  state: SelectionState,
  id: string,
  modifiers: SelectionModifiers,
  order: readonly string[],
  active = false,
): SelectionState {
  if (modifiers.shiftKey && state.anchor)
    return rangeSelection(state, id, order);
  if (togglesSelection(state, modifiers) || active)
    return toggleSelection(state, id);
  return state;
}

/** Touch long-press: enter selection with this card, or toggle it when already selecting. */
export function longPressCard(
  state: SelectionState,
  id: string,
): SelectionState {
  if (state.ids.size) return toggleSelection(state, id);
  return { ids: new Set([id]), anchor: id };
}

/**
 * CUSTOM(packages): the cards a marquee rectangle touches, in the given (column) order. The
 * rectangle is in the column content's coordinates and every card spans the column's width.
 */
export function marqueeIds(
  rect: { left: number; top: number; right: number; bottom: number },
  cards: readonly { id: string; top: number; height: number }[],
  columnWidth: number,
): string[] {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  if (left >= columnWidth || right <= 0) return [];
  return cards
    .filter((card) => card.top < bottom && card.top + card.height > top)
    .map((card) => card.id);
}

/** CUSTOM(packages): a marquee replaces the selection, or adds to it with Ctrl/Cmd held. */
export function marqueeSelection(
  state: SelectionState,
  ids: readonly string[],
  additive: boolean,
): SelectionState {
  if (!additive)
    return ids.length
      ? { ids: new Set(ids), anchor: ids[ids.length - 1]! }
      : EMPTY_SELECTION;
  const next = new Set(state.ids);
  for (const id of ids) next.add(id);
  return { ids: next, anchor: ids[ids.length - 1] ?? state.anchor };
}

export function clearSelection(): SelectionState {
  return { ids: new Set(), anchor: null };
}

export function selectedIds(state: SelectionState): string[] {
  return [...state.ids];
}
