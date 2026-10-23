// CUSTOM(reading-modes): the scroll surface Newspaper and Columns share. Content flows through
// CSS columns. With `column-wrap` (Chromium 145+), a screen-tall row of columns is followed by
// the next row below it, so one vertical scroll moves the whole grid; a proximity snap point at
// each row lets a scroll settle on a row. Without it, the columns run sideways in one row.
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
import { nextLeadSpace, unusedFlowAfterEnd } from "./column-flow";

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

function scrollToEnd(element: HTMLElement) {
  element.scrollTop = element.scrollHeight;
  element.scrollLeft = element.scrollWidth;
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
    atEnd.current =
      element.scrollTop + element.clientHeight >= element.scrollHeight - END_TOLERANCE_PX &&
      element.scrollLeft + element.clientWidth >= element.scrollWidth - END_TOLERANCE_PX;
  }, [ref]);
}

// One snap point per row of columns. Each row plus the gap below it is one screen.
function useRowSnapStyles(rowPitch: number, contentHeight: number): CSSProperties[] {
  return useMemo(() => {
    if (!supportsColumnWrap || rowPitch <= 0) return [];
    // The content is every row plus the gaps between them, so it ends a gap short of a pitch.
    const rows = Math.max(1, Math.ceil(contentHeight / rowPitch));
    return Array.from({ length: rows }, (_, row) => ({
      position: "absolute",
      top: row * rowPitch,
      left: 0,
      width: 1,
      height: 1,
      scrollSnapAlign: "start",
    }));
  }, [contentHeight, rowPitch]);
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
  const restoreAfterPrepend = useRef(false);
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
      restoreAfterPrepend.current = !atEnd.current;
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
    } else if (restoreAfterPrepend.current) {
      // The flow is end-aligned, so what the reader was looking at kept its distance from the end.
      restoreAfterPrepend.current = false;
      scroller.scrollTop = scroller.scrollHeight - distanceFromEnd.current;
    }
    // Less than a screen of content: there is nothing to scroll toward, so ask for more now.
    if (scroller.scrollHeight <= scroller.clientHeight + ALIGN_TOLERANCE_PX) onNearStart();
  }, [
    children,
    columnHeight,
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
    atEnd.current =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - END_TOLERANCE_PX &&
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - END_TOLERANCE_PX;
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
