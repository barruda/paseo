// CUSTOM(task-checkpoints)
import { describe, expect, it } from "vitest";
import {
  formatClock,
  logLines,
  progressBadge,
  waitingLine,
} from "../client/checkpoint-format";

const pad = (n: number) => String(n).padStart(2, "0");
// Local-time dates, so the expectations hold in any timezone.
const now = new Date(2026, 10, 18, 14, 30);
const at = (day: number, h: number, m: number) =>
  new Date(2026, 10, day, h, m).toISOString();
const words = { until: "waiting until", nextPass: "resuming on the next pass" };

describe("formatClock", () => {
  it("shows only the time for today", () => {
    expect(formatClock(at(18, 9, 5), now)).toBe("09:05");
  });

  it("prefixes the date for another day", () => {
    expect(formatClock(at(19, 9, 0), now)).toBe("19/11 09:00");
    const iso = at(17, 23, 59);
    const d = new Date(iso);
    expect(formatClock(iso, now)).toBe(
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)} 23:59`,
    );
  });

  it("returns an unparsable value as it is", () => {
    expect(formatClock("soon", now)).toBe("soon");
  });
});

describe("progressBadge", () => {
  it("shows the fraction and the checkpoint", () => {
    expect(
      progressBadge({ done: 3, total: 7, checkpoints: 2 }, "checkpoint"),
    ).toBe("3/7 · checkpoint 2");
  });

  it("drops the fraction when there is no item", () => {
    expect(
      progressBadge({ done: 0, total: 0, checkpoints: 1 }, "checkpoint"),
    ).toBe("checkpoint 1");
  });

  it("drops the checkpoint when it is 0", () => {
    expect(
      progressBadge({ done: 1, total: 4, checkpoints: 0 }, "checkpoint"),
    ).toBe("1/4");
    expect(
      progressBadge({ done: 0, total: 0, checkpoints: 0 }, "checkpoint"),
    ).toBe("");
  });
});

describe("waitingLine", () => {
  it("names the time and what it waits for", () => {
    expect(
      waitingLine({ resumeAt: at(18, 9, 0), waitingFor: "CI" }, words, now),
    ).toBe("waiting until 09:00: CI");
  });

  it("leaves out the reason", () => {
    expect(
      waitingLine({ resumeAt: at(19, 9, 0), waitingFor: null }, words, now),
    ).toBe("waiting until 19/11 09:00");
  });

  it("falls back to the next pass without a time", () => {
    expect(waitingLine({ resumeAt: null, waitingFor: null }, words, now)).toBe(
      "resuming on the next pass",
    );
  });
});

describe("logLines", () => {
  it("lists the newest checkpoint first", () => {
    const lines = logLines(
      [
        { at: at(18, 8, 0), checkpoint: 1, text: "first" },
        { at: at(18, 9, 0), checkpoint: 2, text: "second" },
      ],
      now,
    );
    expect(lines.map((l) => [l.time, l.checkpoint, l.text])).toEqual([
      ["09:00", 2, "second"],
      ["08:00", 1, "first"],
    ]);
  });
});
