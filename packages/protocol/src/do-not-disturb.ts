// CUSTOM(do-not-disturb): shared by the desktop main process (notification gate, state file), the
// CLI (`paseo dnd`) and the app (sidebar toggle, Command Center, shortcut, toast gate). The state
// lives in `$PASEO_HOME/do-not-disturb.json`, so the CLI can flip it without the app or the daemon.
// Node-only file access is in `do-not-disturb-file.ts`; this file stays safe for the app bundle.

export const DO_NOT_DISTURB_FILE_NAME = "do-not-disturb.json";

/** The desktop event every window receives after the state changes. */
export const DO_NOT_DISTURB_CHANGED_EVENT = "do-not-disturb-changed";

export interface DoNotDisturbState {
  enabled: boolean;
  /** ISO time when it turns itself off; null keeps it on until someone turns it off. */
  until: string | null;
}

export const DO_NOT_DISTURB_DURATIONS = ["indefinite", "1h", "tomorrow"] as const;
export type DoNotDisturbDuration = (typeof DO_NOT_DISTURB_DURATIONS)[number];

export const DO_NOT_DISTURB_OFF: DoNotDisturbState = { enabled: false, until: null };

/** "Until tomorrow" ends at this local hour of the next day. */
export const DO_NOT_DISTURB_TOMORROW_HOUR = 8;

export function parseDoNotDisturbState(raw: unknown): DoNotDisturbState {
  if (typeof raw !== "object" || raw === null) return DO_NOT_DISTURB_OFF;
  const record = raw as Record<string, unknown>;
  if (record.enabled !== true) return DO_NOT_DISTURB_OFF;
  const until =
    typeof record.until === "string" && Number.isFinite(Date.parse(record.until))
      ? record.until
      : null;
  return { enabled: true, until };
}

export function isDoNotDisturbActive(state: DoNotDisturbState, nowMs: number): boolean {
  if (!state.enabled) return false;
  return state.until === null || nowMs < Date.parse(state.until);
}

/** The state after the expiry check: an expired state reads as off. */
export function effectiveDoNotDisturbState(
  state: DoNotDisturbState,
  nowMs: number,
): DoNotDisturbState {
  return isDoNotDisturbActive(state, nowMs) ? state : DO_NOT_DISTURB_OFF;
}

export function resolveDoNotDisturbUntil(duration: DoNotDisturbDuration, now: Date): string | null {
  if (duration === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  if (duration === "tomorrow") {
    const end = new Date(now);
    end.setDate(end.getDate() + 1);
    end.setHours(DO_NOT_DISTURB_TOMORROW_HOUR, 0, 0, 0);
    return end.toISOString();
  }
  return null;
}

export function turnDoNotDisturbOn(duration: DoNotDisturbDuration, now: Date): DoNotDisturbState {
  return { enabled: true, until: resolveDoNotDisturbUntil(duration, now) };
}

/** Off turns on until turned off; on (and not expired) turns off. */
export function toggleDoNotDisturb(state: DoNotDisturbState, now: Date): DoNotDisturbState {
  return isDoNotDisturbActive(state, now.getTime())
    ? DO_NOT_DISTURB_OFF
    : turnDoNotDisturbOn("indefinite", now);
}

export function parseDoNotDisturbDuration(value: unknown): DoNotDisturbDuration | null {
  return typeof value === "string" &&
    (DO_NOT_DISTURB_DURATIONS as readonly string[]).includes(value)
    ? (value as DoNotDisturbDuration)
    : null;
}
