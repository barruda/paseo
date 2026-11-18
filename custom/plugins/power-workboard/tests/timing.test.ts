import { describe, expect, it } from "vitest";
import {
  defaultAtText,
  formatLocalDateTime,
  parseLocalDateTime,
} from "../client/timing";

const now = new Date(2026, 5, 10, 12, 0, 0);

describe("parseLocalDateTime", () => {
  it("parses local time into an ISO instant", () => {
    const parsed = parseLocalDateTime("2026-06-10 14:30", now);
    expect(parsed).toEqual({
      ok: true,
      iso: new Date(2026, 5, 10, 14, 30).toISOString(),
    });
  });

  it("rejects malformed and impossible text", () => {
    for (const text of ["", "tomorrow", "2026-06-10", "2026-13-10 10:00"])
      expect(parseLocalDateTime(text, now)).toEqual({
        ok: false,
        error: "invalid",
      });
    expect(parseLocalDateTime("2026-02-30 10:00", now)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseLocalDateTime("2026-06-10 25:00", now)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("rejects times that are not in the future", () => {
    expect(parseLocalDateTime("2026-06-10 12:00", now)).toEqual({
      ok: false,
      error: "past",
    });
    expect(parseLocalDateTime("2026-06-09 23:00", now)).toEqual({
      ok: false,
      error: "past",
    });
  });

  it("round trips through format", () => {
    const parsed = parseLocalDateTime("2026-07-01 08:05", now);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(formatLocalDateTime(parsed.iso)).toBe("2026-07-01 08:05");
  });
});

describe("defaultAtText", () => {
  it("is an hour ahead, rounded up to 5 minutes", () => {
    expect(defaultAtText(new Date(2026, 5, 10, 12, 2))).toBe(
      "2026-06-10 13:05",
    );
    expect(defaultAtText(new Date(2026, 5, 10, 12, 0))).toBe(
      "2026-06-10 13:00",
    );
  });
});
