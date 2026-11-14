import {
  DelegationSettingsSchema,
  MAX_DELEGATION_EXTRA_CHARS,
} from "@getpaseo/protocol/delegation";
import { describe, expect, it } from "vitest";
import { openDelegationForm } from "./form-model";

function loaded() {
  const form = openDelegationForm();
  form.applyLoaded(DelegationSettingsSchema.parse({ enabled: true }), "r1");
  return form;
}

describe("delegation form", () => {
  it("can save once loaded", () => {
    const form = openDelegationForm();
    expect(form.getState().canSave).toBe(false);
    form.applyLoaded(DelegationSettingsSchema.parse({}), "r1");
    expect(form.getState()).toMatchObject({ canSave: true, revision: "r1" });
    expect(form.getState().draft.implementerModel).toBe("sonnet");
  });

  it("edits one field at a time", () => {
    const form = loaded();
    form.set("implementerModel", "opus");
    form.set("implementerEffort", "low");
    form.set("searchModel", "haiku");
    expect(form.getState().draft).toMatchObject({
      enabled: true,
      implementerModel: "opus",
      implementerEffort: "low",
      searchModel: "haiku",
    });
  });

  it("runs the implementer as a Claude subagent by default", () => {
    const form = loaded();
    expect(form.getState().draft.implementerRunner).toBe("claude");
    form.set("implementerRunner", "paseo");
    expect(form.getState().draft.implementerRunner).toBe("paseo");
  });

  it("starts the Paseo subagent on Claude's default model and thinking", () => {
    expect(loaded().getState().draft).toMatchObject({
      paseoProvider: "claude",
      paseoModel: "",
      paseoThinkingOptionId: "",
    });
  });

  it("resets the Paseo model and thinking when the provider changes", () => {
    const form = loaded();
    form.set("paseoModel", "sonnet");
    form.set("paseoThinkingOptionId", "high");
    form.setPaseoProvider("codex");
    expect(form.getState().draft).toMatchObject({
      paseoProvider: "codex",
      paseoModel: "",
      paseoThinkingOptionId: "",
    });
  });

  it("keeps the Paseo model and thinking when the same provider is chosen again", () => {
    const form = loaded();
    form.set("paseoModel", "sonnet");
    form.set("paseoThinkingOptionId", "high");
    form.setPaseoProvider("claude");
    expect(form.getState().draft).toMatchObject({
      paseoModel: "sonnet",
      paseoThinkingOptionId: "high",
    });
  });

  it("keeps the Paseo thinking option only when the new model offers it", () => {
    const form = loaded();
    form.set("paseoThinkingOptionId", "high");
    form.setPaseoModel("a", ["low", "high"]);
    expect(form.getState().draft).toMatchObject({ paseoModel: "a", paseoThinkingOptionId: "high" });
    form.setPaseoModel("b", ["low"]);
    expect(form.getState().draft).toMatchObject({ paseoModel: "b", paseoThinkingOptionId: "" });
  });

  it("blocks saving extra instructions that are too long", () => {
    const form = loaded();
    form.set("extraInstructions", "x".repeat(MAX_DELEGATION_EXTRA_CHARS + 1));
    expect(form.getState().extraError).toBeTruthy();
    expect(form.getState().canSave).toBe(false);
  });

  it("blocks saving subagent instructions that are too long", () => {
    const form = loaded();
    expect(form.getState().draft.subagentInstructions).toBe("");
    form.set("subagentInstructions", "x".repeat(MAX_DELEGATION_EXTRA_CHARS + 1));
    expect(form.getState().subagentInstructionsError).toBeTruthy();
    expect(form.getState().canSave).toBe(false);
    form.set("subagentInstructions", "");
    expect(form.getState().canSave).toBe(true);
  });

  it("edits the subagent context", () => {
    const form = loaded();
    expect(form.getState().draft.subagentContext).toBe("full");
    form.set("subagentContext", "project");
    expect(form.getState().draft.subagentContext).toBe("project");
  });

  it("reads stored settings without a subagent context as full", () => {
    expect(DelegationSettingsSchema.parse({ enabled: true }).subagentContext).toBe("full");
  });

  it("edits the subagent cache TTL, defaulting to 5m", () => {
    const form = loaded();
    expect(form.getState().draft.subagentCacheTtl).toBe("5m");
    form.set("subagentCacheTtl", "1h");
    expect(form.getState().draft.subagentCacheTtl).toBe("1h");
    expect(DelegationSettingsSchema.parse({ enabled: true }).subagentCacheTtl).toBe("5m");
  });

  it("ignores edits after closing", () => {
    const form = loaded();
    form.close();
    form.set("when", "aggressive");
    expect(form.getState().draft.when).toBe("balanced");
  });
});
