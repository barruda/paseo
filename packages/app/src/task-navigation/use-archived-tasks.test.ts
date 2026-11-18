import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { mergeArchivedAgents, type ArchivedEntry } from "./use-archived-tasks";

const ARCHIVED_AT = new Date("2026-11-18T10:00:00Z");

function historyAgent(id: string, labels: Record<string, string> = {}): AggregatedAgent {
  return {
    serverId: "s",
    serverLabel: "s",
    id,
    title: id,
    provider: "claude",
    status: "closed",
    archivedAt: ARCHIVED_AT,
    labels,
  } as AggregatedAgent;
}

function sessionEntry(id: string, board: boolean): ArchivedEntry {
  return {
    serverId: "s",
    id,
    title: id,
    provider: "claude",
    status: "closed",
    archivedAt: ARCHIVED_AT,
    board,
  };
}

// CUSTOM(hidden-board-agents)
describe("mergeArchivedAgents", () => {
  const historyAgents = [
    historyAgent("mine"),
    historyAgent("board", { "paseo.board-agent": "true" }),
    historyAgent("chat", { "pwb/assistant-chat": "true" }),
    historyAgent("ship", { "paseo.parent-agent-id": "chat" }),
  ];
  const sessionArchived = [sessionEntry("fresh-board", true), sessionEntry("fresh", false)];

  it("leaves board agents out by default", () => {
    const ids = mergeArchivedAgents({ historyAgents, sessionArchived, includeBoardAgents: false })
      .map((agent) => agent.id)
      .sort();
    expect(ids).toEqual(["chat", "fresh", "mine"]);
  });

  it("shows them when Show board agents is on", () => {
    const ids = mergeArchivedAgents({ historyAgents, sessionArchived, includeBoardAgents: true })
      .map((agent) => agent.id)
      .sort();
    expect(ids).toEqual(["board", "chat", "fresh", "fresh-board", "mine", "ship"]);
  });
});
