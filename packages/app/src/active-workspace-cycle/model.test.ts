import { shouldHighlightWorkspaceRow } from "@/recent-workspaces/highlight";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_WORKSPACE_WINDOW_MS,
  collectRecentlyActiveWorkspaces,
  nextRecentlyActiveWorkspace,
  type CycleSession,
} from "./model";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000);

function session(input: {
  agents: { id: string; workspaceId: string; at: Date; archived?: boolean }[];
  running?: string[];
}): CycleSession {
  return {
    workspaces: new Map(
      ["w1", "w2", "w3", "w4"].map((id) => [
        id,
        { status: input.running?.includes(id) ? "running" : "done" },
      ]),
    ),
    agents: new Map(
      input.agents.map((agent) => [
        agent.id,
        {
          id: agent.id,
          workspaceId: agent.workspaceId,
          archivedAt: agent.archived ? minutesAgo(1) : null,
          lastActivityAt: agent.at,
        },
      ]),
    ),
    workspaceAgentActivity: new Map(),
  };
}

const ORDER = ["w1", "w2", "w3", "w4"].map((workspaceId) => ({ serverId: "s", workspaceId }));
const ids = (targets: { workspaceId: string }[]) => targets.map((target) => target.workspaceId);

describe("collectRecentlyActiveWorkspaces", () => {
  it("keeps workspaces with agent activity inside the window, in sidebar order", () => {
    const targets = collectRecentlyActiveWorkspaces({
      order: ORDER,
      sessions: {
        s: session({
          agents: [
            { id: "a", workspaceId: "w3", at: minutesAgo(2) },
            { id: "b", workspaceId: "w1", at: minutesAgo(44) },
            { id: "c", workspaceId: "w2", at: minutesAgo(46) },
            { id: "d", workspaceId: "w4", at: minutesAgo(1), archived: true },
          ],
        }),
      },
      agentLastActivity: new Map(),
      now: NOW,
    });
    expect(ids(targets)).toEqual(["w1", "w3"]);
  });

  it("uses the live activity timestamps and counts running workspaces", () => {
    const targets = collectRecentlyActiveWorkspaces({
      order: ORDER,
      sessions: {
        s: session({
          agents: [{ id: "a", workspaceId: "w2", at: minutesAgo(60) }],
          running: ["w4"],
        }),
      },
      agentLastActivity: new Map([["a", minutesAgo(3)]]),
      now: NOW,
    });
    expect(ids(targets)).toEqual(["w2", "w4"]);
  });

  it("returns the order's own objects, once each", () => {
    const order = ["w1", "w2", "w3", "w4", "w1"].map((workspaceId) => ({
      serverId: "s",
      workspaceId,
      name: workspaceId,
    }));
    const targets = collectRecentlyActiveWorkspaces({
      order,
      sessions: { s: session({ agents: [{ id: "a", workspaceId: "w1", at: minutesAgo(1) }] }) },
      agentLastActivity: new Map(),
      now: NOW,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(order[0]);
  });

  it("uses a 45 minute window", () => {
    expect(ACTIVE_WORKSPACE_WINDOW_MS).toBe(45 * 60_000);
  });
});

describe("nextRecentlyActiveWorkspace", () => {
  const targets = ORDER.slice(0, 3);
  it("goes to the next one and wraps", () => {
    expect(nextRecentlyActiveWorkspace(targets, ORDER[0])?.workspaceId).toBe("w2");
    expect(nextRecentlyActiveWorkspace(targets, ORDER[2])?.workspaceId).toBe("w1");
  });

  it("starts at the first when the current workspace isn't active", () => {
    expect(nextRecentlyActiveWorkspace(targets, ORDER[3])?.workspaceId).toBe("w1");
    expect(nextRecentlyActiveWorkspace(targets, null)?.workspaceId).toBe("w1");
  });

  it("has nowhere to go when only the current workspace is active, or none", () => {
    expect(nextRecentlyActiveWorkspace([ORDER[0]], ORDER[0])).toBeNull();
    expect(nextRecentlyActiveWorkspace([], ORDER[0])).toBeNull();
  });
});

describe("Recent row highlighting", () => {
  const workspace = { serverId: "host-1", workspaceId: "workspace-1" };
  const state = { target: workspace, visibleWorkspaces: [workspace] };

  it("highlights only the Recent copy after cycling", () => {
    expect(
      shouldHighlightWorkspaceRow({ ...state, workspace, selected: true, isRecentRow: true }),
    ).toBe(true);
    expect(
      shouldHighlightWorkspaceRow({ ...state, workspace, selected: true, isRecentRow: false }),
    ).toBe(false);
    expect(
      shouldHighlightWorkspaceRow({ ...state, workspace, selected: false, isRecentRow: true }),
    ).toBe(false);
  });

  it("restores the ordinary highlight when Recent is collapsed, hidden, or the target ages out", () => {
    expect(
      shouldHighlightWorkspaceRow({
        ...state,
        visibleWorkspaces: [],
        workspace,
        selected: true,
        isRecentRow: false,
      }),
    ).toBe(true);
  });

  it("keeps normal navigation and other hosts highlighted", () => {
    expect(
      shouldHighlightWorkspaceRow({
        ...state,
        target: null,
        workspace,
        selected: true,
        isRecentRow: false,
      }),
    ).toBe(true);
    expect(
      shouldHighlightWorkspaceRow({
        ...state,
        workspace: { ...workspace, serverId: "host-2" },
        selected: true,
        isRecentRow: false,
      }),
    ).toBe(true);
  });
});
