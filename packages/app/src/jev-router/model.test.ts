import { describe, expect, it } from "vitest";
import { applyJevRoute, describeJevRouter, readJevLabels } from "./model";

const labels = (pick: string, applied: boolean, why = "small") => ({
  "custom.jev.pick": pick,
  "custom.jev.home": "opus/high",
  "custom.jev.why": why,
  "custom.jev.applied": applied ? "true" : "false",
});

const routed = (applied: boolean) => ({
  status: "routed",
  decision: {
    model: "sonnet",
    modelId: "claude-sonnet-5-5",
    effort: "low",
    why: "small",
    latencyMs: 190,
    error: null,
  },
  home: "opus/high",
  model: "claude-sonnet-5-5",
  thinkingOptionId: "low",
  applied,
  labels: labels("sonnet/low", applied),
});

const config = {
  provider: "claude",
  cwd: "/repo",
  model: "claude-opus-5-5",
  thinkingOptionId: "high",
};

describe("applyJevRoute", () => {
  it("swaps model and effort when the pick was applied", () => {
    expect(applyJevRoute(config, routed(true))).toEqual({
      config: { ...config, model: "claude-sonnet-5-5", thinkingOptionId: "low" },
      labels: labels("sonnet/low", true),
    });
  });

  it("keeps the selection when the pick was not applied but still labels the session", () => {
    expect(applyJevRoute(config, routed(false))).toEqual({
      config,
      labels: labels("sonnet/low", false),
    });
  });

  it("keeps everything on skipped, timed out or malformed answers", () => {
    const unchanged = { config, labels: {} };
    expect(applyJevRoute(config, { status: "skipped", reason: "disabled" })).toEqual(unchanged);
    expect(applyJevRoute(config, null)).toEqual(unchanged);
    expect(applyJevRoute(config, { status: "routed" })).toEqual(unchanged);
  });
});

describe("describeJevRouter", () => {
  it("says on or off and what a click does", () => {
    expect(describeJevRouter({ settings: { enabled: true }, session: null })).toEqual([
      "Jev router: on",
      "Small first prompts start on Sonnet or Haiku. Click to turn it off.",
    ]);
    expect(describeJevRouter({ settings: { enabled: false }, session: null })[0]).toBe(
      "Jev router: off",
    );
  });

  it("tells what happened to this session", () => {
    const line = (raw: Record<string, string>) =>
      describeJevRouter({ settings: { enabled: true }, session: readJevLabels(raw) })[2];
    expect(line(labels("sonnet/low", true))).toBe(
      "This session: started on sonnet/low (small), not opus/high",
    );
    expect(line(labels("opus/high", false, "home"))).toBe("This session: kept opus/high");
    expect(line(labels("opus/high", false, "error"))).toBe(
      "This session: router failed, kept opus/high",
    );
  });

  it("has no session line without jev labels", () => {
    expect(readJevLabels({ other: "x" })).toBeNull();
    expect(readJevLabels(undefined)).toBeNull();
  });
});
