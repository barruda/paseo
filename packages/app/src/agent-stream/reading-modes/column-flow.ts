// CUSTOM(reading-modes): geometry of a wrapped multi-column flow (CSS `column-wrap`). Content
// fills the columns of a row left to right, then the next row below. Each column is a page.

export interface ColumnFlowGeometry {
  /** Width of the multi-column box. */
  width: number;
  columnMinWidth: number;
  maxColumns?: number;
  columnGap: number;
  columnHeight: number;
  /** Column height plus the gap between rows. */
  rowPitch: number;
}

/** How many columns the browser lays out side by side, as `column-width` + `column-count` do. */
export function columnsPerRow(geometry: ColumnFlowGeometry): number {
  const fit = Math.max(
    1,
    Math.floor(
      (geometry.width + geometry.columnGap) / (geometry.columnMinWidth + geometry.columnGap),
    ),
  );
  return geometry.maxColumns ? Math.min(fit, geometry.maxColumns) : fit;
}

/**
 * The 0-based page (column, in reading order) a point of the flow falls in. `endLeft` and
 * `endTop` are relative to the multi-column box.
 */
export function pageIndexOfEnd(
  geometry: ColumnFlowGeometry,
  end: { endLeft: number; endTop: number },
): number {
  const columns = columnsPerRow(geometry);
  const columnWidth = (geometry.width - geometry.columnGap * (columns - 1)) / columns;
  const column = Math.min(
    columns - 1,
    Math.max(
      0,
      Math.floor((end.endLeft + geometry.columnGap / 2) / (columnWidth + geometry.columnGap)),
    ),
  );
  const row = Math.max(0, Math.floor(end.endTop / geometry.rowPitch));
  return row * columns + column;
}

/**
 * Pages of a flow laid out from the conversation's first page. When the layout opens, whole blank
 * columns before page 1 make the last page close its row, so the screen opens full; they stay
 * put after that, so pages already laid out never reflow. A page, once turned to, stays turned:
 * a streaming tail that shrinks back into the page before must not pull the reader back. `key`
 * names the layout (the content's start and the geometry); a new key starts over.
 */
export interface TurnedPages {
  key: string;
  /** Blank columns before page 1. */
  blankPages: number;
  /** The last content page turned to, 0-based, not counting blank columns. */
  lastPage: number;
}

/** `endFlowIndex` is `pageIndexOfEnd` measured with `current`'s blank columns in place. */
export function turnPages(input: {
  current: TurnedPages | null;
  key: string;
  endFlowIndex: number;
  columnsPerRow: number;
}): TurnedPages {
  const { current, key, columnsPerRow: perRow } = input;
  const endPage = Math.max(0, input.endFlowIndex - (current?.blankPages ?? 0));
  if (!current || current.key !== key) {
    return { key, blankPages: perRow - 1 - (endPage % perRow), lastPage: endPage };
  }
  if (endPage <= current.lastPage) return current;
  return { ...current, lastPage: endPage };
}

export interface FlowPage {
  row: number;
  column: number;
  /** 1 is the oldest loaded page. */
  number: number;
}

/**
 * Every column of the flow that holds content, numbered in reading order. Columns the leading
 * spacer fills entirely are blank and get no page.
 */
export function flowPages(
  geometry: ColumnFlowGeometry,
  contentHeight: number,
  leadSpace: number,
  /** Stop at this 0-based page instead of filling the last row. */
  lastPage?: number,
): FlowPage[] {
  if (geometry.columnHeight <= 0 || geometry.rowPitch <= 0 || contentHeight <= 0) return [];
  const columns = columnsPerRow(geometry);
  const rows = Math.max(1, Math.ceil(contentHeight / geometry.rowPitch));
  const blank = Math.floor(leadSpace / geometry.columnHeight);
  const end = lastPage === undefined ? rows * columns : lastPage + 1;
  const pages: FlowPage[] = [];
  for (let index = blank; index < end; index += 1) {
    pages.push({
      row: Math.floor(index / columns),
      column: index % columns,
      number: index - blank + 1,
    });
  }
  return pages;
}
