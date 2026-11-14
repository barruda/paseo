import { describe, expect, it } from "vitest";
import {
  applyJevRoute,
  describeJevRouter,
  describeJevChip,
  describeJevUsage,
  describeRouteChip,
  findLatestJevCard,
  findJevRouteCardData,
  isThreadDraft,
  readJevLabels,
} from "./model";

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
  it("says on or off, the mode and what a click does", () => {
    expect(
      describeJevRouter({ settings: { enabled: true, mode: "model" }, session: null }),
    ).toEqual(["Jev router: on · Model focused", "Small first prompts start on a cheaper model."]);
    expect(
      describeJevRouter({ settings: { enabled: true, mode: "effort" }, session: null })[1],
    ).toBe("New sessions start on Haiku, Opus low or Opus high, by their first prompt.");
    expect(
      describeJevRouter({ settings: { enabled: false, mode: "effort" }, session: null })[0],
    ).toBe("Jev router: off · Effort focused");
  });

  it("tells what happened to this session", () => {
    const line = (raw: Record<string, string>) =>
      describeJevRouter({
        settings: { enabled: true, mode: "model" },
        session: readJevLabels(raw),
      })[2];
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

describe("describeRouteChip", () => {
  const card = {
    pickModelId: "claude-haiku-5-5",
    pickEffort: "low",
    why: "operational",
    homeModelId: "claude-opus-5-5",
    homeThinkingOptionId: "high",
    prompt: "rename it",
  };

  it("names the new model and effort, and what was selected before", () => {
    expect(describeRouteChip(card, { model: "claude-haiku-5-5", effort: "low" })).toEqual({
      label: "Model: Haiku 5.5 Effort: low",
      previous: "Opus 5.5 · high",
      previousModelId: "claude-opus-5-5",
      previousEffort: "high",
      prompt: "rename it",
    });
  });

  it("only names the effort when the model stayed", () => {
    const effortOnly = { ...card, pickModelId: "claude-opus-5-5", pickEffort: "low" };
    expect(describeRouteChip(effortOnly, { model: "claude-opus-5-5", effort: "low" })?.label).toBe(
      "Effort: low",
    );
  });

  it("goes away once the user changes the model or effort, or without a card", () => {
    expect(describeRouteChip(card, { model: "claude-haiku-5-5", effort: "high" })).toBeNull();
    expect(describeRouteChip(card, { model: "claude-opus-5-5", effort: "low" })).toBeNull();
    expect(describeRouteChip(undefined, { model: "claude-haiku-5-5", effort: "low" })).toBeNull();
  });

  it("finds the card among the timeline items", () => {
    const items = [
      { kind: "user_message", id: "u", text: "hi", timestamp: new Date() },
      {
        kind: "plugin",
        id: "p",
        pluginId: "jev-router",
        pluginItemId: "x",
        itemKind: "jev-route",
        version: 1,
        data: card,
        timestamp: new Date(),
      },
    ] as unknown as Parameters<typeof findJevRouteCardData>[0];
    expect(findJevRouteCardData(items)).toBe(card);
    expect(findJevRouteCardData([])).toBeUndefined();
  });
});

describe("isThreadDraft", () => {
  const chatHistory = {
    type: "text",
    mimeType: "text/plain",
    title: "Chat history",
    text: "<chat-history-summary>\nPrevious work\n</chat-history-summary>",
    contextKind: "chat_history",
  };
  const plainText = { type: "text", mimeType: "text/plain", title: "Notes", text: "notes" };

  it("is a thread when an attachment carries the previous conversation", () => {
    expect(isThreadDraft([plainText, chatHistory])).toBe(true);
  });

  it("is not a thread without chat history", () => {
    expect(isThreadDraft([plainText])).toBe(false);
    expect(isThreadDraft([])).toBe(false);
    expect(isThreadDraft(undefined)).toBe(false);
    expect(isThreadDraft([null, "x"])).toBe(false);
  });
});

describe("describeJevUsage", () => {
  const usage = (calls: string, input: string, output: string) => ({
    "custom.jev.calls": calls,
    "custom.jev.input-tokens": input,
    "custom.jev.output-tokens": output,
  });

  it("has no line until Jev was called", () => {
    expect(describeJevUsage(undefined)).toBeNull();
    expect(describeJevUsage({ other: "x" })).toBeNull();
  });

  it("counts calls and tokens with an estimated price", () => {
    expect(describeJevUsage(usage("3", "2650", "50"))).toBe(
      "Jev this session: 3 calls · 2.7k tokens (≈ US$ 0.00014)",
    );
    expect(describeJevUsage(usage("1", "900", "12"))).toBe(
      "Jev this session: 1 call · 912 tokens (≈ US$ 0.00005)",
    );
  });

  it("adds the line after the session's own", () => {
    const lines = describeJevRouter({
      settings: { enabled: true, mode: "model" },
      session: null,
      usageLine: describeJevUsage(usage("2", "1000", "0")),
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^Jev this session: 2 calls/);
  });
});

describe("the chip after an effort upgrade", () => {
  const route = {
    pickModelId: "claude-haiku-5-5",
    pickEffort: "low",
    why: "operational",
    homeModelId: "claude-opus-5-5",
    homeThinkingOptionId: "high",
    prompt: "rename it",
  };
  const upgrade = {
    modelId: "claude-opus-5-5",
    fromEffort: "low",
    toEffort: "high",
    why: "hard",
    jevEffort: "medium",
  };
  const item = (itemKind: string, data: unknown, id: string) => ({
    kind: "plugin",
    id,
    pluginId: "jev-router",
    pluginItemId: id,
    itemKind,
    version: 1,
    data,
    timestamp: new Date(),
  });
  const items = (...list: ReturnType<typeof item>[]) =>
    list as unknown as Parameters<typeof findLatestJevCard>[0];

  it("finds the latest Jev card of either kind", () => {
    const stream = items(item("jev-route", route, "a"), item("jev-upgrade", upgrade, "b"));
    expect(findLatestJevCard(stream)).toEqual({ kind: "upgrade", data: upgrade });
    expect(findLatestJevCard(items(item("jev-route", route, "a")))).toEqual({
      kind: "route",
      data: route,
    });
    expect(findLatestJevCard([])).toBeNull();
  });

  it("shows Effort: high while the agent is on it, with the effort to go back to", () => {
    const latest = { kind: "upgrade" as const, data: upgrade };
    expect(describeJevChip(latest, { model: "claude-opus-5-5", effort: "high" })).toEqual({
      kind: "upgrade",
      label: "Effort: high",
      fromEffort: "low",
      toEffort: "high",
    });
    expect(describeJevChip(latest, { model: "claude-opus-5-5", effort: "low" })).toBeNull();
  });

  it("keeps the session-start chip without a later upgrade card", () => {
    const chip = describeJevChip(
      { kind: "route", data: route },
      { model: "claude-haiku-5-5", effort: "low" },
    );
    expect(chip).toMatchObject({ kind: "route", label: "Model: Haiku 5.5 Effort: low" });
    expect(describeJevChip(null, { model: "x", effort: "low" })).toBeNull();
  });
});
