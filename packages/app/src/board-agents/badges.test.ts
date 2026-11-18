import { describe, expect, it } from "vitest";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import {
  selectBoardAgentKeys,
  withoutBoardAgents,
  workspaceStatusesWithoutBoardAgents,
} from "./badges";

const BOARD = { "paseo.board-agent": "true" };

function agent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    status: "idle",
    pendingPermissions: [],
    requiresAttention: false,
    attentionReason: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    ...input,
  } as Agent;
}

function workspace(id: string, status: WorkspaceDescriptor["status"]): WorkspaceDescriptor {
  return { id, status } as WorkspaceDescriptor;
}

function session(workspaces: WorkspaceDescriptor[], agents: Agent[]) {
  return {
    workspaces: new Map(workspaces.map((w) => [w.id, w])),
    agents: new Map(agents.map((a) => [a.id, a])),
    agentDetails: new Map<string, Agent>(),
  };
}

describe("workspaceStatusesWithoutBoardAgents", () => {
  it("keeps the daemon status of a workspace without board agents", () => {
    const s = session(
      [workspace("w", "needs_input")],
      [agent({ id: "a", workspaceId: "w", status: "running" })],
    );
    expect(workspaceStatusesWithoutBoardAgents(s)).toEqual(["needs_input"]);
  });

  it("drops a workspace that only has board agents", () => {
    const s = session(
      [workspace("board", "attention"), workspace("mine", "failed")],
      [
        agent({ id: "b", workspaceId: "board", labels: BOARD, requiresAttention: true }),
        agent({ id: "m", workspaceId: "mine", status: "error" }),
      ],
    );
    expect(workspaceStatusesWithoutBoardAgents(s)).toEqual(["failed"]);
  });

  it("drops a workspace whose agents descend from the assistant chat", () => {
    const s = session(
      [workspace("w", "attention")],
      [
        agent({ id: "chat", workspaceId: "other", labels: { "pwb/assistant-chat": "true" } }),
        agent({
          id: "ship",
          workspaceId: "w",
          requiresAttention: true,
          labels: { "paseo.parent-agent-id": "chat" },
        }),
      ],
    );
    expect(workspaceStatusesWithoutBoardAgents(s)).toEqual([]);
  });

  it("derives a shared workspace's status from its other agents", () => {
    const s = session(
      [workspace("w", "needs_input")],
      [
        agent({
          id: "b",
          workspaceId: "w",
          labels: BOARD,
          pendingPermissions: [{}] as Agent["pendingPermissions"],
        }),
        agent({ id: "m", workspaceId: "w", requiresAttention: true }),
      ],
    );
    expect(workspaceStatusesWithoutBoardAgents(s)).toEqual(["attention"]);
  });

  it("ignores archived board agents", () => {
    const s = session(
      [workspace("w", "attention")],
      [agent({ id: "b", workspaceId: "w", labels: BOARD, archivedAt: new Date() })],
    );
    expect(workspaceStatusesWithoutBoardAgents(s)).toEqual(["attention"]);
  });
});

describe("favicon board filter", () => {
  it("lists board agents per server and drops them from the aggregated list", () => {
    const state = {
      sessions: {
        s1: session([], [agent({ id: "b", labels: BOARD }), agent({ id: "m" })]),
      },
    };
    const keys = selectBoardAgentKeys(state);
    expect(keys).toEqual(["s1:b"]);
    const list = [
      { serverId: "s1", id: "b" },
      { serverId: "s1", id: "m" },
      { serverId: "s2", id: "b" },
    ];
    expect(withoutBoardAgents(list, keys)).toEqual([
      { serverId: "s1", id: "m" },
      { serverId: "s2", id: "b" },
    ]);
    expect(withoutBoardAgents(list, [])).toBe(list);
  });
});
