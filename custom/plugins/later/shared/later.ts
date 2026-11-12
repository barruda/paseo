import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

/** The scheduler looks for the next cron match at most 366 days ahead. */
export const MAX_DELAY_MS = 365 * UNIT_MS.d;
const MESSAGE_PREVIEW_CHARS = 40;
const USAGE = "Usage: /later <5m|1h30m> <message>";
const DURATION = /^(?:\d+[smhd])+$/i;

export interface LaterArgs {
  delayMs: number;
  message: string;
}

/** Parses `5m`, `90s` or `1h30m` into milliseconds. Throws a message fit for a toast. */
export function parseDuration(text: string): number {
  if (!DURATION.test(text)) {
    throw new Error(`"${text}" is not a duration. Use units s, m, h, d, like 5m or 1h30m.`);
  }
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)([smhd])/gi)) {
    total += Number(amount) * UNIT_MS[unit.toLowerCase() as Unit];
  }
  if (total <= 0) throw new Error("The duration must be more than zero.");
  if (total > MAX_DELAY_MS) throw new Error("The duration can be at most 365d.");
  return total;
}

export function parseLaterArgs(args: string): LaterArgs {
  const trimmed = args.trim();
  if (!trimmed) throw new Error(USAGE);
  const duration = trimmed.split(/\s+/)[0];
  const delayMs = parseDuration(duration);
  const message = trimmed.slice(duration.length).trim();
  if (!message) throw new Error(`Add the message to send. ${USAGE}`);
  return { delayMs, message };
}

export function scheduleName(message: string): string {
  const oneLine = message.replace(/\s+/g, " ");
  const preview =
    oneLine.length > MESSAGE_PREVIEW_CHARS ? oneLine.slice(0, MESSAGE_PREVIEW_CHARS) : oneLine;
  return `later: ${preview}`;
}

export interface LaterSchedule {
  /** When the daemon will send the message: the first minute at or after now + delay. */
  runAt: Date;
  /** One-shot cron for that minute, evaluated in `timezone`. */
  expression: string;
  timezone: string;
  /** Safety net: if the run is missed (daemon down), the schedule completes instead of firing next year. */
  expiresAt: Date;
}

const EXPIRY_GRACE_MS = 10 * UNIT_MS.m;

/**
 * Schedules cadence has minute granularity (`every` is a legacy shape), so the run time is the delay
 * rounded up to a whole minute. The scheduler never matches the current minute, and the rounded-up
 * minute is always after it.
 */
export function buildLaterSchedule(now: Date, delayMs: number, timezone: string): LaterSchedule {
  const runAt = new Date(Math.ceil((now.getTime() + delayMs) / UNIT_MS.m) * UNIT_MS.m);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(runAt);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const expression = [field("minute"), field("hour"), field("day"), field("month"), "*"].join(" ");
  return {
    runAt,
    expression,
    timezone,
    expiresAt: new Date(runAt.getTime() + EXPIRY_GRACE_MS),
  };
}

const LATER_NAME_PREFIX = "later:";

/** The few fields of a stored schedule that the pending list needs. */
export interface ScheduleLike {
  id: string;
  name: string | null;
  prompt: string;
  status: string;
  nextRunAt: string | null;
  target: { type: string; agentId?: string };
}

export interface PendingLater {
  id: string;
  agentId: string;
  /** ISO time of the next send, or null while paused. */
  runAt: string | null;
  paused: boolean;
  preview: string;
}

export function isLaterSchedule(schedule: ScheduleLike): boolean {
  return schedule.name?.startsWith(LATER_NAME_PREFIX) === true && schedule.target.type === "agent";
}

/**
 * The pending /later messages: active (with a run time) or paused. A run that has been claimed
 * has no run time and is being sent right now, so it is not pending any more.
 */
export function pendingLater(schedules: ScheduleLike[], agentId?: string): PendingLater[] {
  const pending: PendingLater[] = [];
  for (const schedule of schedules) {
    if (!isLaterSchedule(schedule) || !schedule.target.agentId) continue;
    if (agentId && schedule.target.agentId !== agentId) continue;
    const paused = schedule.status === "paused";
    if (!paused && !(schedule.status === "active" && schedule.nextRunAt)) continue;
    pending.push({
      id: schedule.id,
      agentId: schedule.target.agentId,
      runAt: paused ? null : schedule.nextRunAt,
      paused,
      preview: previewOf(schedule.prompt),
    });
  }
  const time = (item: PendingLater) => (item.runAt ? Date.parse(item.runAt) : Infinity);
  return pending.sort((a, b) => time(a) - time(b));
}

function previewOf(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > MESSAGE_PREVIEW_CHARS
    ? `${oneLine.slice(0, MESSAGE_PREVIEW_CHARS - 1)}…`
    : oneLine;
}

const two = (value: number) => String(value).padStart(2, "0");

/** Local `HH:MM`, with the day (`11/11 HH:MM`) when it is not today. */
export function formatSendTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? time : `${two(at.getDate())}/${two(at.getMonth() + 1)} ${time}`;
}

export function pillLabel(item: PendingLater, now: Date): string {
  const when = item.runAt ? formatSendTime(item.runAt, now) : "paused";
  return `${when} · ${item.preview}`;
}

const REFRESH_INTERVAL_MS = 30_000;
const FIRE_GRACE_MS = 2000;

/** Next refetch: every 30 s, sooner when a send time passes so its pill goes away. */
export function nextRefreshDelay(items: PendingLater[], now: Date): number {
  let delay = REFRESH_INTERVAL_MS;
  for (const item of items) {
    if (!item.runAt) continue;
    const untilFire = new Date(item.runAt).getTime() - now.getTime() + FIRE_GRACE_MS;
    if (untilFire < delay) delay = Math.max(untilFire, 1000);
  }
  return delay;
}

/** Creates the one-shot schedule. The daemon owns the clock, so it survives restarts. */
export const sendLaterRpc = defineRpc({
  name: "send-later",
  input: z.object({
    agentId: z.string().min(1),
    delayMs: z.number().int().positive().max(MAX_DELAY_MS),
    message: z.string().min(1),
  }),
  output: z.object({ runAt: z.string() }),
});

const pendingItem = z.object({
  id: z.string(),
  agentId: z.string(),
  runAt: z.string().nullable(),
  paused: z.boolean(),
  preview: z.string(),
});

/** Pending /later messages, for one agent or (without agentId) every agent. */
export const listLaterRpc = defineRpc({
  name: "list-later",
  input: z.object({ agentId: z.string().min(1).optional() }),
  output: z.object({ items: z.array(pendingItem) }),
});

/** Deletes a pending /later schedule. Refuses any schedule that is not one. */
export const cancelLaterRpc = defineRpc({
  name: "cancel-later",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({}),
});
