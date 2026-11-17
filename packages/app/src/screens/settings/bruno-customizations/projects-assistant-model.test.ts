import { describe, expect, it } from "vitest";
import {
  assistantSettingsResponseSchema,
  chatSettingsValid,
  clampAutoFixes,
  patchChatSettings,
  patchProjectPolicy,
  resetProjectPolicy,
  setProjectAction,
  assistantChatSettingsSchema,
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
      chat: {
        provider: "claude/claude-opus-5-5",
        thinkingOptionId: "high",
        modeId: "bypassPermissions",
        skills: { mode: "all", names: [] },
        memory: true,
      },
    });
  });

  it("edits the chat settings, empty thinking and mode meaning the provider default", () => {
    const base = assistantSettingsSchema.parse({});
    const edited = patchChatSettings(base, {
      provider: " codex/gpt-5 ",
      thinkingOptionId: "",
      modeId: "",
    });
    expect(edited.chat).toEqual({
      provider: "codex/gpt-5",
      thinkingOptionId: null,
      modeId: null,
      skills: { mode: "all", names: [] },
      memory: true,
    });
    expect(chatSettingsValid(edited)).toBe(true);
    expect(chatSettingsValid(patchChatSettings(base, { provider: "" }))).toBe(false);
  });

  // CUSTOM(agent-profiles)
  it("keeps the profile settings of the chat through an edit and parses data without them", () => {
    const stored = assistantSettingsSchema.parse({
      chat: { provider: "claude/x", skills: { mode: "selected", names: ["a:b"] }, memory: false },
    });
    const edited = patchChatSettings(stored, { thinkingOptionId: "low" });
    expect(edited.chat.skills).toEqual({ mode: "selected", names: ["a:b"] });
    expect(edited.chat.memory).toBe(false);
    expect(assistantChatSettingsSchema.parse({ provider: "claude/x" }).memory).toBe(true);
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
