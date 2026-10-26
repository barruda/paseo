import { z } from "zod";

/** "HH:MM", 24h, in the daemon host's local time. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
/** 0 is Sunday, as in `Date.getDay()`. */
const daysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .default([0, 1, 2, 3, 4, 5, 6]);
export const scheduleSchema = z.discriminatedUnion("kind", [
  // Runs only when someone presses Run now.
  z.object({ kind: z.literal("manual") }),
  // Keeps taking tasks while the window is open; an end before the start crosses midnight.
  z.object({
    kind: z.literal("window"),
    days: daysSchema,
    start: timeOfDaySchema,
    end: timeOfDaySchema,
  }),
  // At each time, one run that takes up to the batch size.
  z.object({
    kind: z.literal("daily"),
    days: daysSchema,
    times: z.array(timeOfDaySchema).min(1),
  }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A trigger missed by more than this (daemon down) is skipped instead of run late. */
export const TRIGGER_GRACE_MS = 60 * MINUTE;

const minutes = (time: string) => {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
};
const startOfDay = (at: number) => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const atMinutes = (day: number, value: number) => {
  const date = new Date(day);
  date.setHours(Math.floor(value / 60), value % 60, 0, 0);
  return date.getTime();
};

/** The [start, end) of the window that opened on `day`, or null if it does not run that day. */
function windowOn(
  schedule: Extract<Schedule, { kind: "window" }>,
  day: number,
): [number, number] | null {
  if (!schedule.days.includes(new Date(day).getDay())) return null;
  const start = atMinutes(day, minutes(schedule.start));
  let end = atMinutes(day, minutes(schedule.end));
  if (end <= start)
    end = atMinutes(day + DAY + 2 * 60 * MINUTE, minutes(schedule.end));
  return [start, end];
}

export function windowOpen(schedule: Schedule, now: number): boolean {
  if (schedule.kind !== "window") return false;
  const today = startOfDay(now);
  // Yesterday's window may still be open after midnight.
  for (const day of [startOfDay(today - DAY / 2), today]) {
    const range = windowOn(schedule, day);
    if (range && now >= range[0] && now < range[1]) return true;
  }
  return false;
}

/** The latest daily trigger after `lastTriggerAt` and not after `now`, within the grace. */
export function dueTrigger(
  schedule: Schedule,
  lastTriggerAt: string | null,
  now: number,
): number | null {
  if (schedule.kind !== "daily") return null;
  const last = lastTriggerAt ? Date.parse(lastTriggerAt) : -Infinity;
  let due: number | null = null;
  const today = startOfDay(now);
  for (const day of [startOfDay(today - DAY / 2), today]) {
    if (!schedule.days.includes(new Date(day).getDay())) continue;
    for (const time of schedule.times) {
      const at = atMinutes(day, minutes(time));
      if (at > last && at <= now && now - at <= TRIGGER_GRACE_MS)
        due = Math.max(due ?? at, at);
    }
  }
  return due;
}

/** When this schedule next starts taking tasks; `now` while a window is open. */
export function nextRunAt(schedule: Schedule, now: number): number | null {
  if (schedule.kind === "manual") return null;
  if (windowOpen(schedule, now)) return now;
  let next: number | null = null;
  const today = startOfDay(now);
  for (let offset = 0; offset <= 8; offset++) {
    const day = startOfDay(today + offset * DAY + DAY / 2);
    if (!schedule.days.includes(new Date(day).getDay())) continue;
    const times =
      schedule.kind === "window" ? [schedule.start] : schedule.times;
    for (const time of times) {
      const at = atMinutes(day, minutes(time));
      if (at > now) next = Math.min(next ?? at, at);
    }
    if (next !== null) return next;
  }
  return next;
}
