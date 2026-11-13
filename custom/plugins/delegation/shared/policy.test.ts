import { describe, expect, it } from "vitest";
import { DelegationSettingsSchema } from "@getpaseo/protocol/delegation";
import {
  DELEGATION_MARKER,
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
    expect(policy).toContain('subagent_type "Explore" and model "haiku"');
    expect(policy.endsWith("Never delegate Unity scene edits.")).toBe(true);
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
