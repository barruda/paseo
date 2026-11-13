import { describe, expect, it } from "vitest";

import {
  claudeLanguageOptions,
  describeClaudeLogin,
  formatKeyterms,
  parseKeyterms,
  sameTerms,
  sttProviderOptionIds,
} from "./claude-stt-model";

const base = {
  configDir: "/home/me/.claude",
  credentialsPath: "/home/me/.claude/.credentials.json",
  subscriptionType: null,
  expiresAt: null,
  error: null,
};

describe("provider options", () => {
  it("offers Local STT and Claude, plus an OpenAI value the daemon reports", () => {
    expect(sttProviderOptionIds("local")).toEqual(["local", "claude"]);
    expect(sttProviderOptionIds("claude")).toEqual(["local", "claude"]);
    expect(sttProviderOptionIds("openai")).toEqual(["local", "claude", "openai"]);
  });
});

describe("language options", () => {
  it("keeps the current value when it is not in the list", () => {
    expect(claudeLanguageOptions("pt").map((option) => option.value)).not.toContain("xx");
    expect(claudeLanguageOptions("nl").at(-1)).toEqual({ value: "nl", label: "nl" });
  });
});

describe("key terms", () => {
  it("splits on commas and newlines, trims and removes repeats", () => {
    expect(parseKeyterms(" Paseo, Unity\nDreamMMO ,, Paseo \n")).toEqual([
      "Paseo",
      "Unity",
      "DreamMMO",
    ]);
    expect(parseKeyterms("  \n ,")).toEqual([]);
  });

  it("round-trips through the text box", () => {
    expect(parseKeyterms(formatKeyterms(["Paseo", "Unity"]))).toEqual(["Paseo", "Unity"]);
    expect(formatKeyterms(undefined)).toBe("");
  });

  it("compares in order", () => {
    expect(sameTerms(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameTerms(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("login state", () => {
  it("reports the plan and file when signed in", () => {
    expect(describeClaudeLogin({ ...base, signedIn: true, subscriptionType: "max" })).toEqual({
      kind: "signedIn",
      plan: "max",
      path: base.credentialsPath,
    });
  });

  it("reports the error when not signed in", () => {
    expect(describeClaudeLogin({ ...base, signedIn: false, error: "No login" })).toEqual({
      kind: "error",
      message: "No login",
    });
  });
});
