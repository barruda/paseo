// CUSTOM(tab-lanes): a Desk pane's tabs sit in rows at free x positions instead of one packed,
// scrolling row. A tab stays where it was dropped; only the tabs it lands on move aside.
// CUSTOM(tab-lanes-sticky): only tabs the user dropped (or pinned) have a stored spot and stay
// put. Every other tab packs to the left in list order, around them, so closing an untouched tab
// leaves no gap.

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
  /** The pane's tabs in list order. Tabs without a stored spot pack left in this order. */
  tabs: readonly LaneTab[];
  /** The sticky tabs' spots. */
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
  /** The sticky tabs' spots after this layout: what to store. */
  sticky: LanePositions;
  rowCount: number;
}

/** A dropped tab this close to the tab on its left snaps against it instead of leaving a sliver. */
const SNAP_DISTANCE = 48;

function rowItems(items: Item[], row: number): Item[] {
  return items.filter((item) => item.row === row);
}

/**
 * Fits `fixed` into the gap between the tabs left and right of its center. If the gap is wide
 * enough, nothing else moves and `fixed` only slides inside it; a tab over a neighbor's edge snaps
 * beside it instead of shoving it. Otherwise the gap opens up just enough: from the left first when
 * `prefer` is "left" (a tab dragged rightward leaves room there), then from the right.
 */
function insertInto(items: Item[], fixed: Item, gap: number, prefer: "left" | "right") {
  const center = fixed.x + fixed.width / 2;
  const others = items.filter((item) => item !== fixed);
  const right = others
    .filter((item) => item.x + item.width / 2 >= center)
    .sort((a, b) => a.x - b.x);
  const left = others.filter((item) => item.x + item.width / 2 < center).sort((a, b) => b.x - a.x);
  let slotStart = left[0] ? left[0].x + left[0].width + gap : 0;
  const slotEnd = right[0] ? right[0].x - gap : Number.POSITIVE_INFINITY;
  if (slotEnd - slotStart >= fixed.width) {
    fixed.x = Math.max(slotStart, Math.min(fixed.x, slotEnd - fixed.width));
    return;
  }
  if (prefer === "left") {
    const packedEnd = left.reduce((end, item) => end + item.width + gap, 0);
    const take = Math.min(fixed.width - (slotEnd - slotStart), Math.max(0, slotStart - packedEnd));
    slotStart -= take;
    let cursor = slotStart - gap;
    for (const item of left) {
      item.x = Math.min(item.x, cursor - item.width);
      cursor = item.x - gap;
    }
  }
  fixed.x = slotStart;
  let cursor = fixed.x + fixed.width + gap;
  for (const item of right) {
    item.x = Math.max(item.x, cursor);
    cursor = item.x + item.width + gap;
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
}

/** Drops empty rows and rounds positions. */
function compactRows(items: Item[]) {
  const used = [...new Set(items.map((item) => item.row))].sort((a, b) => a - b);
  for (const item of items) {
    item.row = used.indexOf(item.row);
    item.x = Math.round(item.x);
  }
}

/** The first x at or after `from` in `row` where `width` fits between the sticky tabs. */
function firstFit(
  fixed: Item[],
  row: number,
  from: number,
  width: number,
  rowWidth: number,
  gap: number,
): number | null {
  const blockers = rowItems(fixed, row).sort((a, b) => a.x - b.x);
  // A tab wider than an empty row still has to go somewhere.
  if (blockers.length === 0 && from === 0) return 0;
  let start = from;
  for (const blocker of blockers) {
    if (blocker.x + blocker.width + gap <= start) continue;
    if (start + width + gap <= blocker.x) break;
    start = Math.max(start, blocker.x + blocker.width + gap);
  }
  return start + width <= rowWidth ? start : null;
}

/** Packs the loose tabs left to right, row after row, in list order, around the sticky ones. */
function flow(fixed: Item[], loose: Item[], width: number, gap: number) {
  let row = 0;
  let cursor = 0;
  for (const item of loose) {
    for (;;) {
      const x = firstFit(fixed, row, cursor, item.width, width, gap);
      if (x !== null) {
        item.row = row;
        item.x = x;
        cursor = x + item.width + gap;
        break;
      }
      row += 1;
      cursor = 0;
    }
  }
}

function toLayout(fixed: Item[], loose: Item[]): LaneLayout {
  const items = [...fixed, ...loose];
  compactRows(items);
  const positions: LanePositions = {};
  for (const item of items) positions[item.id] = { row: item.row, x: item.x };
  const sticky: LanePositions = {};
  for (const item of fixed) sticky[item.id] = { row: item.row, x: item.x };
  return { positions, sticky, rowCount: Math.max(1, maxRow(items) + 1) };
}

function split(input: LaneInput): { fixed: Item[]; loose: Item[] } {
  const fixed: Item[] = [];
  const loose: Item[] = [];
  for (const tab of input.tabs) {
    const stored = input.positions[tab.id];
    const item: Item = { id: tab.id, width: tab.width, row: stored?.row ?? 0, x: stored?.x ?? 0 };
    (stored ? fixed : loose).push(item);
  }
  return { fixed, loose };
}

/** Where every tab sits now: sticky tabs at their spots, the rest packed left around them. */
export function layoutLanes(input: LaneInput): LaneLayout {
  const { fixed, loose } = split(input);
  settle(fixed, input.width, input.gap);
  flow(fixed, loose, input.width, input.gap);
  return toLayout(fixed, loose);
}

/** The right edge of the tabs left of `item` in its row, `gap` included; 0 when there are none. */
function leftEdge(items: Item[], item: Item, gap: number): number {
  return rowItems(items, item.row)
    .filter((other) => other !== item && other.x < item.x)
    .reduce((edge, other) => Math.max(edge, other.x + other.width + gap), 0);
}

/**
 * The layout after dropping `tabId` at (row, x); the tab becomes sticky. `row` may be one past the
 * last row.
 */
export function dropOnLanes(
  input: LaneInput & { tabId: string; tabWidth: number; row: number; x: number },
): LaneLayout {
  const isOwnTab = input.tabs.some((tab) => tab.id === input.tabId);
  const tabs = isOwnTab ? input.tabs : [...input.tabs, { id: input.tabId, width: input.tabWidth }];
  const before = layoutLanes({ ...input, tabs });
  const { fixed, loose } = split({ ...input, tabs });
  const moving = [...fixed, ...loose].find((item) => item.id === input.tabId)!;
  const others = loose.filter((item) => item !== moving);
  const sticky = fixed.includes(moving) ? fixed : [...fixed, moving];
  settle(
    sticky.filter((item) => item !== moving),
    input.width,
    input.gap,
  );
  const now = before.positions[input.tabId]!;
  const row = Math.max(0, Math.min(input.row, before.rowCount));
  const x = Math.max(0, Math.min(input.x, input.width - moving.width));
  // Moving rightward along its own row, the tab left room on the left: close that up first.
  const prefer = isOwnTab && now.row === row && now.x < x ? "left" : "right";
  moving.row = row;
  moving.x = x;
  insertInto(rowItems(sticky, row), moving, input.gap, prefer);
  settle(sticky, input.width, input.gap);
  flow(sticky, others, input.width, input.gap);
  const edge = leftEdge([...sticky, ...others], moving, input.gap);
  if (moving.x > edge && moving.x - edge < SNAP_DISTANCE) {
    moving.x = edge;
    flow(sticky, others, input.width, input.gap);
  }
  return toLayout(sticky, others);
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
