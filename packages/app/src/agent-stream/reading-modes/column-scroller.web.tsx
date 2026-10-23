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
  children: ReactNode;
}

export function ColumnScroller({
  testID,
  bottomInset,
  columnMinWidth,
  maxColumns,
  children,
}: ColumnScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const height = useElementHeight(scrollerRef);
  const contentHeight = useElementHeight(columnsRef);
  const columnHeight = Math.max(0, height - PAGE_PADDING * 2 - bottomInset);
  const scrollerStyle = useScrollerStyle(columnScrollerStyle, bottomInset);
  const rowSnapStyles = useRowSnapStyles(height, contentHeight);
  const handleScroll = useFollowEnd(
    scrollerRef,
    columnHeight > 0 && contentHeight > 0,
    contentHeight,
  );

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

  return (
    <div ref={scrollerRef} data-testid={testID} style={scrollerStyle} onScroll={handleScroll}>
      {rowSnapStyles.map((style) => (
        <div key={String(style.top)} style={style} />
      ))}
      <div ref={columnsRef} style={columnsStyle}>
        {children}
      </div>
    </div>
  );
}
