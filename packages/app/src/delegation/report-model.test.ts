import type { DelegationGroup, DelegationReport } from "@getpaseo/protocol/delegation";
import { describe, expect, it } from "vitest";
import { describeGroup, describeVerdict, formatTokens } from "./report-model";

function group(patch: Partial<DelegationGroup>): DelegationGroup {
  return {
    sessions: 0,
    missing: 0,
    turns: 0,
    mainCost: 0,
    subagentCost: 0,
    contextPerTurn: 0,
    agentCalls: 0,
    cheapAgentCalls: 0,
    ...patch,
  };
}

function report(on: Partial<DelegationGroup>, off: Partial<DelegationGroup>): DelegationReport {
  return { days: 7, delegated: group(on), other: group(off), sessions: [] };
}

describe("delegation report view", () => {
  it("averages a group over its priced sessions", () => {
    expect(
      describeGroup(
        group({
          sessions: 3,
          missing: 1,
          turns: 40,
          mainCost: 6,
          subagentCost: 2,
          contextPerTurn: 120_000,
          cheapAgentCalls: 3,
        }),
      ),
    ).toEqual({
      sessions: "2 (+1 without a transcript)",
      costPerSession: "$4.00",
      subagentShare: "25%",
      contextPerTurn: "120k",
      turnsPerSession: "20",
      delegationsPerSession: "1.5",
    });
    expect(describeGroup(group({})).costPerSession).toBe("–");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("compares cost per session and warns on a small sample", () => {
    expect(describeVerdict(report({}, { sessions: 2, mainCost: 4 }))).toBe(
      "No delegated session in this period yet.",
    );
    expect(
      describeVerdict(report({ sessions: 2, mainCost: 3 }, { sessions: 2, mainCost: 4 })),
    ).toBe(
      "Delegated sessions cost 25% less per session ($1.50 vs $2.00). Few sessions yet: sessions differ in size, so treat this as a hint.",
    );
    expect(
      describeVerdict(report({ sessions: 5, mainCost: 15 }, { sessions: 5, mainCost: 10 })),
    ).toMatch(/^Delegated sessions cost 50% more per session.*compare context per turn too\.$/);
  });
});
