// CUSTOM(do-not-disturb): tooltip text for the sidebar button.
import type { DoNotDisturbState } from "@getpaseo/protocol/do-not-disturb";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDoNotDisturbUntil(untilIso: string, now: Date): string {
  const until = new Date(untilIso);
  const time = `${pad(until.getHours())}:${pad(until.getMinutes())}`;
  const sameDay =
    until.getFullYear() === now.getFullYear() &&
    until.getMonth() === now.getMonth() &&
    until.getDate() === now.getDate();
  return sameDay ? time : `${WEEKDAYS[until.getDay()]} ${time}`;
}

export function buildDoNotDisturbLabel(
  state: DoNotDisturbState,
  active: boolean,
  now: Date = new Date(),
): string {
  if (!active) return "Do Not Disturb is off. Click to silence notifications";
  const until = state.until ? ` until ${formatDoNotDisturbUntil(state.until, now)}` : "";
  return `Do Not Disturb is on${until}. Click to turn it off`;
}
