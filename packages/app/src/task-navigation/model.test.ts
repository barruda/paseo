import { describe, expect, it } from "vitest";
import {
  buildTaskTree,
  filterTaskTree,
  flattenTaskTree,
  taskKey,
  type TaskAgent,
  type TaskWorkspace,
} from "./model";

const workspaces: TaskWorkspace[] = [
  {
    serverId: "home",
    workspaceId: "one",
    projectKey: "paseo",
    projectName: "Paseo",
    name: "Navigation",
    directory: "/paseo",
  },
  {
    serverId: "home",
    workspaceId: "two",
    projectKey: "unity",
    projectName: "DreamMMO",
    name: "Terrain",
    directory: "/unity",
  },
];
function agent(id: string, overrides: Partial<TaskAgent> = {}): TaskAgent {
  return {
    serverId: "home",
    id,
    workspaceId: "one",
    title: id,
    provider: "codex",
    model: "test",
    status: "idle",
    running: false,
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    parentAgentId: null,
    updatedAt: new Date("2026-10-15T12:00:00Z"),
    ...overrides,
  };
}

function childKey(node: { key: string }) {
  return node.key;
}

describe("task navigation", () => {
  it("separates unread completions from input requests, running agents and read sessions", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("read"),
        agent("new", { requiresAttention: true, attentionReason: "finished" }),
        agent("busy", { running: true }),
        agent("permission", { pendingPermissionCount: 1 }),
      ],
    });
    expect(tree.map((t) => [t.agent.id, t.state])).toEqual([
      ["permission", "needs-you"],
      ["new", "review"],
      ["busy", "working"],
      ["read", "idle"],
    ]);
  });
  it("moves a read completion to Idle without dismissing pending permissions", () => {
    const unread = agent("finished", { requiresAttention: true, attentionReason: "finished" });
    const pending = agent("approval", {
      requiresAttention: true,
      attentionReason: "permission",
      pendingPermissionCount: 1,
    });
    const before = buildTaskTree({ workspaces, agents: [unread, pending] });
    expect(before.map((n) => n.state)).toEqual(["needs-you", "review"]);
    const after = buildTaskTree({
      workspaces,
      agents: [{ ...unread, requiresAttention: false, attentionReason: null }, pending],
    });
    expect(after.map((n) => n.state)).toEqual(["needs-you", "idle"]);
  });
  it("keeps a child in another workspace under its parent and surfaces its urgency", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("parent", { running: true }),
        agent("child", { workspaceId: "two", parentAgentId: "parent", pendingPermissionCount: 1 }),
      ],
    });
    expect(tree.map((n) => [n.agent.id, n.state, n.crewState])).toEqual([
      ["parent", "working", "needs-you"],
    ]);
    expect(
      flattenTaskTree(tree).map((r) => [r.node.agent.id, r.depth, r.node.workspace.name]),
    ).toEqual([
      ["parent", 0, "Navigation"],
      ["child", 1, "Terrain"],
    ]);
    expect(
      flattenTaskTree(tree, new Set([taskKey("home", "parent")])).map((r) => r.node.agent.id),
    ).toEqual(["parent"]);
  });
  it("retains the path to a searched child and prunes unrelated sibling branches", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("parent"),
        agent("match", { parentAgentId: "parent", workspaceId: "two" }),
        agent("sibling", { parentAgentId: "parent" }),
      ],
    });
    const filtered = filterTaskTree(tree, { query: "Terrain", projectKey: "unity", filter: "all" });
    expect(flattenTaskTree(filtered).map((r) => [r.node.agent.id, r.node.contextOnly])).toEqual([
      ["parent", true],
      ["match", false],
    ]);
  });
  it("shows cross-project children when the parent project is selected", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [agent("parent"), agent("child", { parentAgentId: "parent", workspaceId: "two" })],
    });
    expect(
      flattenTaskTree(filterTaskTree(tree, { query: "", projectKey: "paseo", filter: "all" })).map(
        (r) => r.node.agent.id,
      ),
    ).toEqual(["parent", "child"]);
  });
  it("groups a filtered crew using visible states rather than a hidden child's urgency", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("parent", { running: true }),
        agent("child", { parentAgentId: "parent", status: "error" }),
      ],
    });
    const filtered = filterTaskTree(tree, { query: "", projectKey: "", filter: "working" });
    expect(filtered.map((n) => [n.crewState, n.children.length])).toEqual([["working", 0]]);
  });
  it("does not confuse agents with identical IDs on different hosts", () => {
    const tree = buildTaskTree({
      workspaces: [...workspaces, { ...workspaces[0]!, serverId: "work" }],
      agents: [
        agent("same"),
        agent("same", { serverId: "work" }),
        agent("child", { serverId: "work", parentAgentId: "same" }),
      ],
    });
    expect(tree.map((n) => [n.key, n.children.map(childKey)])).toEqual([
      ["home:same", []],
      ["work:same", ["work:child"]],
    ]);
  });
  it("promotes surviving children when the parent is missing and bounds malformed cycles", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("orphan", { parentAgentId: "missing" }),
        agent("a", { parentAgentId: "b" }),
        agent("b", { parentAgentId: "a" }),
        agent("self", { parentAgentId: "self" }),
      ],
    });
    expect(
      flattenTaskTree(tree)
        .map((r) => r.node.agent.id)
        .sort(),
    ).toEqual(["a", "b", "orphan", "self"]);
  });
  it("excludes agents outside the visible workspace scope", () => {
    const tree = buildTaskTree({
      workspaces: [workspaces[0]!],
      agents: [
        agent("visible"),
        agent("hidden", { workspaceId: "two" }),
        agent("unplaced", { workspaceId: undefined }),
      ],
    });
    expect(tree.map((n) => n.agent.id)).toEqual(["visible"]);
  });
  it("keeps failure actionable even if a permission is also pending, and distinguishes closed sessions", () => {
    const tree = buildTaskTree({
      workspaces,
      agents: [
        agent("failed", { status: "error", pendingPermissionCount: 1 }),
        agent("closed", { status: "closed" }),
      ],
    });
    expect(tree.map((n) => n.state)).toEqual(["failed", "closed"]);
  });
});
