// CUSTOM(subagent-tab-status)
import { describe, expect, it } from "vitest";
import { hasRunningSubagent, withRunningSubagents } from "./running";
import type { PaseoSubagentRow, ProviderSubagentRow } from "./select";

function paseoRow(id: string, working: boolean): PaseoSubagentRow {
  return {
    kind: "paseo",
    address: { serverId: "server-1", agentId: id },
    id,
    provider: "claude",
    title: id,
    description: null,
    subtitle: null,
    status: working ? "running" : "idle",
    turn: working
      ? { phase: "open", turnId: null, startedAt: null, cancellationRequestId: null }
      : { phase: "idle", cancellationRequestId: null },
    requiresAttention: false,
    createdAt: new Date("2026-11-13T00:00:00.000Z"),
  };
}

function providerRow(id: string, status: ProviderSubagentRow["status"]): ProviderSubagentRow {
  return {
    kind: "provider",
    id,
    parentAgentId: "parent",
    provider: "claude",
    title: "general-purpose",
    description: id,
    subtitle: null,
    status,
    requiresAttention: status === "failed",
    createdAt: new Date("2026-11-13T00:00:00.000Z"),
  };
}

describe("hasRunningSubagent", () => {
  it("is false without subagents or with only finished ones", () => {
    expect(hasRunningSubagent([])).toBe(false);
    expect(
      hasRunningSubagent([
        paseoRow("idle", false),
        providerRow("done", "completed"),
        providerRow("failed", "failed"),
      ]),
    ).toBe(false);
  });

  it("sees a working Paseo subagent", () => {
    expect(hasRunningSubagent([paseoRow("idle", false), paseoRow("busy", true)])).toBe(true);
  });

  it("sees a working provider subagent", () => {
    expect(hasRunningSubagent([providerRow("busy", "running")])).toBe(true);
  });
});

describe("withRunningSubagents", () => {
  it("keeps the agent's own bucket when no subagent runs", () => {
    expect(withRunningSubagents("done", false)).toBe("done");
    expect(withRunningSubagents("attention", false)).toBe("attention");
    expect(withRunningSubagents(null, false)).toBeNull();
  });

  it("shows a finished agent as working while a subagent runs", () => {
    expect(withRunningSubagents("done", true)).toBe("running");
    expect(withRunningSubagents("attention", true)).toBe("running");
  });

  it("lets the agent's own permission request and error win", () => {
    expect(withRunningSubagents("needs_input", true)).toBe("needs_input");
    expect(withRunningSubagents("failed", true)).toBe("failed");
    expect(withRunningSubagents("running", true)).toBe("running");
  });

  it("does not invent a status for an agent that has not loaded", () => {
    expect(withRunningSubagents(null, true)).toBeNull();
  });
});
