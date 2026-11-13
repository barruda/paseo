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

  it("blocks saving extra instructions that are too long", () => {
    const form = loaded();
    form.set("extraInstructions", "x".repeat(MAX_DELEGATION_EXTRA_CHARS + 1));
    expect(form.getState().extraError).toBeTruthy();
    expect(form.getState().canSave).toBe(false);
  });

  it("restores the defaults but keeps on/off", () => {
    const form = loaded();
    form.set("when", "aggressive");
    form.set("review", false);
    const version = form.getState().textsVersion;
    form.resetDefaults();
    expect(form.getState().draft).toMatchObject({ enabled: true, when: "balanced", review: true });
    expect(form.getState().textsVersion).toBe(version + 1);
  });

  it("edits and restores the subagent context", () => {
    const form = loaded();
    expect(form.getState().draft.subagentContext).toBe("full");
    form.set("subagentContext", "project");
    expect(form.getState().draft.subagentContext).toBe("project");
    form.resetDefaults();
    expect(form.getState().draft.subagentContext).toBe("full");
  });

  it("reads stored settings without a subagent context as full", () => {
    expect(DelegationSettingsSchema.parse({ enabled: true }).subagentContext).toBe("full");
  });

  it("ignores edits after closing", () => {
    const form = loaded();
    form.close();
    form.set("when", "aggressive");
    expect(form.getState().draft.when).toBe("balanced");
  });
});
