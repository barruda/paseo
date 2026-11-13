import { describe, expect, it } from "vitest";

import { claudePreviewText, claudeVoiceOptionIds, claudeVoiceValue } from "./claude-tts-model";
import { previewTextFor } from "./voice-settings-model";

describe("Claude voices", () => {
  it("offers the five voices and keeps an unknown one the daemon reports", () => {
    expect(claudeVoiceOptionIds("buttery")).toEqual([
      "buttery",
      "airy",
      "mellow",
      "glassy",
      "rounded",
    ]);
    expect(claudeVoiceOptionIds("velvet")).toEqual([
      "buttery",
      "airy",
      "mellow",
      "glassy",
      "rounded",
      "velvet",
    ]);
  });

  it("defaults to buttery", () => {
    expect(claudeVoiceValue(undefined)).toBe("buttery");
    expect(claudeVoiceValue("airy")).toBe("airy");
  });
});

describe("Claude preview text", () => {
  it("reads in the Claude language, regional codes included", () => {
    expect(claudePreviewText("pt-BR")).toBe(previewTextFor("ptBR"));
    expect(claudePreviewText("pt")).toBe(previewTextFor("ptBR"));
    expect(claudePreviewText("es")).toBe(previewTextFor("es"));
    expect(claudePreviewText("de")).toBe(previewTextFor("enUS"));
    expect(claudePreviewText(undefined)).toBe(previewTextFor("enUS"));
  });
});
