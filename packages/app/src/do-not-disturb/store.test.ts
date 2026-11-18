import { afterEach, describe, expect, it } from "vitest";
import { DO_NOT_DISTURB_OFF } from "@getpaseo/protocol/do-not-disturb";
import { isDoNotDisturbActiveNow, useDoNotDisturbStore } from "./store";

describe("isDoNotDisturbActiveNow", () => {
  afterEach(() => useDoNotDisturbStore.getState().setState(DO_NOT_DISTURB_OFF));

  it("is false by default", () => {
    expect(isDoNotDisturbActiveNow()).toBe(false);
  });

  it("is true when on indefinitely", () => {
    useDoNotDisturbStore.getState().setState({ enabled: true, until: null });
    expect(isDoNotDisturbActiveNow()).toBe(true);
  });

  it("is true before until and false after", () => {
    const until = "2030-01-01T10:00:00.000Z";
    useDoNotDisturbStore.getState().setState({ enabled: true, until });
    expect(isDoNotDisturbActiveNow(Date.parse(until) - 1000)).toBe(true);
    expect(isDoNotDisturbActiveNow(Date.parse(until) + 1000)).toBe(false);
  });

  it("is false when disabled even with a future until", () => {
    useDoNotDisturbStore.getState().setState({ enabled: false, until: "2030-01-01T10:00:00.000Z" });
    expect(isDoNotDisturbActiveNow(0)).toBe(false);
  });
});
