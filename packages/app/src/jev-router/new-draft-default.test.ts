import { JevRouterSettingsSchema } from "@getpaseo/protocol/jev-router";
import { describe, expect, it } from "vitest";
import { planNewDraftDefault } from "./new-draft-default";

const efforts = [{ id: "low" }, { id: "medium" }, { id: "high" }];
const models = [
  { id: "claude-haiku-5-5", thinkingOptions: efforts },
  { id: "claude-opus-5-5", thinkingOptions: efforts },
];
const effortOn = JevRouterSettingsSchema.parse({ enabled: true, mode: "effort" });

function plan(overrides: Partial<Parameters<typeof planNewDraftDefault>[0]> = {}) {
  return planNewDraftDefault({
    settings: effortOn,
    provider: "claude",
    modelId: "claude-opus-5-5",
    effort: "high",
    isLoading: false,
    availableModels: models,
    ...overrides,
  });
}

describe("new draft on the Default pick", () => {
  it("moves the effort, the model, or both to Default", () => {
    const apply = { kind: "apply", model: "claude-opus-5-5", effort: "low" };
    expect(plan()).toEqual(apply);
    expect(plan({ modelId: "claude-haiku-5-5", effort: "low" })).toEqual(apply);
    expect(plan({ modelId: "claude-haiku-5-5", effort: "high" })).toEqual(apply);
    expect(plan({ effort: "low" })).toEqual({ kind: "done" });
  });

  it("waits for the selection and the router settings", () => {
    expect(plan({ isLoading: true })).toEqual({ kind: "wait" });
    expect(plan({ modelId: "" })).toEqual({ kind: "wait" });
    expect(plan({ settings: undefined })).toEqual({ kind: "wait" });
  });

  it("leaves the selection when the router is off, Model focused or not on Claude", () => {
    expect(plan({ settings: { ...effortOn, enabled: false } })).toEqual({ kind: "done" });
    expect(plan({ settings: { ...effortOn, mode: "model" } })).toEqual({ kind: "done" });
    expect(plan({ provider: "codex", modelId: "gpt-5.4" })).toEqual({ kind: "done" });
  });

  it("leaves the selection when the host doesn't offer the pick", () => {
    expect(plan({ availableModels: [models[0]] })).toEqual({ kind: "done" });
    expect(
      plan({ availableModels: [{ id: "claude-opus-5-5", thinkingOptions: [{ id: "high" }] }] }),
    ).toEqual({ kind: "done" });
  });
});
