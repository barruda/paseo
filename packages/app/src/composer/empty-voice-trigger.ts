// CUSTOM(empty-composer-voice): double Enter or double-click on an empty composer starts voice mode.

export const DOUBLE_TRIGGER_WINDOW_MS = 400;

/** Returns a hit recorder that reports true on the second hit inside the window. */
export function createDoubleTrigger(
  windowMs = DOUBLE_TRIGGER_WINDOW_MS,
  now: () => number = Date.now,
): { hit: () => boolean; reset: () => void } {
  let last: number | null = null;
  return {
    hit: () => {
      const time = now();
      if (last !== null && time - last <= windowMs) {
        last = null;
        return true;
      }
      last = time;
      return false;
    },
    reset: () => {
      last = null;
    },
  };
}
