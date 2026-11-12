import { describe, expect, it } from "vitest";
import {
  buildLaterSchedule,
  formatSendTime,
  nextRefreshDelay,
  pendingLater,
  pillLabel,
  type ScheduleLike,
  parseDuration,
  parseLaterArgs,
  scheduleName,
} from "./later";

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

const schedule = (over: Partial<ScheduleLike> = {}): ScheduleLike => ({
  id: "s1",
  name: "later: hi",
  prompt: "hi",
  status: "active",
  nextRunAt: "2026-11-11T15:00:00.000Z",
  target: { type: "agent", agentId: "a1" },
  ...over,
});

describe("pendingLater", () => {
  it("keeps only later: schedules of the agent that are still waiting", () => {
    const list = [
      schedule(),
      schedule({ id: "s2", name: "backup" }),
      schedule({ id: "s3", target: { type: "agent", agentId: "a2" } }),
      schedule({ id: "s4", status: "completed", nextRunAt: null }),
      schedule({ id: "s5", nextRunAt: null }),
      schedule({ id: "s6", target: { type: "new-agent" } }),
      schedule({ id: "s7", status: "paused", nextRunAt: null }),
    ];
    expect(pendingLater(list, "a1").map((item) => item.id)).toEqual(["s1", "s7"]);
    expect(pendingLater(list).map((item) => item.id)).toEqual(["s1", "s3", "s7"]);
    expect(pendingLater(list, "a1")[1]).toMatchObject({ paused: true, runAt: null });
  });

  it("sorts by time and shortens the preview", () => {
    const long = "x".repeat(60);
    const items = pendingLater([
      schedule({ id: "late", nextRunAt: "2026-11-11T18:00:00.000Z" }),
      schedule({ id: "soon", prompt: long }),
    ]);
    expect(items.map((item) => item.id)).toEqual(["soon", "late"]);
    expect(items[0].preview).toBe(`${"x".repeat(39)}…`);
  });
});

describe("formatSendTime", () => {
  const now = new Date(2026, 10, 11, 9, 0);
  it("shows only the time today", () => {
    expect(formatSendTime(new Date(2026, 10, 11, 14, 5).toISOString(), now)).toBe("14:05");
  });
  it("adds the date on another day", () => {
    expect(formatSendTime(new Date(2026, 10, 12, 0, 7).toISOString(), now)).toBe("12/11 00:07");
  });
  it("labels a pill with the time and the preview", () => {
    const item = pendingLater([
      schedule({ nextRunAt: new Date(2026, 10, 11, 14, 5).toISOString() }),
    ])[0];
    expect(pillLabel(item, now)).toBe("14:05 · hi");
    expect(pillLabel({ ...item, runAt: null, paused: true }, now)).toBe("paused · hi");
  });
});

describe("nextRefreshDelay", () => {
  const now = new Date("2026-11-11T14:00:00Z");
  const item = (runAt: string | null) => ({
    id: "x",
    agentId: "a",
    runAt,
    paused: !runAt,
    preview: "",
  });
  it("defaults to 30 seconds", () => {
    expect(nextRefreshDelay([], now)).toBe(30_000);
    expect(nextRefreshDelay([item("2026-11-11T15:00:00Z")], now)).toBe(30_000);
  });
  it("wakes just after a send time", () => {
    expect(nextRefreshDelay([item("2026-11-11T14:00:10Z")], now)).toBe(12_000);
  });
  it("never spins on a time already past", () => {
    expect(nextRefreshDelay([item("2026-11-11T13:00:00Z")], now)).toBe(1000);
    expect(nextRefreshDelay([item(null)], now)).toBe(30_000);
  });
});
