import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { isBoardAgentInSession } from "./visibility";

function agentWith(labels: Record<string, string>): Agent {
  return { labels } as Agent;
}

describe("isBoardAgentInSession", () => {
  it("finds the parent in the session agents", () => {
    const agents = new Map([["chat", agentWith({ "pwb/assistant-chat": "true" })]]);
    expect(isBoardAgentInSession({ labels: { "paseo.parent-agent-id": "chat" } }, agents)).toBe(
      true,
    );
  });

  it("falls back to agent details", () => {
    const details = new Map([["p", agentWith({ "paseo.board-agent": "true" })]]);
    expect(
      isBoardAgentInSession({ labels: { "paseo.parent-agent-id": "p" } }, new Map(), details),
    ).toBe(true);
  });

  it("is false for a plain agent and for the chat itself", () => {
    expect(isBoardAgentInSession({ labels: {} }, undefined)).toBe(false);
    expect(isBoardAgentInSession({ labels: { "pwb/assistant-chat": "true" } }, new Map())).toBe(
      false,
    );
  });
});
