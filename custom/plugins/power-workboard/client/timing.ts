/** Local date-time text for a task's "at a time" start: `YYYY-MM-DD HH:MM`. */
const pad = (value: number) => String(value).padStart(2, "0");
const FORMAT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type ParsedLocalDateTime =
  | { ok: true; iso: string }
  | { ok: false; error: "invalid" | "past" };

export function parseLocalDateTime(
  text: string,
  now: Date,
): ParsedLocalDateTime {
  const match = FORMAT.exec(text.trim());
  if (!match) return { ok: false, error: "invalid" };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return { ok: false, error: "invalid" };
  if (date.getTime() <= now.getTime()) return { ok: false, error: "past" };
  return { ok: true, iso: date.toISOString() };
}

/** One hour from now, rounded up to the next 5 minutes. */
export function defaultAtText(now: Date): string {
  const step = 5 * 60_000;
  const target = new Date(
    Math.ceil((now.getTime() + 60 * 60_000) / step) * step,
  );
  return formatLocalDateTime(target.toISOString());
}
