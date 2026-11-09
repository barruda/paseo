import {
  effortFocusedCycle,
  formatClaudeModel,
  type JevDecision,
  JevRouterSettingsSchema,
  nearestEffort,
} from "@getpaseo/protocol/jev-router";
import { RouteCardStash } from "../server/stash";
import { describe, expect, it } from "vitest";
import {
  applyEffortFocused,
  applyModelFocused,
  buildRouteCard,
  buildRouterArgs,
  expandHome,
  familyOf,
  parseRouterOutput,
  planRoute,
  resolveHome,
} from "./decision";

const decision = (model: string, effort = "low", why = "small"): JevDecision => ({
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
      "--t-small",
      "0.7",
      "--t-hard",
      "0.3",
    ]);
  });

  it("asks for the effort-focused policy and its thresholds in effort mode", () => {
    const args = buildRouterArgs({
      settings: { ...settings, mode: "effort" },
      home: opusHigh,
      cwd: "/repo",
      images: 0,
      test: false,
      homeDir: "/h",
    });
    expect(args.slice(args.indexOf("--policy"))).toEqual([
      "--policy",
      "effort_focused",
      "--t-small",
      "0.7",
      "--t-hard",
      "0.3",
      "--t-deep",
      "0.5",
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
      jev_effort: "medium",
      changed: true,
    });
    expect(parseRouterOutput(`warning\n${line}\n`)).toEqual({
      model: "sonnet",
      modelId: "claude-sonnet-5-5",
      effort: "low",
      why: "small",
      latencyMs: 193,
      error: null,
      jevEffort: "medium",
    });
  });

  it("throws on output without a model", () => {
    expect(() => parseRouterOutput('{"why":"x"}')).toThrow(/without a model/);
    expect(() => parseRouterOutput("")).toThrow();
  });
});

describe("planRoute", () => {
  const plan = (d: ReturnType<typeof decision>, home = opusHigh, test = false) =>
    planRoute({ decision: d, home, test, routeId: "r1" });

  it("applies a cheaper family and labels the session with the route id", () => {
    const applied = plan(decision("sonnet"));
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
      "custom.jev.route-id": "r1",
    });
  });

  it("only reports the pick for the settings test", () => {
    const tested = plan(decision("sonnet"), opusHigh, true);
    expect(tested).toMatchObject({ model: null, applied: false });
    expect(tested.labels["custom.jev.pick"]).toBe("sonnet/low");
    expect(tested.labels["custom.jev.route-id"]).toBeUndefined();
  });

  it("never moves to the same or a stronger family", () => {
    const same = plan(decision("sonnet", "high"), { family: "sonnet", effort: "medium" });
    expect(same).toMatchObject({ model: null, thinkingOptionId: null, applied: false });
    expect(same.labels["custom.jev.pick"]).toBe("sonnet/medium");
    expect(plan(decision("opus", "high", "home"))).toMatchObject({ model: null, applied: false });
  });

  it("keeps the home model when the router failed", () => {
    const failed = plan({ ...decision("haiku"), why: "error", error: "TimeoutError" });
    expect(failed).toMatchObject({ model: null, applied: false });
    expect(failed.labels["custom.jev.why"]).toBe("error");
  });
});

describe("buildRouteCard", () => {
  it("keeps what the restart needs and drops a prompt too long for a row", () => {
    const input = {
      decision: decision("haiku", "low", "tiny"),
      homeModelId: "claude-opus-5-5",
      homeThinkingOptionId: "high",
    };
    expect(buildRouteCard({ ...input, prompt: "rename it" })).toEqual({
      pickModelId: "claude-haiku-5-5",
      pickEffort: "low",
      why: "tiny",
      homeModelId: "claude-opus-5-5",
      homeThinkingOptionId: "high",
      prompt: "rename it",
    });
    expect(buildRouteCard({ ...input, prompt: "x".repeat(40_000) }).prompt).toBeNull();
  });
});

describe("RouteCardStash", () => {
  it("hands each card out once and forgets it after 10 minutes", () => {
    let now = 0;
    const stash = new RouteCardStash(() => now);
    const card = buildRouteCard({
      prompt: "p",
      decision: decision("haiku"),
      homeModelId: "claude-opus-5-5",
      homeThinkingOptionId: null,
    });
    stash.put("a", card);
    stash.put("b", card);
    expect(stash.take("a")).toEqual(card);
    expect(stash.take("a")).toBeNull();
    now = 11 * 60_000;
    expect(stash.take("b")).toBeNull();
  });
});

describe("formatClaudeModel", () => {
  it("turns ids into names", () => {
    expect(formatClaudeModel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(formatClaudeModel("claude-opus-4-8[1m]")).toBe("Opus 4.8 [1m]");
    expect(formatClaudeModel("claude-sonnet-5")).toBe("Sonnet 5");
    expect(formatClaudeModel("gpt-5")).toBe("gpt-5");
  });
});

describe("settings defaults", () => {
  it("fills the modes into a document saved before they existed", () => {
    const old = JevRouterSettingsSchema.parse({ enabled: false, apiKey: "k" });
    expect(old.mode).toBe("model");
    expect(old.modelFocused).toEqual({ smallThreshold: 0.7, hardThreshold: 0.3, useSonnet: false });
    expect(old.effortFocused).toMatchObject({
      operationalModel: "claude-haiku-5-5",
      operationalEfforts: ["low", "medium", "high"],
      defaultPick: { model: "claude-opus-5-5", effort: "low" },
      hardPick: { model: "claude-opus-5-5", effort: "high" },
      lockCycling: true,
    });
  });
});

describe("effort focused", () => {
  const settings = { ...JevRouterSettingsSchema.parse({}), mode: "effort" as const };
  const opusLow = { family: "opus", effort: "low" };
  const route = (
    why: string,
    jevEffort: string | null,
    home = opusLow,
    homeModelId = "claude-opus-5-5",
  ) =>
    planRoute({
      decision: applyEffortFocused({ ...decision("haiku", "low", why), jevEffort }, settings),
      home,
      test: false,
      routeId: "r1",
      mode: "effort",
      homeModelId,
    });

  it("maps each bucket to its pick, moving Jev's effort to an allowed one", () => {
    expect(route("operational", "medium")).toMatchObject({
      model: "claude-haiku-5-5",
      thinkingOptionId: "medium",
      applied: true,
    });
    expect(route("chat", "high")).toMatchObject({
      model: "claude-haiku-5-5",
      thinkingOptionId: "low",
    });
    expect(route("hard", "high")).toMatchObject({
      model: "claude-opus-5-5",
      thinkingOptionId: "high",
      applied: true,
    });
  });

  it("may move up from the selection, and stays put when the pick is the selection", () => {
    const fromHaiku = route(
      "default",
      null,
      { family: "haiku", effort: "low" },
      "claude-haiku-5-5",
    );
    expect(fromHaiku).toMatchObject({
      model: "claude-opus-5-5",
      thinkingOptionId: "low",
      applied: true,
    });
    expect(route("default", null)).toMatchObject({ model: null, applied: false });
  });

  it("keeps the selection when the router failed", () => {
    const failed = planRoute({
      decision: applyEffortFocused({ ...decision("opus", "high", "error"), error: "x" }, settings),
      home: opusLow,
      test: false,
      routeId: "r1",
      mode: "effort",
      homeModelId: "claude-opus-5-5",
    });
    expect(failed).toMatchObject({ model: null, applied: false });
  });

  it("routes Haiku and unknown Claude models instead of skipping them", () => {
    expect(
      resolveHome({
        provider: "claude",
        model: "claude-haiku-5-5",
        thinkingOptionId: "low",
        mode: "effort",
      }),
    ).toEqual({ family: "haiku", effort: "low" });
    expect(
      resolveHome({ provider: "claude", model: null, thinkingOptionId: null, mode: "effort" }),
    ).toEqual({
      family: "opus",
      effort: "high",
    });
  });

  it("cycles the operational model's efforts and the picks' models", () => {
    expect(effortFocusedCycle(settings.effortFocused)).toEqual([
      { model: "claude-haiku-5-5", efforts: ["low", "medium", "high"] },
      { model: "claude-opus-5-5", efforts: ["low", "high"] },
    ]);
    expect(nearestEffort(["low", "high"], "medium")).toBe("low");
    expect(nearestEffort(["medium"], "low")).toBe("medium");
    expect(nearestEffort(["low", "high"], "xhigh")).toBe("high");
  });
});

describe("model focused Sonnet step", () => {
  const settings = JevRouterSettingsSchema.parse({});
  const route = (d: JevDecision, useSonnet: boolean) =>
    planRoute({
      decision: applyModelFocused(
        d,
        { ...settings, modelFocused: { ...settings.modelFocused, useSonnet } },
        opusHigh,
      ),
      home: opusHigh,
      test: false,
      routeId: "r1",
    });

  it("keeps the selection for a small task while Sonnet is off (the default)", () => {
    expect(route(decision("sonnet", "medium", "small"), false)).toMatchObject({
      applied: false,
      model: null,
    });
    expect(route(decision("sonnet", "medium", "small"), true)).toMatchObject({
      applied: true,
      model: "claude-sonnet-5-5",
    });
  });

  it("still drops tiny tasks to Haiku", () => {
    expect(route(decision("haiku", "low", "tiny"), false)).toMatchObject({
      applied: true,
      model: "claude-haiku-5-5",
    });
  });
});
