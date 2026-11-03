import { JevRouterSettingsSchema } from "@getpaseo/protocol/jev-router";
import { describe, expect, it } from "vitest";
import {
  buildRouterArgs,
  expandHome,
  familyOf,
  parseRouterOutput,
  planRoute,
  resolveHome,
} from "./decision";

const decision = (model: string, effort = "low", why = "small") => ({
  model,
  modelId: `claude-${model}-5-5`,
  effort,
  why,
  latencyMs: 190,
  error: null,
});
const opusHigh = { family: "opus", effort: "high" };

describe("familyOf", () => {
  it("reads the family out of any Claude model id", () => {
    expect(familyOf("claude-opus-4-8[1m]")).toBe("opus");
    expect(familyOf("claude-sonnet-5-5")).toBe("sonnet");
    expect(familyOf("claude-fable-5-1")).toBe("fable");
    expect(familyOf("gpt-5")).toBeNull();
    expect(familyOf(null)).toBeNull();
  });
});

describe("resolveHome", () => {
  it("routes Claude sessions above Haiku, defaulting the effort to high", () => {
    expect(
      resolveHome({ provider: "claude", model: "claude-opus-5-5", thinkingOptionId: null }),
    ).toEqual({ family: "opus", effort: "high" });
  });

  it("skips other providers, unknown models and Haiku", () => {
    expect(resolveHome({ provider: "codex", model: "gpt-5", thinkingOptionId: null })).toEqual({
      skip: "provider codex",
    });
    expect(resolveHome({ provider: "claude", model: null, thinkingOptionId: null })).toEqual({
      skip: "no model selected",
    });
    expect(
      resolveHome({ provider: "claude", model: "claude-haiku-5-5", thinkingOptionId: "low" }),
    ).toEqual({ skip: "already on Haiku" });
  });
});

describe("buildRouterArgs", () => {
  const settings = JevRouterSettingsSchema.parse({});

  it("passes the home, cwd, images and timeout, expanding ~", () => {
    expect(
      buildRouterArgs({
        settings,
        home: opusHigh,
        cwd: "/repo",
        images: 2,
        test: false,
        homeDir: "/home/u",
      }),
    ).toEqual([
      "/home/u/projetos/gnome-custom/jev-router/route.py",
      "--cwd",
      "/repo",
      "--images",
      "2",
      "--home",
      "opus/high",
      "--timeout",
      "2",
    ]);
  });

  it("skips the log for tests and when logging is off", () => {
    const base = { home: opusHigh, cwd: "/r", images: 0, homeDir: "/h" };
    expect(buildRouterArgs({ ...base, settings, test: true })).toContain("--no-log");
    expect(
      buildRouterArgs({ ...base, settings: { ...settings, logDecisions: false }, test: false }),
    ).toContain("--no-log");
  });

  it("leaves absolute paths alone", () => {
    expect(expandHome("/opt/route.py", "/h")).toBe("/opt/route.py");
  });
});

describe("parseRouterOutput", () => {
  it("reads route.py's JSON line", () => {
    const line = JSON.stringify({
      model: "sonnet",
      model_id: "claude-sonnet-5-5",
      effort: "low",
      why: "small",
      latency_ms: 193,
      changed: true,
    });
    expect(parseRouterOutput(`warning\n${line}\n`)).toEqual({
      model: "sonnet",
      modelId: "claude-sonnet-5-5",
      effort: "low",
      why: "small",
      latencyMs: 193,
      error: null,
    });
  });

  it("throws on output without a model", () => {
    expect(() => parseRouterOutput('{"why":"x"}')).toThrow(/without a model/);
    expect(() => parseRouterOutput("")).toThrow();
  });
});

describe("planRoute", () => {
  it("applies a cheaper family only when apply is on", () => {
    const applied = planRoute({ decision: decision("sonnet"), home: opusHigh, apply: true });
    expect(applied).toMatchObject({
      model: "claude-sonnet-5-5",
      thinkingOptionId: "low",
      applied: true,
      home: "opus/high",
    });
    expect(applied.labels).toEqual({
      "custom.jev.pick": "sonnet/low",
      "custom.jev.home": "opus/high",
      "custom.jev.why": "small",
      "custom.jev.applied": "true",
    });
    const shadow = planRoute({ decision: decision("sonnet"), home: opusHigh, apply: false });
    expect(shadow).toMatchObject({ model: "claude-sonnet-5-5", applied: false });
    expect(shadow.labels["custom.jev.applied"]).toBe("false");
  });

  it("never moves to the same or a stronger family", () => {
    const sonnetHome = { family: "sonnet", effort: "medium" };
    const same = planRoute({ decision: decision("sonnet", "high"), home: sonnetHome, apply: true });
    expect(same).toMatchObject({ model: null, thinkingOptionId: null, applied: false });
    expect(same.labels["custom.jev.pick"]).toBe("sonnet/medium");
    const home = planRoute({
      decision: decision("opus", "high", "home"),
      home: opusHigh,
      apply: true,
    });
    expect(home).toMatchObject({ model: null, applied: false });
  });

  it("keeps the home model when the router failed", () => {
    const failed = planRoute({
      decision: { ...decision("haiku"), why: "error", error: "TimeoutError" },
      home: opusHigh,
      apply: true,
    });
    expect(failed).toMatchObject({ model: null, applied: false });
    expect(failed.labels["custom.jev.why"]).toBe("error");
  });
});
