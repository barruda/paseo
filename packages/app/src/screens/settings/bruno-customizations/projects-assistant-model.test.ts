import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  ASSISTANT_ACTIONS,
  ASSISTANT_DEFAULT_ACTIONS,
  actionNeedsGit,
  policyActs,
  projectPolicySchema,
  assistantSettingsResponseSchema,
  chatSettingsValid,
  clampAutoFixes,
  patchChatSettings,
  patchProjectPolicy,
  projectReview,
  resetProjectPolicy,
  setProjectAction,
  setProjectReview,
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
      defaultAction: "review",
      projects: {},
      reviews: {},
      chat: {
        provider: "claude/claude-opus-5-5",
        thinkingOptionId: "high",
        modeId: "bypassPermissions",
        skills: { mode: "all", names: [] },
        memory: true,
        wakeOnNeedsYou: true,
        wakeDelaySeconds: 12,
        compactAtTokens: 180_000,
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
      wakeOnNeedsYou: true,
      wakeDelaySeconds: 12,
      compactAtTokens: 180_000,
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

  // CUSTOM(assistant-compact)
  it("edits the compaction limit as text: empty is the default, 0 is off, and a non-number is invalid", () => {
    const base = assistantSettingsSchema.parse({});
    expect(patchChatSettings(base, { compactAtTokens: "150,000" }).chat.compactAtTokens).toBe(
      150_000,
    );
    expect(patchChatSettings(base, { compactAtTokens: " " }).chat.compactAtTokens).toBe(180_000);
    const off = patchChatSettings(base, { compactAtTokens: "0" });
    expect(off.chat.compactAtTokens).toBe(0);
    expect(chatSettingsValid(off)).toBe(true);
    expect(chatSettingsValid(patchChatSettings(base, { compactAtTokens: "180k" }))).toBe(false);
    expect(chatSettingsValid(patchChatSettings(base, { compactAtTokens: "-5" }))).toBe(false);
  });

  // CUSTOM(assistant-wake)
  it("edits the wake delay as text and defaults to 12 s", () => {
    const base = assistantSettingsSchema.parse({});
    expect(base.chat.wakeDelaySeconds).toBe(12);
    expect(patchChatSettings(base, { wakeDelaySeconds: "20" }).chat.wakeDelaySeconds).toBe(20);
    expect(patchChatSettings(base, { wakeDelaySeconds: " " }).chat.wakeDelaySeconds).toBe(12);
    expect(chatSettingsValid(patchChatSettings(base, { wakeDelaySeconds: "2" }))).toBe(false);
    expect(chatSettingsValid(patchChatSettings(base, { wakeDelaySeconds: "abc" }))).toBe(false);
  });

  it("rejects merge as the default action", () => {
    expect(assistantSettingsSchema.safeParse({ defaultAction: "merge" }).success).toBe(false);
  });

  // CUSTOM(assistant-autonomy)
  it("makes review the default and a picked action, and treats it like merge for git", () => {
    const base = assistantSettingsSchema.parse({});
    expect(base.defaultAction).toBe("review");
    expect(projectPolicySchema.parse({}).action).toBe("review");
    expect(assistantSettingsSchema.safeParse({ defaultAction: "review" }).success).toBe(true);
    expect(ASSISTANT_ACTIONS).toContain("review");
    expect(ASSISTANT_DEFAULT_ACTIONS).toContain("review");
    expect(ACTION_LABELS.review).toBe("Assistant reviews");
    expect(actionNeedsGit("review")).toBe(true);
    expect(actionNeedsGit("notify")).toBe(false);
    expect(policyActs(setProjectAction(base, "p", "review").projects.p)).toBe(true);
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

  // CUSTOM(assistant-review-policy)
  it("keeps the review apart from the project's rule, self by default", () => {
    const base = assistantSettingsSchema.parse({
      reviews: { dream: "fresh-agent" },
    });
    expect(projectReview(base, "dream")).toBe("fresh-agent");
    expect(projectReview(base, "p")).toBe("self");
    const raised = setProjectReview(base, "p", "fresh-agent");
    expect(raised.reviews).toEqual({ dream: "fresh-agent", p: "fresh-agent" });
    // Setting the review gives no project its own action.
    expect(raised.projects).toEqual({});
    expect(setProjectReview(raised, "dream", "self").reviews).toEqual({ p: "fresh-agent" });
    // A rule's reset leaves the review alone.
    const ruled = setProjectAction(raised, "p", "merge");
    expect(resetProjectPolicy(ruled, "p").reviews.p).toBe("fresh-agent");
    expect(assistantSettingsSchema.safeParse({ reviews: { p: "someone" } }).success).toBe(false);
  });

  it("clamps auto-fix attempts to 0-3", () => {
    expect(clampAutoFixes(7)).toBe(3);
    expect(clampAutoFixes(-1)).toBe(0);
    expect(clampAutoFixes(Number.NaN)).toBe(0);
  });
});
