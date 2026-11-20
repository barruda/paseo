// CUSTOM(projects-assistant): pure helpers of the Projects Dashboard.
import type { NeedsYouItem, Stats } from "../../shared/assistant";
import { dashboardStrings as s } from "./dashboard-strings";

export const PERIODS = [7, 14, 30] as const;
export const DEFAULT_PERIOD = 14;
export const WIDE_BREAKPOINT = 900;
export const COLLAPSED_DETAIL_LINES = 3;

export const isWide = (compact: boolean, width: number): boolean =>
  !compact && width >= WIDE_BREAKPOINT;

/** CUSTOM(packages): one section of Needs you: a package, or the tickets outside one. */
export interface NeedsYouGroup {
  packageId: string | null;
  packageName: string | null;
  items: NeedsYouItem[];
}

/** CUSTOM(packages): Needs you grouped by package, packages first in list order, ungrouped last. */
export function groupNeedsYou(items: readonly NeedsYouItem[]): NeedsYouGroup[] {
  const groups = new Map<string, NeedsYouGroup>();
  let ungrouped: NeedsYouGroup | null = null;
  for (const item of items) {
    if (!item.packageId) {
      ungrouped ??= { packageId: null, packageName: null, items: [] };
      ungrouped.items.push(item);
      continue;
    }
    const group = groups.get(item.packageId) ?? {
      packageId: item.packageId,
      packageName: item.packageName ?? item.packageId,
      items: [],
    };
    group.items.push(item);
    groups.set(item.packageId, group);
  }
  return [...groups.values(), ...(ungrouped ? [ungrouped] : [])];
}

/** "12 min ago"; an unparsable date gives "—". */
export function formatAge(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return s.ago.now;
  if (minutes < 60) return s.ago.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return s.ago.hours(hours);
  return s.ago.days(Math.floor(hours / 24));
}

/** "2h 05m", "3m 12s", "40s"; elapsed time since `iso`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatElapsed(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "—" : formatDuration(Math.max(0, now - time));
}

export const formatPercent = (rate: number | null): string =>
  rate === null || !Number.isFinite(rate) ? "—" : `${Math.round(rate * 100)}%`;

export const formatDecimal = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? "—"
    : (Math.round(value * 10) / 10).toString();

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Day label "MM-DD" from a YYYY-MM-DD date. */
export const dayLabel = (date: string): string => date.slice(5);

/** Bar length as a 0..1 share of `max`; never NaN. */
export function barRatio(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(1, value / max);
}

export interface DaySegments {
  date: string;
  merged: number;
  otherDone: number;
  failed: number;
  needsYou: number;
  total: number;
}

/** Stacked-bar segments of a day: merged is part of done, so "other done" is the rest. */
export function daySegments(day: Stats["perDay"][number]): DaySegments {
  const merged = Math.min(day.merged, day.done);
  const otherDone = Math.max(0, day.done - merged);
  return {
    date: day.date,
    merged,
    otherDone,
    failed: day.failed,
    needsYou: day.needsYou,
    total: merged + otherDone + day.failed + day.needsYou,
  };
}

export const maxDayTotal = (days: DaySegments[]): number =>
  days.reduce((max, day) => Math.max(max, day.total), 0);

export const statsQueryKey = (hostId: string, days: number) =>
  ["power-workboard", "assistant", "stats", hostId, days] as const;

/** Inclusive ISO range covering the last `days` local days, ending at `now`. */
export function periodRange(
  days: number,
  now: number = Date.now(),
): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { from: start.toISOString(), to: new Date(now).toISOString() };
}
