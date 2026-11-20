import { expect, it } from "vitest";
import {
  AUTOMATIC_SCHEDULE,
  dueTrigger,
  isAutomaticSchedule,
  nextRunAt,
  nightSchedule,
  openWindowStart,
  windowOpen,
  type Schedule,
} from "../shared/schedule";

const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime();

it("opens a window on its days, across midnight when the end comes first", () => {
  // 2026-10-26 is a Monday.
  const night: Schedule = {
    kind: "window",
    days: [1],
    start: "22:00",
    end: "06:00",
  };
  expect(windowOpen(night, at(26, 21, 59))).toBe(false);
  expect(windowOpen(night, at(26, 22))).toBe(true);
  expect(windowOpen(night, at(27, 5, 59))).toBe(true);
  expect(windowOpen(night, at(27, 6))).toBe(false);
  expect(windowOpen(night, at(27, 22))).toBe(false);
  // The next Monday window.
  expect(nextRunAt(night, at(27, 12))).toBe(at(26 + 7, 22));
});

it("fires a daily time once, and skips one missed by more than an hour", () => {
  const daily: Schedule = {
    kind: "daily",
    days: [0, 1, 2, 3, 4, 5, 6],
    times: ["09:00", "18:00"],
  };
  expect(dueTrigger(daily, null, at(26, 8, 59))).toBeNull();
  expect(dueTrigger(daily, null, at(26, 9, 5))).toBe(at(26, 9));
  expect(
    dueTrigger(daily, new Date(at(26, 9)).toISOString(), at(26, 9, 30)),
  ).toBeNull();
  expect(dueTrigger(daily, null, at(26, 10, 30))).toBeNull();
  expect(nextRunAt(daily, at(26, 9, 30))).toBe(at(26, 18));
  expect(nextRunAt(daily, at(26, 19))).toBe(at(27, 9));
  expect(nextRunAt({ kind: "manual" }, at(26, 9))).toBeNull();
});

it("the night window runs every day and knows when it opened", () => {
  const night = nightSchedule({ start: "22:00", end: "06:00" });
  expect(openWindowStart(night, at(26, 21, 59))).toBeNull();
  expect(openWindowStart(night, at(26, 23))).toBe(at(26, 22));
  // After midnight it is still the window that opened the evening before.
  expect(openWindowStart(night, at(27, 5, 59))).toBe(at(26, 22));
  expect(openWindowStart(night, at(27, 6))).toBeNull();
  expect(nextRunAt(night, at(27, 6))).toBe(at(27, 22));
});

it("treats Automatic as a window that is always open", () => {
  expect(isAutomaticSchedule(AUTOMATIC_SCHEDULE)).toBe(true);
  expect(isAutomaticSchedule({ kind: "manual" })).toBe(false);
  expect(
    isAutomaticSchedule({ ...AUTOMATIC_SCHEDULE, days: [1, 2] } as Schedule),
  ).toBe(false);
  expect(
    isAutomaticSchedule({ ...AUTOMATIC_SCHEDULE, end: "06:00" } as Schedule),
  ).toBe(false);
  for (const [day, hours, minutes] of [
    [26, 0, 0],
    [26, 3, 30],
    [27, 12, 0],
    [31, 23, 59],
  ])
    expect(windowOpen(AUTOMATIC_SCHEDULE, at(day, hours, minutes))).toBe(true);
});
