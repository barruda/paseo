import { describe, expect, it } from "vitest";
import { DelegationSettingsSchema } from "@getpaseo/protocol/delegation";
import {
  DELEGATION_MARKER,
  IMPLEMENTER_AGENT_NAME,
  SEARCH_AGENT_NAME,
  buildDelegationPolicy,
  isDelegationEligible,
  withDelegationPolicy,
} from "./policy";

const defaults = DelegationSettingsSchema.parse({});

describe("isDelegationEligible", () => {
  it("takes Claude sessions on Opus, Fable or the provider default", () => {
    expect(isDelegationEligible({ provider: "claude", model: "claude-opus-5-5" })).toBe(true);
    expect(isDelegationEligible({ provider: "claude", model: "claude-opus-4-8[1m]" })).toBe(true);
    expect(isDelegationEligible({ provider: "claude", model: "claude-fable-5-2" })).toBe(true);
    expect(isDelegationEligible({ provider: "claude" })).toBe(true);
  });

  it("leaves cheaper models, other providers and sessions that already have the rule", () => {
    expect(isDelegationEligible({ provider: "claude", model: "claude-sonnet-5-5" })).toBe(false);
    expect(isDelegationEligible({ provider: "claude", model: "claude-haiku-5-5" })).toBe(false);
    expect(isDelegationEligible({ provider: "codex", model: "gpt-5.5" })).toBe(false);
    expect(
      isDelegationEligible({
        provider: "claude",
        model: "claude-opus-5-5",
        systemPrompt: `mine\n\n${DELEGATION_MARKER}\n...`,
      }),
    ).toBe(false);
  });
});

describe("buildDelegationPolicy", () => {
  it("names the implementer's model and effort for the Agent tool", () => {
    const policy = buildDelegationPolicy(defaults);
    expect(policy.startsWith(DELEGATION_MARKER)).toBe(true);
    expect(policy).toContain(`subagent_type "${IMPLEMENTER_AGENT_NAME}"`);
    expect(policy).not.toContain("general-purpose");
    expect(policy).toContain('model "sonnet" and effort "medium"');
    expect(policy).toContain("SendMessage");
    expect(policy).not.toContain("Explore");
  });

  it("follows the settings", () => {
    const policy = buildDelegationPolicy({
      ...defaults,
      implementerModel: "opus",
      implementerEffort: "low",
      when: "conservative",
      review: false,
      searchModel: "haiku",
      extraInstructions: "  Never delegate Unity scene edits.  ",
    });
    expect(policy).toContain('model "opus" and effort "low"');
    expect(policy).toContain("only after the user approved a plan");
    expect(policy).not.toContain("SendMessage");
    expect(policy).toContain(`subagent_type "${SEARCH_AGENT_NAME}"`);
    expect(policy).not.toContain("Explore");
    expect(policy.endsWith("Never delegate Unity scene edits.")).toBe(true);
  });
});

describe("paseo runner", () => {
  const paseo = { ...defaults, implementerRunner: "paseo" as const };

  it("tells the session to create a Paseo subagent instead of using the Agent tool", () => {
    const policy = buildDelegationPolicy({
      ...paseo,
      paseoProvider: "codex",
      paseoModel: "gpt-5.1-codex",
      paseoThinkingOptionId: "high",
    });
    expect(policy).toContain("mcp__paseo__create_agent");
    expect(policy).toContain('provider "codex/gpt-5.1-codex", settings.thinkingOptionId "high"');
    expect(policy).toContain("notifyOnFinish");
    expect(policy).not.toContain(`subagent_type "${IMPLEMENTER_AGENT_NAME}"`);
    expect(policy).toContain("the Paseo send_agent_prompt tool instead of creating a new one");
    expect(policy).not.toContain("SendMessage");
  });

  it("names only the provider for its default model, and omits an unset thinking option", () => {
    const policy = buildDelegationPolicy({ ...paseo, implementerEffort: "high" });
    expect(policy).toContain('provider "claude", a short title');
    expect(policy).not.toContain("thinkingOptionId");
    expect(policy).not.toContain("claude/sonnet");
  });

  it("names a model without a thinking option", () => {
    const policy = buildDelegationPolicy({ ...paseo, paseoModel: "sonnet" });
    expect(policy).toContain('provider "claude/sonnet", a short title');
    expect(policy).not.toContain("thinkingOptionId");
  });

  it("keeps the search line on the Agent tool", () => {
    expect(buildDelegationPolicy({ ...paseo, searchModel: "haiku" })).toContain(
      `subagent_type "${SEARCH_AGENT_NAME}"`,
    );
  });

  it("leaves the subagent instructions to the Paseo subagent's own system prompt", () => {
    expect(buildDelegationPolicy({ ...paseo, subagentInstructions: "End short." })).not.toContain(
      "Subagent instructions",
    );
  });

  it("is the Claude subagent runner by default", () => {
    expect(defaults.implementerRunner).toBe("claude");
  });
});

describe("subagent instructions", () => {
  it("adds nothing when empty", () => {
    expect(buildDelegationPolicy({ ...defaults, subagentInstructions: "  " })).not.toContain(
      "Subagent instructions",
    );
  });

  it("tells the session to end every Agent prompt with the text, verbatim, before the extras", () => {
    const policy = buildDelegationPolicy({
      ...defaults,
      subagentInstructions: "  End with a short report.\nList files.  ",
      extraInstructions: "Extra.",
    });
    expect(policy).toContain("Agent tool");
    expect(policy).toContain("quoted verbatim:\nEnd with a short report.\nList files.");
    expect(policy.indexOf("Subagent instructions")).toBeLessThan(policy.indexOf("Extra."));
    expect(policy.endsWith("Extra.")).toBe(true);
  });
});

describe("withDelegationPolicy", () => {
  it("keeps the session's own system prompt first", () => {
    expect(withDelegationPolicy(undefined, "rule")).toBe("rule");
    expect(withDelegationPolicy("  ", "rule")).toBe("rule");
    expect(withDelegationPolicy("own", "rule")).toBe("own\n\nrule");
  });
});
