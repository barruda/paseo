// CUSTOM(reading-modes): the scroll surface Newspaper and Columns share. Content flows through
// CSS columns. With `column-wrap` (Chromium 145+), a screen-tall row of columns is followed by
// the next row below it, so one vertical scroll moves the whole grid; a proximity snap point at
// each row lets a scroll settle on a row. Without it, the columns run sideways in one row.
// Newspaper uses `ColumnScroller`, end-aligned over a window of history; Columns uses
// `PagedColumnScroller`, which lays out the whole conversation from its first page.
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ColumnFlowGeometry,
  columnsPerRow,
  flowPages,
  nextLeadSpace,
  pageIndexOfEnd,
  type TurnedPages,
  turnPages,
  unusedFlowAfterEnd,
} from "./column-flow";

export const PAGE_PADDING = 24;
const COLUMN_GAP = 48;
const END_TOLERANCE_PX = 8;

const supportsColumnWrap =
  typeof CSS !== "undefined" &&
  CSS.supports("column-wrap", "wrap") &&
  CSS.supports("column-height", "1px");

// Theme colors come from the Unistyles CSS variables, so these plain elements follow the theme
// without subscribing to it (docs/unistyles.md).
export const color = {
  surface0: "var(--colors-surface0)",
  surface1: "var(--colors-surface1)",
  surface2: "var(--colors-surface2)",
  border: "var(--colors-border)",
  muted: "var(--colors-foreground-muted)",
  extraMuted: "var(--colors-foreground-extra-muted)",
  foreground: "var(--colors-foreground)",
};

export const overlayScrollerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Above the chat's floating scroll-to-bottom button.
  zIndex: 20,
  padding: PAGE_PADDING,
  boxSizing: "border-box",
  background: color.surface0,
};
const columnScrollerStyle: CSSProperties = {
  ...overlayScrollerStyle,
  scrollSnapType: supportsColumnWrap ? "y proximity" : undefined,
  overflowY: supportsColumnWrap ? "auto" : "hidden",
  overflowX: supportsColumnWrap ? "hidden" : "auto",
};

// Pages snap: a scroll always lands on a whole screen of pages.
const pagedScrollerStyle: CSSProperties = { ...columnScrollerStyle, scrollSnapType: "y mandatory" };

export function useScrollerStyle(base: CSSProperties, bottomInset: number): CSSProperties {
  return useMemo(
    () => ({ ...base, paddingBottom: PAGE_PADDING + bottomInset }),
    [base, bottomInset],
  );
}

export function useElementHeight(ref: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setHeight(element.clientHeight);
    // clientHeight includes the padding, like the page a scroll moves by.
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

export function useElementWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function scrollToEnd(element: HTMLElement) {
  element.scrollTop = element.scrollHeight;
  element.scrollLeft = element.scrollWidth;
}

function isScrolledToEnd(element: HTMLElement): boolean {
  return (
    element.scrollTop + element.clientHeight >= element.scrollHeight - END_TOLERANCE_PX &&
    element.scrollLeft + element.clientWidth >= element.scrollWidth - END_TOLERANCE_PX
  );
}

// Opens on the latest content, like the chat, and keeps following it while the reader stays at
// the end. Markdown blocks settle over a couple of frames, so the first jump repeats.
export function useFollowEnd(
  ref: RefObject<HTMLDivElement | null>,
  ready: boolean,
  contentHeight: number,
) {
  const started = useRef(false);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    if (!started.current) {
      started.current = true;
      scrollToEnd(element);
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToEnd(element)));
      return;
    }
    if (atEnd.current) scrollToEnd(element);
  }, [contentHeight, ready, ref]);
  return useCallback(() => {
    const element = ref.current;
    if (!element) return;
    atEnd.current = isScrolledToEnd(element);
  }, [ref]);
}

// One snap point per row of columns. Each row plus the gap below it is one screen.
function useRowSnapStyles(
  rowPitch: number,
  contentHeight: number,
  /** Rows known before the content's size is observed, so a scroll to a new row can snap. */
  minRows = 0,
): CSSProperties[] {
  return useMemo(() => {
    if (!supportsColumnWrap || rowPitch <= 0) return [];
    // The content is every row plus the gaps between them, so it ends a gap short of a pitch.
    const rows = Math.max(1, minRows, Math.ceil(contentHeight / rowPitch));
    return Array.from({ length: rows }, (_, row) => ({
      position: "absolute",
      top: row * rowPitch,
      left: 0,
      width: 1,
      height: 1,
      scrollSnapAlign: "start",
    }));
  }, [contentHeight, minRows, rowPitch]);
}

export interface ColumnScrollerProps {
  testID: string;
  /** Kept clear for the composer, which floats over the bottom of the chat. */
  bottomInset: number;
  /** Narrowest a column may get; the browser fits as many as the width allows. */
  columnMinWidth: number;
  /** At most this many columns side by side. */
  maxColumns?: number;
  /** Identifies the first item: when it changes, older content arrived at the start. */
  startKey: string | null;
  /** The reader is near the oldest content shown; load more if there is any. */
  onNearStart: () => void;
  children: ReactNode;
}

// A page frame sits just outside its column, in the gaps, so it never touches the text. The
// number goes in a strip under the column, inside the row gap.
const PAGE_FRAME_OUTSET = 12;
const PAGE_NUMBER_STRIP = 20;
const pageFrameBaseStyle: CSSProperties = {
  position: "absolute",
  boxSizing: "border-box",
  border: `1px solid ${color.border}`,
  borderRadius: 10,
  pointerEvents: "none",
};
const pageNumberStyle: CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 3,
  fontSize: 11,
  lineHeight: "14px",
  color: color.extraMuted,
  fontVariantNumeric: "tabular-nums",
};

interface PageFrame {
  key: string;
  style: CSSProperties;
  number: number;
}

function usePageFrames(
  geometry: ColumnFlowGeometry,
  contentHeight: number,
  blankPages: number,
  lastFlowIndex: number | null,
): PageFrame[] {
  const { width, columnMinWidth, maxColumns, columnGap, columnHeight, rowPitch } = geometry;
  return useMemo(() => {
    if (!supportsColumnWrap || width <= 0 || lastFlowIndex === null) return [];
    const flow = { width, columnMinWidth, maxColumns, columnGap, columnHeight, rowPitch };
    const perRow = columnsPerRow(flow);
    const columnWidth = (width - columnGap * (perRow - 1)) / perRow;
    return flowPages(flow, contentHeight, blankPages * columnHeight, lastFlowIndex).map((page) => ({
      key: `${page.row}:${page.column}`,
      number: page.number,
      style: {
        ...pageFrameBaseStyle,
        top: PAGE_PADDING + page.row * rowPitch - PAGE_FRAME_OUTSET,
        left: PAGE_PADDING + page.column * (columnWidth + columnGap) - PAGE_FRAME_OUTSET,
        width: columnWidth + PAGE_FRAME_OUTSET * 2,
        height: columnHeight + PAGE_FRAME_OUTSET + PAGE_NUMBER_STRIP,
      },
    }));
  }, [
    blankPages,
    columnGap,
    columnHeight,
    columnMinWidth,
    contentHeight,
    lastFlowIndex,
    maxColumns,
    rowPitch,
    width,
  ]);
}

// Wheel events closer together than this belong to one gesture: a flick of the wheel or a
// trackpad swipe, momentum included, turns one screen of pages.
const WHEEL_GESTURE_GAP_MS = 250;
const PAGE_TURN_MS = 700;
const PREPEND_ANCHOR_MS = 800;

function useWheelPaging(
  scrollerRef: RefObject<HTMLDivElement | null>,
  pageHeight: number,
  onTarget: (top: number) => void,
) {
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!supportsColumnWrap || !scroller || pageHeight <= 0) return;
    let lastWheelAt = 0;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      const now = performance.now();
      const startsGesture = now - lastWheelAt > WHEEL_GESTURE_GAP_MS;
      lastWheelAt = now;
      if (!startsGesture || event.deltaY === 0) return;
      const screen = Math.round(scroller.scrollTop / pageHeight) + Math.sign(event.deltaY);
      const top = Math.max(
        0,
        Math.min(scroller.scrollHeight - scroller.clientHeight, screen * pageHeight),
      );
      onTarget(top);
      scroller.scrollTo({ top, behavior: "smooth" });
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, [onTarget, pageHeight, scrollerRef]);
}

// The spacer can shift an unbreakable block into the next column, so alignment is a few rounds
// of measure-and-adjust, not one.
const MAX_ALIGN_PASSES = 4;
const ALIGN_TOLERANCE_PX = 2;

function afterTwoFrames(callback: () => void): () => void {
  let id = requestAnimationFrame(() => {
    id = requestAnimationFrame(callback);
  });
  return () => cancelAnimationFrame(id);
}

function measureEnd(columns: HTMLElement, marker: HTMLElement) {
  const box = columns.getBoundingClientRect();
  const end = marker.getBoundingClientRect();
  return { endLeft: end.left - box.left, endTop: end.top - box.top };
}

export function ColumnScroller({
  testID,
  bottomInset,
  columnMinWidth,
  maxColumns,
  startKey,
  onNearStart,
  children,
}: ColumnScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const endMarkerRef = useRef<HTMLDivElement>(null);
  const height = useElementHeight(scrollerRef);
  const contentHeight = useElementHeight(columnsRef);
  const columnHeight = Math.max(0, height - PAGE_PADDING * 2 - bottomInset);
  const scrollerStyle = useScrollerStyle(columnScrollerStyle, bottomInset);
  const rowSnapStyles = useRowSnapStyles(height, contentHeight);
  const [leadSpace, setLeadSpace] = useState(0);
  // Markdown and code blocks settle a frame or two after mount; one late pass catches them.
  const [settleTick, setSettleTick] = useState(0);
  const atEnd = useRef(true);
  const distanceFromEnd = useRef(0);
  const alignPasses = useRef(0);
  const lastStartKey = useRef(startKey);
  const anchorUntil = useRef(0);
  const lastRevision = useRef({ children, settleTick });
  useLayoutEffect(() => afterTwoFrames(() => setSettleTick((tick) => tick + 1)), []);

  // New rows re-render this scroller with new children, and each may move the end.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const columns = columnsRef.current;
    const marker = endMarkerRef.current;
    if (!scroller || !columns || !marker || columnHeight <= 0) return;
    if (!supportsColumnWrap) {
      if (atEnd.current) scrollToEnd(scroller);
      return;
    }
    if (startKey !== lastStartKey.current) {
      lastStartKey.current = startKey;
      // Older content keeps laying out for a few frames; hold the reader's place until it settles.
      anchorUntil.current = atEnd.current ? 0 : performance.now() + PREPEND_ANCHOR_MS;
      alignPasses.current = 0;
    }
    // New content (or the late settle pass) earns a fresh round of alignment while the reader
    // follows the end; this scroller's own spacer updates keep the same children and don't.
    const revision = { children, settleTick };
    if (
      revision.children !== lastRevision.current.children ||
      revision.settleTick !== lastRevision.current.settleTick
    ) {
      lastRevision.current = revision;
      if (atEnd.current) alignPasses.current = 0;
    }
    if (alignPasses.current < MAX_ALIGN_PASSES) {
      const geometry = {
        width: columns.clientWidth,
        columnMinWidth,
        maxColumns,
        columnGap: COLUMN_GAP,
        columnHeight,
        rowPitch: height,
      };
      const unused = unusedFlowAfterEnd(geometry, measureEnd(columns, marker));
      const next = nextLeadSpace(geometry, leadSpace, unused);
      if (Math.abs(next - leadSpace) > ALIGN_TOLERANCE_PX) {
        alignPasses.current += 1;
        setLeadSpace(next);
        return;
      }
      alignPasses.current = MAX_ALIGN_PASSES;
    }
    if (atEnd.current) {
      scrollToEnd(scroller);
    } else if (performance.now() < anchorUntil.current) {
      // The flow is end-aligned, so what the reader was looking at kept its distance from the end.
      scroller.scrollTop = scroller.scrollHeight - distanceFromEnd.current;
    }
    // Less than a screen of content: there is nothing to scroll toward, so ask for more now.
    if (scroller.scrollHeight <= scroller.clientHeight + ALIGN_TOLERANCE_PX) onNearStart();
  }, [
    children,
    columnHeight,
    contentHeight,
    columnMinWidth,
    height,
    leadSpace,
    maxColumns,
    onNearStart,
    settleTick,
    startKey,
  ]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    atEnd.current = isScrolledToEnd(scroller);
    distanceFromEnd.current = scroller.scrollHeight - scroller.scrollTop;
    if (scroller.scrollTop < scroller.clientHeight / 2) onNearStart();
  }, [onNearStart]);

  const columnsStyle = useMemo(() => {
    const style: CSSProperties & Record<string, unknown> = {
      columnWidth: columnMinWidth,
      columnCount: maxColumns,
      columnGap: COLUMN_GAP,
      columnRule: `1px solid ${color.border}`,
      columnFill: "auto",
    };
    if (supportsColumnWrap) {
      style.columnHeight = `${columnHeight}px`;
      style.columnWrap = "wrap";
      style.rowGap = `${PAGE_PADDING * 2 + bottomInset}px`;
    } else {
      style.height = columnHeight;
    }
    return style;
  }, [bottomInset, columnHeight, columnMinWidth, maxColumns]);
  const leadStyle = useMemo<CSSProperties>(() => ({ height: leadSpace }), [leadSpace]);

  return (
    <div
      ref={scrollerRef}
      data-testid={testID}
      data-settle={settleTick}
      style={scrollerStyle}
      onScroll={handleScroll}
    >
      {rowSnapStyles.map((style) => (
        <div key={String(style.top)} style={style} />
      ))}
      <div ref={columnsRef} style={columnsStyle}>
        <div style={leadStyle} />
        {children}
        <div ref={endMarkerRef} />
      </div>
    </div>
  );
}

export interface PagedColumnScrollerProps {
  testID: string;
  /** Kept clear for the composer, which floats over the bottom of the chat. */
  bottomInset: number;
  /** Narrowest a column may get; the browser fits as many as the width allows. */
  columnMinWidth: number;
  /** At most this many columns side by side. */
  maxColumns?: number;
  /** Identifies the first item: page 1 starts there, so a new start lays the pages out anew. */
  startKey: string | null;
  /** Changes when the reader asks for the end, as sending a message does in the chat. */
  followRequest: number;
  children: ReactNode;
}

// The flow starts at the conversation's first page and only ever grows at its end, so pages
// already laid out never reflow (see `TurnedPages`). Each column is a numbered page framed just
// outside its text. The reader follows the end while at it; a page, once turned to, stays: the
// scroll area keeps its rows even if the streaming tail shrinks back into the page before.
export function PagedColumnScroller({
  testID,
  bottomInset,
  columnMinWidth,
  maxColumns,
  startKey,
  followRequest,
  children,
}: PagedColumnScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const endMarkerRef = useRef<HTMLDivElement>(null);
  const height = useElementHeight(scrollerRef);
  const contentHeight = useElementHeight(columnsRef);
  const contentWidth = useElementWidth(columnsRef);
  const columnHeight = Math.max(0, height - PAGE_PADDING * 2 - bottomInset);
  const scrollerStyle = useScrollerStyle(pagedScrollerStyle, bottomInset);
  const geometry = useMemo<ColumnFlowGeometry>(
    () => ({
      width: contentWidth,
      columnMinWidth,
      maxColumns,
      columnGap: COLUMN_GAP,
      columnHeight,
      rowPitch: height,
    }),
    [columnHeight, columnMinWidth, contentWidth, height, maxColumns],
  );
  // Markdown and code blocks settle a frame or two after mount; one late pass catches them.
  const [settleTick, setSettleTick] = useState(0);
  const [turned, setTurned] = useState<TurnedPages | null>(null);
  const layoutKey = `${startKey}:${contentWidth}:${height}:${bottomInset}`;
  const perRow = columnsPerRow(geometry);
  // The blank columns stay rendered while a new layout measures, which subtracts them.
  const blankPages = turned?.blankPages ?? 0;
  const lastPage = turned?.key === layoutKey ? turned.lastPage : null;
  const lastFlowIndex = lastPage === null ? null : blankPages + lastPage;
  const turnedRows = lastFlowIndex === null ? 0 : Math.floor(lastFlowIndex / perRow) + 1;
  const atEnd = useRef(true);
  const pageFrames = usePageFrames(geometry, contentHeight, blankPages, lastFlowIndex);
  const rowSnapStyles = useRowSnapStyles(height, contentHeight, turnedRows);
  const pageCount = lastPage === null ? 0 : lastPage + 1;

  // While a page turn animates, the reader's place is where it lands, not where it passes.
  const pageTurnUntil = useRef(0);
  const handlePageTarget = useCallback((top: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    pageTurnUntil.current = performance.now() + PAGE_TURN_MS;
    atEnd.current = top >= scroller.scrollHeight - scroller.clientHeight - END_TOLERANCE_PX;
  }, []);
  useWheelPaging(scrollerRef, height, handlePageTarget);

  useLayoutEffect(() => afterTwoFrames(() => setSettleTick((tick) => tick + 1)), []);

  // Every change to the rows may move the end into a later page.
  useLayoutEffect(() => {
    const columns = columnsRef.current;
    const marker = endMarkerRef.current;
    if (!supportsColumnWrap || !columns || !marker || columnHeight <= 0 || contentWidth <= 0) {
      return;
    }
    const endFlowIndex = pageIndexOfEnd(geometry, measureEnd(columns, marker));
    setTurned((current) =>
      turnPages({ current, key: layoutKey, endFlowIndex, columnsPerRow: perRow }),
    );
  }, [
    children,
    columnHeight,
    contentHeight,
    contentWidth,
    geometry,
    layoutKey,
    perRow,
    settleTick,
  ]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && atEnd.current) scrollToEnd(scroller);
  }, [children, contentHeight, height, lastPage, settleTick]);

  const lastFollowRequest = useRef(followRequest);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || followRequest === lastFollowRequest.current) return;
    lastFollowRequest.current = followRequest;
    atEnd.current = true;
    pageTurnUntil.current = 0;
    scrollToEnd(scroller);
  }, [followRequest]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || performance.now() < pageTurnUntil.current) return;
    atEnd.current = isScrolledToEnd(scroller);
  }, []);

  const columnsStyle = useMemo(() => {
    const style: CSSProperties & Record<string, unknown> = {
      columnWidth: columnMinWidth,
      columnCount: maxColumns,
      columnGap: COLUMN_GAP,
      columnFill: "auto",
    };
    if (supportsColumnWrap) {
      style.columnHeight = `${columnHeight}px`;
      style.columnWrap = "wrap";
      style.rowGap = `${PAGE_PADDING * 2 + bottomInset}px`;
      // Rows already turned to stay scrollable while the tail shrinks back.
      if (turnedRows > 0) style.minHeight = (turnedRows - 1) * height + columnHeight;
    } else {
      style.height = columnHeight;
    }
    return style;
  }, [bottomInset, columnHeight, columnMinWidth, height, maxColumns, turnedRows]);
  const blankStyle = useMemo<CSSProperties>(
    () => ({ height: blankPages * columnHeight }),
    [blankPages, columnHeight],
  );

  return (
    <div
      ref={scrollerRef}
      data-testid={testID}
      data-settle={settleTick}
      data-page-count={pageCount}
      style={scrollerStyle}
      onScroll={handleScroll}
    >
      {rowSnapStyles.map((style) => (
        <div key={String(style.top)} style={style} />
      ))}
      {pageFrames.map((frame) => (
        <div key={frame.key} style={frame.style}>
          <span style={pageNumberStyle}>
            {frame.number} / {pageCount}
          </span>
        </div>
      ))}
      <div ref={columnsRef} style={columnsStyle}>
        <div style={blankStyle} />
        {children}
        <div ref={endMarkerRef} />
      </div>
    </div>
  );
}

export interface OlderContent {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => unknown;
}

/** Loads older content once per start: a reader at the top asks again only after it arrives. */
export function useNearStartLoader(older: OlderContent, startKey: string | null) {
  const askedFor = useRef<string | null | undefined>(undefined);
  return useCallback(() => {
    if (!older.hasOlder || older.isLoadingOlder || askedFor.current === startKey) return;
    askedFor.current = startKey;
    void older.loadOlder();
  }, [older, startKey]);
}

const loadingOlderStyle: CSSProperties = {
  fontSize: 12,
  color: color.extraMuted,
  marginBottom: 16,
  breakInside: "avoid",
};

export function LoadingOlder({ visible }: { visible: boolean }) {
  return visible ? <div style={loadingOlderStyle}>Loading earlier messages…</div> : null;
}
