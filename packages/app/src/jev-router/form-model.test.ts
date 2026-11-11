import { JevRouterSettingsSchema } from "@getpaseo/protocol/jev-router";
import { describe, expect, it } from "vitest";
import { OPERATIONAL_OFF, openJevRouterForm, parseThreshold } from "./form-model";

function loaded() {
  const form = openJevRouterForm();
  form.applyLoaded(JevRouterSettingsSchema.parse({ apiKey: "k" }), "r1");
  return form;
}

describe("jev router form", () => {
  it("can save once loaded and keeps fields it doesn't show", () => {
    const form = openJevRouterForm();
    expect(form.getState().canSave).toBe(false);
    form.applyLoaded(JevRouterSettingsSchema.parse({ apiKey: "k" }), "r1");
    form.setMode("effort");
    expect(form.getState()).toMatchObject({ canSave: true, revision: "r1" });
    expect(form.getState().draft).toMatchObject({ apiKey: "k", mode: "effort" });
  });

  it("keeps the last valid threshold and blocks saving on a bad one", () => {
    const form = loaded();
    form.setThresholdText("effort.deep", "0,4");
    expect(form.getState().draft.effortFocused.deepThreshold).toBe(0.4);
    form.setThresholdText("effort.deep", "1.5");
    expect(form.getState().draft.effortFocused.deepThreshold).toBe(0.4);
    expect(form.getState().thresholdErrors["effort.deep"]).toBeTruthy();
    expect(form.getState().canSave).toBe(false);
  });

  it("edits the effort-focused picks and needs one operational effort", () => {
    const form = loaded();
    form.setPickEffort("defaultPick", "medium");
    form.setPickModel("hardPick", "claude-sonnet-5-5");
    form.toggleOperationalEffort("medium");
    form.toggleOperationalEffort("low");
    form.toggleOperationalEffort("high");
    const config = form.getState().draft.effortFocused;
    expect(config.defaultPick).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(config.hardPick).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
    expect(config.operationalEfforts).toEqual([]);
    expect(form.getState().canSave).toBe(false);
    form.toggleOperationalEffort("high");
    form.toggleOperationalEffort("low");
    expect(form.getState().draft.effortFocused.operationalEfforts).toEqual(["low", "high"]);
  });

  it("turns Operational off without needing an effort, and back on with a model", () => {
    const form = loaded();
    for (const effort of ["low", "medium", "high"]) form.toggleOperationalEffort(effort);
    expect(form.getState().canSave).toBe(false);
    form.setOperationalModel(OPERATIONAL_OFF);
    expect(form.getState().draft.effortFocused).toMatchObject({
      operationalEnabled: false,
      operationalModel: "claude-haiku-5-5",
    });
    expect(form.getState().canSave).toBe(true);
    form.setOperationalModel("claude-sonnet-5-5");
    expect(form.getState().draft.effortFocused).toMatchObject({
      operationalEnabled: true,
      operationalModel: "claude-sonnet-5-5",
    });
    expect(form.getState().canSave).toBe(false);
  });

  it("restores only the selected mode's defaults and remounts the threshold inputs", () => {
    const form = loaded();
    form.setThresholdText("model.small", "0.9");
    form.setMode("effort");
    form.setPickEffort("defaultPick", "high");
    const version = form.getState().textsVersion;
    form.resetMode();
    const state = form.getState();
    expect(state.draft.effortFocused.defaultPick.effort).toBe("low");
    expect(state.draft.modelFocused.smallThreshold).toBe(0.9);
    expect(state.textsVersion).toBe(version + 1);
  });

  it("turns the Sonnet step on and off", () => {
    const form = loaded();
    expect(form.getState().draft.modelFocused.useSonnet).toBe(false);
    form.setUseSonnet(true);
    expect(form.getState().draft.modelFocused.useSonnet).toBe(true);
  });

  it("edits the TypeSafe provider and blocks saving on a bad endpoint", () => {
    const form = loaded();
    form.setProviderField("apiKey", "work-key");
    form.setProviderField("jevModel", "jev-2.0.0");
    form.setProviderField("apiUrl", "gw.example");
    expect(form.getState()).toMatchObject({ canSave: false, apiUrlError: expect.any(String) });
    form.setProviderField("apiUrl", "https://gw.example/v1/systemone");
    expect(form.getState()).toMatchObject({ canSave: true, apiUrlError: null });
    expect(form.getState().draft).toMatchObject({
      apiKey: "work-key",
      apiUrl: "https://gw.example/v1/systemone",
      jevModel: "jev-2.0.0",
    });
  });

  it("parses thresholds from 0 to 1", () => {
    expect(parseThreshold("0.7")).toBe(0.7);
    expect(parseThreshold(".5")).toBe(0.5);
    expect(parseThreshold("1")).toBe(1);
    expect(parseThreshold("0")).toBe(0);
    expect(parseThreshold("abc")).toBeNull();
    expect(parseThreshold("2")).toBeNull();
  });
});
