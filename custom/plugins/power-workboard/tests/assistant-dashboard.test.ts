import { describe, expect, it } from "vitest";
import {
  HISTORY_EVENT_KINDS,
  NEEDS_YOU_REASONS,
  DELIVERY_STAGES,
} from "../shared/assistant";
import {
  barRatio,
  dayLabel,
  daySegments,
  formatAge,
  formatDecimal,
  formatDuration,
  formatPercent,
  isWide,
  maxDayTotal,
  periodRange,
} from "../client/assistant/dashboard-format";
import {
  KIND_LABELS,
  REASON_LABELS,
  STAGE_LABELS,
} from "../client/assistant/dashboard-strings";

describe("dashboard labels", () => {
  it("labels every reason, kind and stage", () => {
    for (const reason of NEEDS_YOU_REASONS)
      expect(REASON_LABELS[reason]).toBeTruthy();
    for (const kind of HISTORY_EVENT_KINDS)
      expect(KIND_LABELS[kind]).toBeTruthy();
    for (const stage of ["running", ...DELIVERY_STAGES] as const)
      expect(STAGE_LABELS[stage]).toBeTruthy();
    expect(REASON_LABELS["verify-failed"]).toBe("Check failed");
    expect(REASON_LABELS["merge-conflict"]).toBe("Merge conflict");
    expect(REASON_LABELS.observed).toBe("Observe mode: would deliver");
  });
});

describe("dashboard formatting", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  it("formats ages", () => {
    expect(formatAge("2026-01-10T11:59:40Z", now)).toBe("just now");
    expect(formatAge("2026-01-10T11:48:00Z", now)).toBe("12 min ago");
    expect(formatAge("2026-01-10T09:00:00Z", now)).toBe("3 h ago");
    expect(formatAge("2026-01-08T12:00:00Z", now)).toBe("2 d ago");
    expect(formatAge("nope", now)).toBe("—");
  });
  it("formats durations, percents and decimals", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(7_500_000)).toBe("2h 05m");
    expect(formatPercent(0.666)).toBe("67%");
    expect(formatPercent(null)).toBe("—");
    expect(formatDecimal(1.26)).toBe("1.3");
    expect(formatDecimal(null)).toBe("—");
  });
  it("picks the layout", () => {
    expect(isWide(true, 1400)).toBe(false);
    expect(isWide(false, 899)).toBe(false);
    expect(isWide(false, 900)).toBe(true);
  });
});

describe("dashboard charts", () => {
  it("scales bars safely", () => {
    expect(barRatio(5, 10)).toBe(0.5);
    expect(barRatio(5, 0)).toBe(0);
    expect(barRatio(-1, 10)).toBe(0);
    expect(barRatio(20, 10)).toBe(1);
  });
  it("splits a day into stacked segments", () => {
    const day = daySegments({
      date: "2026-01-10",
      done: 5,
      merged: 2,
      failed: 1,
      needsYou: 3,
    });
    expect(day).toMatchObject({
      merged: 2,
      otherDone: 3,
      failed: 1,
      needsYou: 3,
      total: 9,
    });
    expect(
      maxDayTotal([
        day,
        daySegments({ date: "x", done: 1, merged: 5, failed: 0, needsYou: 0 }),
      ]),
    ).toBe(9);
    expect(dayLabel("2026-01-10")).toBe("01-10");
  });
  it("computes a period range of whole local days", () => {
    const now = new Date(2026, 0, 10, 15, 0).getTime();
    const { from, to } = periodRange(7, now);
    expect(new Date(from).getDate()).toBe(4);
    expect(new Date(from).getHours()).toBe(0);
    expect(Date.parse(to)).toBe(now);
  });
});
