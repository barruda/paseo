import { describe, expect, it } from "vitest";

import {
  claudeLanguageOptions,
  claudeFeatures,
  describeClaudeLogin,
  formatKeyterms,
  parseKeyterms,
  sameTerms,
  showsLocalModel,
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
  it("lists the 20 supported languages plus pt-BR, each once, named in itself", () => {
    const options = claudeLanguageOptions("en");
    expect(options).toHaveLength(21);
    expect(new Set(options.map((option) => option.value)).size).toBe(21);
    expect(options.find((option) => option.value === "pt-BR")?.label).toBe("Português (Brasil)");
    expect(options.find((option) => option.value === "pt")?.label).toBe("Português");
    expect(options.find((option) => option.value === "ko")?.label).toBe("한국어");
  });

  it("keeps the current value when it is not in the list", () => {
    expect(claudeLanguageOptions("pt").map((option) => option.value)).not.toContain("xx");
    expect(claudeLanguageOptions("zh").at(-1)).toEqual({ value: "zh", label: "zh" });
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

describe("Claude features", () => {
  it("lists the features that use Claude, speaking included", () => {
    const features = (dictationProvider?: string, listeningProvider?: string, speaking?: string) =>
      claudeFeatures({ dictationProvider, listeningProvider, speakingProvider: speaking });
    expect(features("claude", "claude", "claude")).toEqual(["dictation", "listening", "speaking"]);
    expect(features("claude", "local")).toEqual(["dictation"]);
    expect(features("local", "claude", "local")).toEqual(["listening"]);
    expect(features("local", "local", "claude")).toEqual(["speaking"]);
    expect(features("local", undefined)).toEqual([]);
    expect(features("openai", "local", "openai")).toEqual([]);
  });
});

describe("local model picker", () => {
  it("shows for Local STT and for daemons that report no provider", () => {
    expect(showsLocalModel("local")).toBe(true);
    expect(showsLocalModel(undefined)).toBe(true);
    expect(showsLocalModel("claude")).toBe(false);
    expect(showsLocalModel("openai")).toBe(false);
  });
});
