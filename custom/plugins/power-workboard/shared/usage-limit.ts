// CUSTOM(usage-limit): a provider's "usage limit reached" reply and when the limit resets.
// Pure: `now` comes from the caller.

/** Wait after the reset before resuming, so the provider has cleared the limit. */
export const LIMIT_RESUME_MARGIN_MS = 2 * 60_000;
/** When the reply says no reset time. */
export const LIMIT_FALLBACK_MS = 60 * 60_000;
/** Never wait longer than this. */
const MAX_LIMIT_WAIT_MS = 8 * 24 * 60 * 60_000;
/** Consecutive pauses of one task before it goes to the user instead. */
export const MAX_LIMIT_PAUSES = 3;
/** A limit notice is one short line, not an agent's summary that mentions limits. */
const MAX_NOTICE_LENGTH = 400;

// "You've hit your 5-hour limit", "Weekly limit reached", "You're out of extra usage".
const NOTICE =
  /\bhit your\b[^.\n]{0,40}\blimit\b|\blimit (?:reached|hit)\b|\bout of (?:extra )?usage\b/i;
// Claude Code's older form: "Claude AI usage limit reached|1763519400".
const EPOCH_NOTICE = /\busage limit reached\|(\d{9,13})\b/i;
// "resets 11:30pm (America/Sao_Paulo)", "resets 3pm", "resets Nov 20 at 10am (UTC)", "resets 23:30".
const RESET =
  /\bresets?\s+(?:at\s+)?(?:(?<month>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<ampm>[ap]\.?m\.?)?(?:\s*\((?<zone>[^)]+)\))?/i;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

export interface UsageLimit {
  /** When the limit resets (epoch ms), or null when the notice does not say. */
  resetAt: number | null;
}

/** The usage limit a reply announces, or null when the reply is not a limit notice. */
export function usageLimit(
  text: string | null | undefined,
  now: number,
): UsageLimit | null {
  const notice = text?.trim();
  if (!notice || notice.length > MAX_NOTICE_LENGTH) return null;
  const epoch = EPOCH_NOTICE.exec(notice);
  if (epoch) {
    const value = Number(epoch[1]);
    return { resetAt: value < 1e12 ? value * 1000 : value };
  }
  if (!NOTICE.test(notice)) return null;
  return { resetAt: resetTime(notice, now) };
}

/**
 * When a task stopped by this notice resumes: the reset plus a margin, or an hour from now when
 * the reset is unknown. Null when the text is not a limit notice.
 */
export function usageLimitResumeAt(
  text: string | null | undefined,
  now: number,
): string | null {
  const limit = usageLimit(text, now);
  if (!limit) return null;
  const at =
    limit.resetAt === null
      ? now + LIMIT_FALLBACK_MS
      : Math.max(limit.resetAt, now) + LIMIT_RESUME_MARGIN_MS;
  return new Date(Math.min(at, now + MAX_LIMIT_WAIT_MS)).toISOString();
}

function resetTime(notice: string, now: number): number | null {
  const match = RESET.exec(notice)?.groups;
  if (!match) return null;
  let hour = Number(match.hour);
  const minute = match.minute ? Number(match.minute) : 0;
  if (minute > 59) return null;
  if (match.ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match.ampm.toLowerCase().startsWith("p") ? 12 : 0);
  } else if (hour > 23 || !match.minute) {
    // "resets 3" with neither minutes nor am/pm is not a time.
    return null;
  }
  const zone = validZone(match.zone?.trim());
  const today = zonedParts(now, zone);
  if (match.month) {
    const month = MONTHS.indexOf(match.month.slice(0, 3).toLowerCase());
    const day = Number(match.day);
    let at = wallToUtc(today.year, month, day, hour, minute, zone);
    // A date already a day behind is next year's.
    if (at < now - 24 * 60 * 60_000)
      at = wallToUtc(today.year + 1, month, day, hour, minute, zone);
    return at;
  }
  const at = wallToUtc(today.year, today.month, today.day, hour, minute, zone);
  // A time that passed within the hour has just reset (the notice was read late); an earlier one
  // is tomorrow's.
  if (at < now - 60 * 60_000)
    return wallToUtc(
      today.year,
      today.month,
      today.day + 1,
      hour,
      minute,
      zone,
    );
  return at;
}

/** The IANA zone if this runtime knows it; otherwise the local zone. */
function validZone(zone: string | undefined): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** The wall-clock date and time at `at` in `zone`; `month` is 0-based. */
function zonedParts(at: number, zone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** How far `zone` is ahead of UTC at `at`, in ms. */
function zoneOffset(at: number, zone: string | undefined): number {
  const p = zonedParts(at, zone);
  const wall = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a wall-clock time in `zone` names; days past the month's end roll over. */
function wallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string | undefined,
): number {
  const wall = Date.UTC(year, month, day, hour, minute);
  const first = wall - zoneOffset(wall, zone);
  return wall - zoneOffset(first, zone);
}
