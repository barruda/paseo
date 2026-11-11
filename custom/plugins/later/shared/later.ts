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
