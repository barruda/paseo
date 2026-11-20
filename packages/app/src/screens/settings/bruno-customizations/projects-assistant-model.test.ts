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
  patchProjectTests,
  formatEnv,
  parseEnv,
  parseList,
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

// CUSTOM(packages): the gate fields the PM sets must survive a save from Settings.
describe("project package gate", () => {
  it("keeps the gate a project already had and fills its defaults", () => {
    const parsed = assistantSettingsResponseSchema.parse({
      settings: {
        projects: {
          p: {
            action: "review",
            tests: {
              gateCommand: "npm run gate",
              gateRequiredEnv: ["DB_URL"],
              gateEnv: { STRICT: "1" },
              gateRiskPaths: ["**/migrations/**"],
              gateRunIn: "checkout",
            },
          },
        },
      },
      projects: [{ id: "p", name: "P", directory: "/p", isGit: true }],
    });
    expect(parsed.settings.projects.p!.tests).toEqual({
      gateCommand: "npm run gate",
      gateRequiredEnv: ["DB_URL"],
      gateEnv: { STRICT: "1" },
      gateSetupCommand: "",
      gateRiskPaths: ["**/migrations/**"],
      gateRunIn: "checkout",
    });
    // A policy stored before the gate existed gets the defaults.
    expect(projectPolicySchema.parse({ action: "merge" }).tests.gateRunIn).toBe("worktree");
  });

  it("edits only the tests block and leaves the rest of the rule alone", () => {
    const base = setProjectAction(assistantSettingsSchema.parse({}), "p", "merge");
    const edited = patchProjectTests(base, "p", {
      gateCommand: "npm test",
      gateRunIn: "checkout",
    });
    expect(edited.projects.p).toMatchObject({
      action: "merge",
      verifyCommand: "",
      tests: { gateCommand: "npm test", gateRunIn: "checkout" },
    });
    expect(patchProjectTests(assistantSettingsSchema.parse({}), "p", {})).toEqual(
      assistantSettingsSchema.parse({}),
    );
  });

  it("parses the gate's list and environment fields", () => {
    expect(parseList("DB_URL, REDIS_URL\nDB_URL")).toEqual(["DB_URL", "REDIS_URL"]);
    expect(parseList("  ")).toEqual([]);
    expect(parseEnv("A=1\nB = two, C=")).toEqual({ A: "1", B: "two", C: "" });
    expect(parseEnv("broken\n=1")).toEqual({});
    expect(formatEnv({ A: "1", B: "two" })).toBe("A=1\nB=two");
  });
});
