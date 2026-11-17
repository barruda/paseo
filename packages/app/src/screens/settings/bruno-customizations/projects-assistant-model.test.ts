import { describe, expect, it } from "vitest";
import {
  assistantSettingsResponseSchema,
  clampAutoFixes,
  patchProjectPolicy,
  resetProjectPolicy,
  setProjectAction,
  assistantSettingsSchema,
} from "./projects-assistant-model";

describe("projects assistant settings model", () => {
  it("fills defaults when parsing a response", () => {
    const parsed = assistantSettingsResponseSchema.parse({
      settings: {},
      projects: [{ id: "p", name: "P", directory: "/p", isGit: true }],
    });
    expect(parsed.settings).toEqual({
      enabled: true,
      defaultAction: "notify",
      projects: {},
    });
  });

  it("rejects merge as the default action", () => {
    expect(assistantSettingsSchema.safeParse({ defaultAction: "merge" }).success).toBe(false);
  });

  it("creates a rule when an action is picked and removes it on reset", () => {
    const base = assistantSettingsSchema.parse({});
    const picked = setProjectAction(base, "p", "merge");
    expect(picked.projects.p).toMatchObject({
      action: "merge",
      autoFixes: 1,
      verifyCommand: "",
    });
    const edited = patchProjectPolicy(picked, "p", { observe: true });
    expect(edited.projects.p.observe).toBe(true);
    expect(resetProjectPolicy(edited, "p").projects).toEqual({});
  });

  it("does not create a rule when patching a project without one", () => {
    const base = assistantSettingsSchema.parse({});
    expect(patchProjectPolicy(base, "p", { observe: true })).toBe(base);
  });

  it("clamps auto-fix attempts to 0-3", () => {
    expect(clampAutoFixes(7)).toBe(3);
    expect(clampAutoFixes(-1)).toBe(0);
    expect(clampAutoFixes(Number.NaN)).toBe(0);
  });
});
