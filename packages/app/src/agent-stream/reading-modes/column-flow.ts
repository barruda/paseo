// CUSTOM(reading-modes): geometry of a wrapped multi-column flow (CSS `column-wrap`). Content
// fills the columns of a row left to right, then the next row below. To end-align it, so the
// newest content closes the last row and the screen opens full, a spacer at the start of the
// flow takes up whatever the last row leaves empty.

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
 * The flow height left empty after the content's end, in the row the end falls in. `endLeft` and
 * `endTop` are the end marker's position relative to the multi-column box.
 */
export function unusedFlowAfterEnd(
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
  const topInColumn = Math.min(geometry.columnHeight, end.endTop - row * geometry.rowPitch);
  return (columns - 1 - column) * geometry.columnHeight + (geometry.columnHeight - topInColumn);
}

/** The spacer height that would close the last row, kept below one full row. */
export function nextLeadSpace(
  geometry: ColumnFlowGeometry,
  currentLead: number,
  unused: number,
): number {
  const rowCapacity = columnsPerRow(geometry) * geometry.columnHeight;
  if (rowCapacity <= 0) return 0;
  const lead = (currentLead + unused) % rowCapacity;
  return lead < 0 ? lead + rowCapacity : lead;
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
): FlowPage[] {
  if (geometry.columnHeight <= 0 || geometry.rowPitch <= 0 || contentHeight <= 0) return [];
  const columns = columnsPerRow(geometry);
  const rows = Math.max(1, Math.ceil(contentHeight / geometry.rowPitch));
  const blank = Math.floor(leadSpace / geometry.columnHeight);
  const pages: FlowPage[] = [];
  for (let index = blank; index < rows * columns; index += 1) {
    pages.push({
      row: Math.floor(index / columns),
      column: index % columns,
      number: index - blank + 1,
    });
  }
  return pages;
}
