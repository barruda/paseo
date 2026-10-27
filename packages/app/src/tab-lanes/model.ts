// CUSTOM(tab-lanes): a Desk pane's tabs sit in rows at free x positions instead of one packed,
// scrolling row. A tab stays where it was dropped; only the tabs it lands on move aside.

export interface LanePosition {
  row: number;
  x: number;
}

export interface LaneTab {
  id: string;
  width: number;
}

export type LanePositions = Record<string, LanePosition>;

interface LaneInput {
  /** The pane's tabs in list order. A tab without a position opens right after the one before it. */
  tabs: readonly LaneTab[];
  positions: Readonly<LanePositions>;
  /** Room for tabs in each row. */
  width: number;
  gap: number;
}

interface Item {
  id: string;
  width: number;
  row: number;
  x: number;
}

export interface LaneLayout {
  positions: LanePositions;
  rowCount: number;
}

function rowItems(items: Item[], row: number): Item[] {
  return items.filter((item) => item.row === row);
}

/** Slides the tabs that overlap `fixed` out of its way, left or right by their centers. */
function clearAround(items: Item[], fixed: Item, gap: number) {
  const center = fixed.x + fixed.width / 2;
  const others = items.filter((item) => item !== fixed);
  const right = others
    .filter((item) => item.x + item.width / 2 >= center)
    .sort((a, b) => a.x - b.x);
  const left = others.filter((item) => item.x + item.width / 2 < center).sort((a, b) => b.x - a.x);
  let cursor = fixed.x + fixed.width + gap;
  for (const item of right) {
    item.x = Math.max(item.x, cursor);
    cursor = item.x + item.width + gap;
  }
  cursor = fixed.x - gap;
  for (const item of left) {
    item.x = Math.min(item.x, cursor - item.width);
    cursor = item.x - gap;
  }
}

/** Removes overlaps and keeps the row inside [0, width]. False when the tabs don't fit. */
function fitRow(items: Item[], width: number, gap: number): boolean {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  let cursor = 0;
  for (const item of sorted) {
    item.x = Math.max(item.x, cursor);
    cursor = item.x + item.width + gap;
  }
  cursor = width;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const item = sorted[index]!;
    item.x = Math.min(item.x, cursor - item.width);
    cursor = item.x - gap;
  }
  if (sorted.length > 0 && sorted[0]!.x < 0) {
    sorted[0]!.x = 0;
    return false;
  }
  return true;
}

function rowEnd(items: Item[], row: number, gap: number): number {
  return rowItems(items, row).reduce((end, item) => Math.max(end, item.x + item.width + gap), 0);
}

function maxRow(items: Item[]): number {
  return items.reduce((max, item) => Math.max(max, item.row), -1);
}

/** Every row fits its width; a row that overflows hands its rightmost tabs to the row below. */
function settle(items: Item[], width: number, gap: number) {
  for (let row = 0; row <= maxRow(items); row += 1) {
    for (;;) {
      const tabs = rowItems(items, row);
      if (tabs.length <= 1 || fitRow(tabs, width, gap)) break;
      const last = tabs.reduce((a, b) => (b.x > a.x ? b : a));
      last.x = rowEnd(items, row + 1, gap);
      last.row = row + 1;
    }
  }
  const used = [...new Set(items.map((item) => item.row))].sort((a, b) => a - b);
  for (const item of items) {
    item.row = used.indexOf(item.row);
    item.x = Math.round(item.x);
  }
}

/** Tries `item` at (row, x); on success the row's other tabs have moved aside. */
function tryPlace(items: Item[], item: Item, row: number, x: number, width: number, gap: number) {
  const saved = rowItems(items, row).map((other) => [other, other.x] as const);
  item.row = row;
  item.x = x;
  const tabs = rowItems(items, row);
  clearAround(tabs, item, gap);
  if (fitRow(tabs, width, gap)) return true;
  for (const [other, savedX] of saved) other.x = savedX;
  return false;
}

/** Opens `item` right after `after`, or at the end of the first row with room, or on a new row. */
function placeNew(items: Item[], item: Item, after: Item | null, width: number, gap: number) {
  const rows = maxRow(items);
  if (after && tryPlace(items, item, after.row, after.x + after.width + gap, width, gap)) return;
  if (!after && tryPlace(items, item, 0, 0, width, gap)) return;
  for (let row = 0; row <= rows; row += 1) {
    if (tryPlace(items, item, row, rowEnd(items, row, gap), width, gap)) return;
  }
  item.row = rows + 1;
  item.x = 0;
}

function toLayout(items: Item[]): LaneLayout {
  const positions: LanePositions = {};
  for (const item of items) positions[item.id] = { row: item.row, x: item.x };
  return { positions, rowCount: Math.max(1, maxRow(items) + 1) };
}

function build(input: LaneInput): Item[] {
  const placed: Item[] = [];
  let previous: Item | null = null;
  const pending: Array<{ item: Item; after: Item | null }> = [];
  for (const tab of input.tabs) {
    const stored = input.positions[tab.id];
    const item: Item = { id: tab.id, width: tab.width, row: stored?.row ?? 0, x: stored?.x ?? 0 };
    if (stored) placed.push(item);
    else pending.push({ item, after: previous });
    previous = item;
  }
  for (const { item, after } of pending) {
    placeNew(placed, item, after, input.width, input.gap);
    placed.push(item);
  }
  return placed;
}

/** Where every tab sits now: stored spots, new tabs beside their neighbor, nothing overlapping. */
export function layoutLanes(input: LaneInput): LaneLayout {
  const items = build(input);
  settle(items, input.width, input.gap);
  return toLayout(items);
}

/** The layout after dropping `tabId` at (row, x). `row` may be one past the last row. */
export function dropOnLanes(
  input: LaneInput & { tabId: string; tabWidth: number; row: number; x: number },
): LaneLayout {
  const tabs = input.tabs.some((tab) => tab.id === input.tabId)
    ? input.tabs
    : [...input.tabs, { id: input.tabId, width: input.tabWidth }];
  const items = build({ ...input, tabs });
  settle(items, input.width, input.gap);
  const moving = items.find((item) => item.id === input.tabId)!;
  const row = Math.max(0, Math.min(input.row, maxRow(items.filter((i) => i !== moving)) + 1));
  moving.row = row;
  moving.x = Math.max(0, Math.min(input.x, input.width - moving.width));
  const tabsInRow = rowItems(items, row);
  clearAround(tabsInRow, moving, input.gap);
  settle(items, input.width, input.gap);
  return toLayout(items);
}

/** Tab ids by row, then left to right: the order keyboard navigation walks. */
export function laneOrder(positions: Readonly<LanePositions>, ids: readonly string[]): string[] {
  const rank = (id: string) => {
    const spot = positions[id];
    return spot ? [spot.row, spot.x] : [Number.MAX_SAFE_INTEGER, 0];
  };
  return ids.slice().sort((a, b) => {
    const [rowA, xA] = rank(a);
    const [rowB, xB] = rank(b);
    return rowA! - rowB! || xA! - xB!;
  });
}
