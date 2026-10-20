import { describe, expect, it } from "vitest";
import { parseLeanClaudeOutput } from "./lean-claude.js";

describe("parseLeanClaudeOutput", () => {
  it("reads the text, model, usage and cost of a claude -p JSON result", () => {
    const stdout = JSON.stringify({
      is_error: false,
      result: " Done. ",
      total_cost_usd: 0.0002,
      usage: { input_tokens: 2, cache_creation_input_tokens: 925, output_tokens: 37 },
      modelUsage: { "claude-haiku-5-5": { costUSD: 0.0002 } },
    });
    expect(parseLeanClaudeOutput(stdout)).toEqual({
      text: "Done.",
      model: "claude-haiku-5-5",
      usage: { inputTokens: 2, cacheCreationTokens: 925, cacheReadTokens: 0, outputTokens: 37 },
      costUsd: 0.0002,
    });
  });

  it("throws the CLI's message on an error result", () => {
    expect(() =>
      parseLeanClaudeOutput(JSON.stringify({ is_error: true, result: "Not logged in" })),
    ).toThrow("Not logged in");
  });
});
