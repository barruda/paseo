import { describe, expect, test } from "vitest";

import { clampTitleWords, resolveCreateAgentTitles } from "./agent/create-agent-title.js";

describe("resolveCreateAgentTitles", () => {
  test("derives a provisional title from prompt when explicit title is absent", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: undefined,
      initialPrompt: "Implement auth retries with backoff\n\ninclude tests",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBe("Implement auth retries with");
  });

  test("preserves explicit title and does not treat it as provisional", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "  Keep This Title  ",
      initialPrompt: "Ignored prompt title",
    });

    expect(resolved.explicitTitle).toBe("Keep This Title");
    expect(resolved.provisionalTitle).toBe("Keep This Title");
  });

  test("returns null values when prompt and title are empty", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "   ",
      initialPrompt: "   ",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBeNull();
  });
});

describe("clampTitleWords", () => {
  test("keeps at most four words and collapses whitespace", () => {
    expect(clampTitleWords("  Refactor   PR #2638 Playwright specs for tabs ")).toBe(
      "Refactor PR #2638 Playwright",
    );
  });

  test("leaves short titles untouched", () => {
    expect(clampTitleWords("Fix tab names")).toBe("Fix tab names");
  });
});
