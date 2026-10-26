import { expect, it } from "vitest";
import {
  dueTrigger,
  nextRunAt,
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
