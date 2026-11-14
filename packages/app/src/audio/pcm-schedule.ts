// CUSTOM(claude-tts-whole-text): gapless scheduling math for back-to-back audio chunks.

/** How long before a source's scheduled end its play promise resolves, so the next one queues. */
export const EARLY_RESOLVE_LEAD_SECONDS = 0.15;

/** AudioContext time to start a source: now, or right when the previous one ends. */
export function computeStartAt(currentTime: number, nextStartAt: number): number {
  return Math.max(currentTime, nextStartAt);
}

/** Milliseconds to wait (from `currentTime`) before resolving; 0 when little or nothing remains. */
export function computeEarlyResolveDelayMs(
  currentTime: number,
  startAt: number,
  durationSec: number,
  leadSeconds: number = EARLY_RESOLVE_LEAD_SECONDS,
): number {
  const remaining = startAt + durationSec - leadSeconds - currentTime;
  return remaining > 0 ? Math.round(remaining * 1000) : 0;
}
