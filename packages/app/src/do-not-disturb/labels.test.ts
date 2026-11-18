import { describe, expect, it } from "vitest";
import { buildDoNotDisturbLabel, formatDoNotDisturbUntil } from "./labels";

describe("do-not-disturb labels", () => {
  const now = new Date(2030, 0, 2, 9, 0, 0);

  it("describes the off state", () => {
    expect(buildDoNotDisturbLabel({ enabled: false, until: null }, false, now)).toBe(
      "Do Not Disturb is off. Click to silence notifications",
    );
  });

  it("describes an indefinite on state", () => {
    expect(buildDoNotDisturbLabel({ enabled: true, until: null }, true, now)).toBe(
      "Do Not Disturb is on. Click to turn it off",
    );
  });

  it("shows only the time for today", () => {
    const until = new Date(2030, 0, 2, 14, 5).toISOString();
    expect(formatDoNotDisturbUntil(until, now)).toBe("14:05");
    expect(buildDoNotDisturbLabel({ enabled: true, until }, true, now)).toBe(
      "Do Not Disturb is on until 14:05. Click to turn it off",
    );
  });

  it("adds the weekday for another day", () => {
    const until = new Date(2030, 0, 3, 8, 0).toISOString();
    expect(formatDoNotDisturbUntil(until, now)).toBe("Thu 08:00");
  });
});
