import { describe, expect, it } from "vitest";
import { buildLaterSchedule, parseDuration, parseLaterArgs, scheduleName } from "./later";

describe("parseDuration", () => {
  it("reads single and combined units", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("1d2h")).toBe(93_600_000);
    expect(parseDuration("2H")).toBe(7_200_000);
  });

  it("rejects zero, garbage and out-of-range", () => {
    expect(() => parseDuration("0m")).toThrow("more than zero");
    expect(() => parseDuration("5")).toThrow("not a duration");
    expect(() => parseDuration("m5")).toThrow("not a duration");
    expect(() => parseDuration("1x")).toThrow("not a duration");
    expect(() => parseDuration("366d")).toThrow("at most 365d");
  });
});

describe("parseLaterArgs", () => {
  it("splits the duration from the message", () => {
    expect(parseLaterArgs("  5m  run the tests   again ")).toEqual({
      delayMs: 300_000,
      message: "run the tests   again",
    });
  });

  it("errors on missing pieces", () => {
    expect(() => parseLaterArgs("")).toThrow("Usage");
    expect(() => parseLaterArgs("5m")).toThrow("Add the message");
    expect(() => parseLaterArgs("hello world")).toThrow("not a duration");
  });
});

describe("scheduleName", () => {
  it("keeps the first 40 characters on one line", () => {
    expect(scheduleName("hi")).toBe("later: hi");
    expect(scheduleName("a\nb".repeat(30))).toBe(`later: ${"a b".repeat(30).slice(0, 40)}`);
  });
});

describe("buildLaterSchedule", () => {
  it("rounds up to the next whole minute in the given timezone", () => {
    const plan = buildLaterSchedule(new Date("2026-11-11T12:00:30Z"), 90_000, "UTC");
    expect(plan.runAt.toISOString()).toBe("2026-11-11T12:02:00.000Z");
    expect(plan.expression).toBe("2 12 11 11 *");
    expect(plan.expiresAt.toISOString()).toBe("2026-11-11T12:12:00.000Z");
  });

  it("never picks the current minute", () => {
    const plan = buildLaterSchedule(new Date("2026-11-11T12:00:00Z"), 1000, "UTC");
    expect(plan.runAt.toISOString()).toBe("2026-11-11T12:01:00.000Z");
  });

  it("keeps an exact minute boundary", () => {
    const plan = buildLaterSchedule(new Date("2026-11-11T12:00:00Z"), 300_000, "UTC");
    expect(plan.runAt.toISOString()).toBe("2026-11-11T12:05:00.000Z");
  });

  it("writes the cron fields in the timezone", () => {
    const plan = buildLaterSchedule(
      new Date("2026-11-11T12:00:00Z"),
      3_600_000,
      "America/Sao_Paulo",
    );
    expect(plan.expression).toBe("0 10 11 11 *");
  });

  it("crosses midnight and year ends", () => {
    const plan = buildLaterSchedule(new Date("2026-12-31T23:59:30Z"), 60_000, "UTC");
    expect(plan.expression).toBe("1 0 1 1 *");
  });
});
