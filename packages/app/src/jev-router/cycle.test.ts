import { JevRouterSettingsSchema } from "@getpaseo/protocol/jev-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleLockedCycleKey,
  lockedCycleFor,
  lockedNextEffort,
  lockedPreviousModel,
  useJevRouterSettingsStore,
} from "./cycle";

const HAIKU = "claude-haiku-5-5";
const OPUS = "claude-opus-5-5";
const cycle = [
  { model: HAIKU, efforts: ["low", "medium", "high"] },
  { model: OPUS, efforts: ["low", "high"] },
];

function storeSettings(patch: Record<string, unknown>) {
  const base = JevRouterSettingsSchema.parse({});
  useJevRouterSettingsStore.getState().set("s1", { ...base, ...patch });
}

afterEach(() => useJevRouterSettingsStore.setState({ byServer: {} }));

describe("lockedCycleFor", () => {
  it("is on only for Claude in Effort focused with the lock checked", () => {
    storeSettings({ mode: "effort" });
    expect(lockedCycleFor("s1", "claude")).toEqual(cycle);
    expect(lockedCycleFor("s1", "codex")).toBeNull();
    expect(lockedCycleFor("s2", "claude")).toBeNull();
    storeSettings({ mode: "model" });
    expect(lockedCycleFor("s1", "claude")).toBeNull();
    const base = JevRouterSettingsSchema.parse({});
    storeSettings({ mode: "effort", effortFocused: { ...base.effortFocused, lockCycling: false } });
    expect(lockedCycleFor("s1", "claude")).toBeNull();
  });

  it("follows the mode even with the router off", () => {
    storeSettings({ mode: "effort", enabled: false });
    expect(lockedCycleFor("s1", "claude")).toEqual(cycle);
  });
});

describe("lockedPreviousModel", () => {
  it("switches model and keeps an effort the new model allows", () => {
    expect(lockedPreviousModel(cycle, OPUS, "high")).toEqual({ model: HAIKU, effort: "high" });
    expect(lockedPreviousModel(cycle, HAIKU, "low")).toEqual({ model: OPUS, effort: "low" });
  });

  it("moves to the nearest allowed effort, and enters the lock from another model", () => {
    expect(lockedPreviousModel(cycle, HAIKU, "medium")).toEqual({ model: OPUS, effort: "low" });
    expect(lockedPreviousModel(cycle, "claude-sonnet-5-5", "xhigh")).toEqual({
      model: OPUS,
      effort: "high",
    });
  });
});

describe("lockedNextEffort", () => {
  it("cycles the current model's allowed efforts", () => {
    expect(lockedNextEffort(cycle, OPUS, "low")).toBe("high");
    expect(lockedNextEffort(cycle, OPUS, "high")).toBe("low");
    expect(lockedNextEffort(cycle, OPUS, "medium")).toBe("low");
    expect(lockedNextEffort(cycle, HAIKU, "medium")).toBe("high");
  });

  it("leaves a model outside the lock to the regular cycling", () => {
    expect(lockedNextEffort(cycle, "claude-sonnet-5-5", "low")).toBeNull();
  });
});

describe("handleLockedCycleKey", () => {
  it("selects the model with its effort on ←, and only the effort on →", () => {
    storeSettings({ mode: "effort" });
    const calls: string[] = [];
    const base = {
      serverId: "s1",
      provider: "claude",
      modelId: OPUS,
      effortId: "low",
      selectModelAndEffort: (model: string, effort: string) => calls.push(`${model}/${effort}`),
      selectEffort: (effort: string) => calls.push(effort),
    };
    expect(handleLockedCycleKey({ ...base, actionId: "task.draft.model" })).toBe(true);
    expect(handleLockedCycleKey({ ...base, actionId: "task.draft.effort" })).toBe(true);
    expect(calls).toEqual([`${HAIKU}/low`, "high"]);
  });

  it("does nothing with the lock off", () => {
    storeSettings({ mode: "model" });
    const result = handleLockedCycleKey({
      actionId: "task.draft.model",
      serverId: "s1",
      provider: "claude",
      modelId: OPUS,
      effortId: "low",
      selectModelAndEffort: () => {
        throw new Error("should not select");
      },
      selectEffort: () => {
        throw new Error("should not select");
      },
    });
    expect(result).toBe(false);
  });
});
