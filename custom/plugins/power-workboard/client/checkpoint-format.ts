// CUSTOM(task-checkpoints): text of a long task's progress, as the board and the dashboard show it.
// Pure: `now` comes from the caller.

const pad = (n: number) => String(n).padStart(2, "0");

/** "09:00" in local time; "18/11 09:00" when the day is not today. */
export function formatClock(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return today
    ? time
    : `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}

/** "3/7 · checkpoint 2": the fraction drops when there is no item, the count when it is 0. */
export function progressBadge(
  progress: { done: number; total: number; checkpoints: number },
  checkpointWord: string,
): string {
  const parts: string[] = [];
  if (progress.total > 0) parts.push(`${progress.done}/${progress.total}`);
  if (progress.checkpoints > 0)
    parts.push(`${checkpointWord} ${progress.checkpoints}`);
  return parts.join(" · ");
}

/** "waiting until 09:00: CI". `until` is the localized "waiting until". */
export function waitingLine(
  input: { resumeAt: string | null; waitingFor: string | null },
  words: { until: string; nextPass: string },
  now: Date,
): string {
  const when = input.resumeAt
    ? `${words.until} ${formatClock(input.resumeAt, now)}`
    : words.nextPass;
  return input.waitingFor ? `${when}: ${input.waitingFor}` : when;
}

// CUSTOM(usage-limit)
/** "paused by the usage limit until 23:32"; just `paused` when the reset time is unknown. */
export function limitLine(
  resumeAt: string | null,
  words: { paused: string; until: string },
  now: Date,
): string {
  return resumeAt
    ? `${words.paused} ${words.until} ${formatClock(resumeAt, now)}`
    : words.paused;
}

/** The checkpoint log, newest first, one line each: `time`, `text`. */
export function logLines(
  log: readonly { at: string; checkpoint: number; text: string }[],
  now: Date,
): { key: string; time: string; checkpoint: number; text: string }[] {
  return log
    .map((entry, index) => ({
      key: `${index}-${entry.checkpoint}`,
      time: formatClock(entry.at, now),
      checkpoint: entry.checkpoint,
      text: entry.text,
    }))
    .reverse();
}
