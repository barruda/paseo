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

function sessionEntry(id: string, sidebarTab: ArchivedEntry["sidebarTab"]): ArchivedEntry {
  return {
    serverId: "s",
    id,
    title: id,
    provider: "claude",
    status: "closed",
    archivedAt: ARCHIVED_AT,
    sidebarTab,
  };
}

// CUSTOM(sidebar-agent-tabs)
describe("mergeArchivedAgents", () => {
  const historyAgents = [
    historyAgent("mine"),
    historyAgent("mine-child", { "paseo.parent-agent-id": "mine" }),
    historyAgent("board", { "paseo.board-agent": "true" }),
    historyAgent("chat", { "pwb/assistant-chat": "true" }),
    historyAgent("ship", { "paseo.parent-agent-id": "chat" }),
  ];
  const sessionArchived = [
    sessionEntry("fresh-board", "orchestrators"),
    sessionEntry("fresh", "user"),
  ];

  it("keeps every archived agent and tags its tab", () => {
    const tabs = Object.fromEntries(
      mergeArchivedAgents({ historyAgents, sessionArchived }).map((agent) => [
        agent.id,
        agent.sidebarTab,
      ]),
    );
    expect(tabs).toEqual({
      mine: "user",
      "mine-child": "user",
      board: "orchestrators",
      chat: "orchestrators",
      ship: "workers",
      "fresh-board": "orchestrators",
      fresh: "user",
    });
  });
});
