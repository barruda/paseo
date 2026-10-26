// CUSTOM(scroll-arrows): the chat's scroll arrows show while the reader scrolls and fade after
// 3 s without scrolling. Scrolling up also shows an arrow at the top that jumps to the start of
// the loaded history (older pages load from there as usual).
import { useCallback, useEffect, useRef, useState } from "react";

export const SCROLL_ARROWS_IDLE_MS = 3_000;

/** A scroll the reader made. `atTop` means the start of the history is on screen. */
export interface StreamScrollActivity {
  direction: "up" | "down";
  atTop: boolean;
}

export interface ScrollArrowsState {
  /** Scrolled within the last few seconds: the bottom arrow may show. */
  awake: boolean;
  /** Scrolled up within the last few seconds and the start isn't on screen. */
  showTop: boolean;
}

export const SCROLL_ARROWS_IDLE: ScrollArrowsState = { awake: false, showTop: false };

export function nextScrollArrowsState(
  previous: ScrollArrowsState,
  activity: StreamScrollActivity,
): ScrollArrowsState {
  // Scrolling down keeps a top arrow already shown: prepending older history moves the viewport
  // down without the reader doing anything.
  const showTop = !activity.atTop && (activity.direction === "up" || previous.showTop);
  if (previous.awake && previous.showTop === showTop) return previous;
  return { awake: true, showTop };
}

export function useScrollArrows(resetKey: string): ScrollArrowsState & {
  onScrollActivity: (activity: StreamScrollActivity) => void;
  hideTop: () => void;
} {
  const [state, setState] = useState(SCROLL_ARROWS_IDLE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const onScrollActivity = useCallback(
    (activity: StreamScrollActivity) => {
      setState((previous) => nextScrollArrowsState(previous, activity));
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setState(SCROLL_ARROWS_IDLE);
      }, SCROLL_ARROWS_IDLE_MS);
    },
    [clearTimer],
  );
  const hideTop = useCallback(() => {
    setState((previous) => (previous.showTop ? { ...previous, showTop: false } : previous));
  }, []);
  useEffect(() => {
    setState(SCROLL_ARROWS_IDLE);
    return clearTimer;
  }, [clearTimer, resetKey]);
  return { ...state, onScrollActivity, hideTop };
}
