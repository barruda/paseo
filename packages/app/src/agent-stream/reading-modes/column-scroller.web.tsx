// CUSTOM(reading-modes): the paged scroll surface every reading mode shares. Content flows through
// CSS columns. With `column-wrap` (Chromium 145+), a screen-tall row of columns is followed by
// the next row below it, so one vertical scroll moves the whole grid, snapping to each row.
// Without it, the columns run sideways in one row.
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
  pageIndexOfEnd,
  type TurnedPages,
  turnPages,
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
  // Above the chat; the scroll-to-bottom button sits above this.
  zIndex: 20,
  padding: PAGE_PADDING,
  boxSizing: "border-box",
  background: color.surface0,
};
// Pages snap: a scroll always lands on a whole screen of pages.
const pagedScrollerStyle: CSSProperties = {
  ...overlayScrollerStyle,
  scrollSnapType: supportsColumnWrap ? "y mandatory" : undefined,
  overflowY: supportsColumnWrap ? "auto" : "hidden",
  overflowX: supportsColumnWrap ? "hidden" : "auto",
};

function useElementHeight(ref: RefObject<HTMLDivElement | null>): number {
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

function useElementWidth(ref: RefObject<HTMLDivElement | null>): number {
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
// Twice as fast as the browser's smooth scroll, which takes about 450 ms for one screen.
const PAGE_TURN_ANIMATION_MS = 225;
const PAGE_TURN_MS = PAGE_TURN_ANIMATION_MS + 100;

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

// The browser's smooth scroll has no duration setting, so the turn animates by hand. Mandatory
// snapping would pull every intermediate position back to a row, so it is off while it runs.
function animateScrollTop(element: HTMLElement, top: number): () => void {
  const from = element.scrollTop;
  const snapType = element.style.scrollSnapType;
  const startedAt = performance.now();
  element.style.scrollSnapType = "none";
  let frame = 0;
  const finish = () => {
    element.scrollTop = top;
    element.style.scrollSnapType = snapType;
  };
  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / PAGE_TURN_ANIMATION_MS);
    if (progress >= 1) {
      finish();
      return;
    }
    element.scrollTop = from + (top - from) * easeOutCubic(progress);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    element.style.scrollSnapType = snapType;
  };
}

function useWheelPaging(
  scrollerRef: RefObject<HTMLDivElement | null>,
  pageHeight: number,
  onTarget: (top: number) => void,
) {
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!supportsColumnWrap || !scroller || pageHeight <= 0) return;
    let lastWheelAt = 0;
    let cancelTurn: (() => void) | null = null;
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
      cancelTurn?.();
      cancelTurn = animateScrollTop(scroller, top);
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      cancelTurn?.();
      scroller.removeEventListener("wheel", handleWheel);
    };
  }, [onTarget, pageHeight, scrollerRef]);
}

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
  /** Whether the reader is at the end, for the scroll-to-bottom button. */
  onAtEndChange: (atEnd: boolean) => void;
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
  onAtEndChange,
  children,
}: PagedColumnScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const endMarkerRef = useRef<HTMLDivElement>(null);
  const height = useElementHeight(scrollerRef);
  const contentHeight = useElementHeight(columnsRef);
  const contentWidth = useElementWidth(columnsRef);
  const columnHeight = Math.max(0, height - PAGE_PADDING * 2 - bottomInset);
  const scrollerStyle = useMemo(
    () => ({ ...pagedScrollerStyle, paddingBottom: PAGE_PADDING + bottomInset }),
    [bottomInset],
  );
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
  const reportedAtEnd = useRef<boolean | null>(null);
  const setAtEnd = useCallback(
    (value: boolean) => {
      atEnd.current = value;
      if (reportedAtEnd.current === value) return;
      reportedAtEnd.current = value;
      onAtEndChange(value);
    },
    [onAtEndChange],
  );
  // Leaving the mode puts the chat's own button logic back.
  useLayoutEffect(() => () => onAtEndChange(true), [onAtEndChange]);
  const pageFrames = usePageFrames(geometry, contentHeight, blankPages, lastFlowIndex);
  const rowSnapStyles = useRowSnapStyles(height, contentHeight, turnedRows);
  const pageCount = lastPage === null ? 0 : lastPage + 1;
  // Shown only once the pages are laid out and late blocks settled, so the reader never sees
  // the pages move into place.
  const ready = lastPage !== null && settleTick > 0;

  // While a page turn animates, the reader's place is where it lands, not where it passes.
  const pageTurnUntil = useRef(0);
  const handlePageTarget = useCallback(
    (top: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      pageTurnUntil.current = performance.now() + PAGE_TURN_MS;
      setAtEnd(top >= scroller.scrollHeight - scroller.clientHeight - END_TOLERANCE_PX);
    },
    [setAtEnd],
  );
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
    setAtEnd(true);
    pageTurnUntil.current = 0;
    scrollToEnd(scroller);
  }, [followRequest, setAtEnd]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || performance.now() < pageTurnUntil.current) return;
    setAtEnd(isScrolledToEnd(scroller));
  }, [setAtEnd]);

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
    <>
      {ready ? null : <LoadingConversation />}
      <div
        ref={scrollerRef}
        data-testid={testID}
        data-settle={settleTick}
        data-page-count={pageCount}
        data-ready={ready}
        style={ready ? scrollerStyle : hiddenStyle(scrollerStyle)}
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
    </>
  );
}

function hiddenStyle(style: CSSProperties): CSSProperties {
  return { ...style, visibility: "hidden" };
}

const loadingConversationStyle: CSSProperties = {
  ...overlayScrollerStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  color: color.extraMuted,
};

export function LoadingConversation() {
  return (
    <div data-testid="reading-loading" style={loadingConversationStyle}>
      Loading the whole conversation…
    </div>
  );
}
