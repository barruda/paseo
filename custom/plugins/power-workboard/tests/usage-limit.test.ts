// CUSTOM(usage-limit): reading the plan's usage-limit notice and when to resume.
import { expect, it } from "vitest";
import { usageLimit, usageLimitResumeAt } from "../shared/usage-limit";

const at = (iso: string) => Date.parse(iso);
const NOTICE =
  "You've hit your 5-hour limit · resets 11:30pm (America/Sao_Paulo)";

it("reads the reset time in the notice's own time zone, plus a margin", () => {
  // 21:35 in São Paulo (UTC-3): the reset is 23:30 the same day, 02:30Z.
  const now = at("2026-11-19T00:35:40Z");
  expect(usageLimit(NOTICE, now)).toEqual({
    resetAt: at("2026-11-19T02:30:00Z"),
  });
  expect(usageLimitResumeAt(NOTICE, now)).toBe("2026-11-19T02:32:00.000Z");
});

it("a reset that passed within the hour resumes right away; an older one is tomorrow's", () => {
  // Read at 23:40 São Paulo: it reset ten minutes ago.
  expect(usageLimitResumeAt(NOTICE, at("2026-11-19T02:40:00Z"))).toBe(
    "2026-11-19T02:42:00.000Z",
  );
  // At 23:00 São Paulo, 1am is the next day.
  expect(
    usageLimit(
      "You've hit your limit · resets 1am (America/Sao_Paulo)",
      at("2026-11-19T02:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2026-11-19T04:00:00Z") });
});

it("follows daylight saving time and 24-hour clocks", () => {
  expect(
    usageLimit(
      "5-hour limit reached · resets 3pm (Europe/Berlin)",
      at("2026-07-01T10:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2026-07-01T13:00:00Z") });
  expect(
    usageLimit(
      "5-hour limit reached · resets 3pm (Europe/Berlin)",
      at("2026-12-01T10:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2026-12-01T14:00:00Z") });
  expect(
    usageLimit(
      "You've hit your limit · resets 23:30 (UTC)",
      at("2026-11-19T20:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2026-11-19T23:30:00Z") });
});

it("reads a reset with a date, rolling to next year when it is behind", () => {
  expect(
    usageLimit(
      "Weekly limit reached · resets Nov 25 at 10am (UTC)",
      at("2026-11-19T20:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2026-11-25T10:00:00Z") });
  expect(
    usageLimit(
      "Weekly limit reached · resets Jan 2, 9am (UTC)",
      at("2026-12-30T20:00:00Z"),
    ),
  ).toEqual({ resetAt: at("2027-01-02T09:00:00Z") });
});

it("reads the older epoch form", () => {
  expect(usageLimit("Claude AI usage limit reached|1795048515", 0)).toEqual({
    resetAt: 1795048515000,
  });
});

it("an unknown zone uses the local one", () => {
  const now = new Date(2026, 10, 19, 10, 0).getTime();
  expect(
    usageLimit("You've hit your limit · resets 3pm (Mars/Base)", now),
  ).toEqual({ resetAt: new Date(2026, 10, 19, 15, 0).getTime() });
});

it("without a readable reset it resumes in an hour", () => {
  const now = at("2026-11-19T00:00:00Z");
  expect(usageLimit("You've hit your limit", now)).toEqual({ resetAt: null });
  expect(usageLimitResumeAt("You're out of extra usage", now)).toBe(
    "2026-11-19T01:00:00.000Z",
  );
});

it("ignores replies that are not a limit notice", () => {
  const now = at("2026-11-19T00:00:00Z");
  expect(usageLimit(null, now)).toBeNull();
  expect(usageLimit("", now)).toBeNull();
  expect(usageLimit("I changed things.", now)).toBeNull();
  expect(usageLimit("Rate limits are configured in config.ts", now)).toBeNull();
  // A long summary that mentions a limit is no notice.
  expect(
    usageLimit(`${"Did the work. ".repeat(40)}You've hit your limit`, now),
  ).toBeNull();
});
