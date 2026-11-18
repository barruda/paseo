import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DO_NOT_DISTURB_OFF,
  effectiveDoNotDisturbState,
  isDoNotDisturbActive,
  parseDoNotDisturbDuration,
  parseDoNotDisturbState,
  resolveDoNotDisturbUntil,
  toggleDoNotDisturb,
  turnDoNotDisturbOn,
} from "./do-not-disturb.js";
import {
  doNotDisturbFilePath,
  readDoNotDisturbFile,
  writeDoNotDisturbFile,
} from "./do-not-disturb-file.js";

const NOW = new Date(2026, 10, 18, 14, 30, 0);

describe("do-not-disturb state", () => {
  it("is off by default and for anything malformed", () => {
    expect(parseDoNotDisturbState(undefined)).toEqual(DO_NOT_DISTURB_OFF);
    expect(parseDoNotDisturbState({ enabled: "yes" })).toEqual(DO_NOT_DISTURB_OFF);
    expect(parseDoNotDisturbState({ enabled: true, until: "garbage" })).toEqual({
      enabled: true,
      until: null,
    });
  });

  it("stays on until turned off when there is no end", () => {
    const state = turnDoNotDisturbOn("indefinite", NOW);
    expect(state).toEqual({ enabled: true, until: null });
    expect(isDoNotDisturbActive(state, NOW.getTime() + 365 * 86_400_000)).toBe(true);
  });

  it("expires after one hour", () => {
    const state = turnDoNotDisturbOn("1h", NOW);
    expect(isDoNotDisturbActive(state, NOW.getTime() + 59 * 60_000)).toBe(true);
    expect(isDoNotDisturbActive(state, NOW.getTime() + 60 * 60_000)).toBe(false);
    expect(effectiveDoNotDisturbState(state, NOW.getTime() + 61 * 60_000)).toEqual(
      DO_NOT_DISTURB_OFF,
    );
  });

  it("'until tomorrow' ends at 8:00 local time the next day", () => {
    const until = new Date(resolveDoNotDisturbUntil("tomorrow", NOW)!);
    expect(until.getDate()).toBe(19);
    expect(until.getHours()).toBe(8);
    expect(until.getMinutes()).toBe(0);
  });

  it("toggles off to on-until-turned-off, and on to off", () => {
    const on = toggleDoNotDisturb(DO_NOT_DISTURB_OFF, NOW);
    expect(on).toEqual({ enabled: true, until: null });
    expect(toggleDoNotDisturb(on, NOW)).toEqual(DO_NOT_DISTURB_OFF);
    // An expired state counts as off, so the toggle turns it on again.
    const expired = { enabled: true, until: new Date(NOW.getTime() - 1000).toISOString() };
    expect(toggleDoNotDisturb(expired, NOW)).toEqual({ enabled: true, until: null });
  });

  it("parses durations", () => {
    expect(parseDoNotDisturbDuration("1h")).toBe("1h");
    expect(parseDoNotDisturbDuration("2h")).toBeNull();
  });
});

describe("do-not-disturb file", () => {
  let home: string | null = null;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
    home = null;
  });

  it("round-trips and reads a missing or broken file as off", async () => {
    home = await mkdtemp(path.join(tmpdir(), "paseo-dnd-"));
    expect(await readDoNotDisturbFile(home)).toEqual(DO_NOT_DISTURB_OFF);
    const state = turnDoNotDisturbOn("1h", NOW);
    await writeDoNotDisturbFile(home, state);
    expect(await readDoNotDisturbFile(home)).toEqual(state);
    expect(JSON.parse(await readFile(doNotDisturbFilePath(home), "utf8"))).toEqual(state);
    await writeFile(doNotDisturbFilePath(home), "{not json", "utf8");
    expect(await readDoNotDisturbFile(home)).toEqual(DO_NOT_DISTURB_OFF);
  });
});
