import { describe, expect, it } from "vitest";
import {
  deskTabLabel,
  buildTaskTree,
  filterTaskTree,
  flattenTaskTree,
  taskKey,
  sortTaskTree,
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

it("supports multiple selected projects and an explicitly empty selection", () => {
  const roots = buildTaskTree({
    workspaces,
    agents: [agent("a"), agent("b", { workspaceId: "two" })],
  });
  expect(filterTaskTree(roots, { query: "", projectKeys: [], filter: "all" })).toEqual([]);
  expect(
    filterTaskTree(roots, { query: "", projectKeys: ["paseo", "unity"], filter: "all" }).map(
      childKey,
    ),
  ).toEqual(["home:a", "home:b"]);
  expect(
    filterTaskTree(roots, { query: "", projectKeys: ["unity"], filter: "all" }).map(childKey),
  ).toEqual(["home:b"]);
});
it("sorts by activity, recent opens, or title without breaking parent relationships", () => {
  const roots = buildTaskTree({
    workspaces,
    agents: [
      agent("z"),
      agent("a", { updatedAt: new Date("2026-10-16") }),
      agent("child", { parentAgentId: "z", workspaceId: "two" }),
    ],
  });
  expect(sortTaskTree(roots, "activity", {}).map(childKey)).toEqual(["home:a", "home:z"]);
  expect(sortTaskTree(roots, "opened", { "home:z": 60_000 }).map(childKey)).toEqual([
    "home:z",
    "home:a",
  ]);
  expect(sortTaskTree(roots, "title", {}).map(childKey)).toEqual(["home:a", "home:z"]);
  expect(sortTaskTree(roots, "opened", { "home:z": 60_000 })[0]?.children.map(childKey)).toEqual([
    "home:child",
  ]);
});

it("keeps activity order below a minute and moves at the exact threshold", () => {
  const tree = (a: number, b: number) =>
    buildTaskTree({
      workspaces,
      agents: [agent("a", { updatedAt: new Date(a) }), agent("b", { updatedAt: new Date(b) })],
    });
  for (const sort of ["activity", "attention"] as const) {
    const initial = sortTaskTree(tree(59_000, 0), sort, {});
    const nearby = sortTaskTree(tree(59_000, 118_999), sort, {}, initial);
    expect(nearby.map(childKey)).toEqual(["home:a", "home:b"]);
    const moved = sortTaskTree(tree(59_000, 119_000), sort, {}, nearby);
    expect(moved.map(childKey)).toEqual(["home:b", "home:a"]);
    expect(sortTaskTree(tree(120_000, 119_000), sort, {}, moved).map(childKey)).toEqual([
      "home:b",
      "home:a",
    ]);
  }
});
it("stabilizes recent opens and nested siblings while retaining attention groups", () => {
  const roots = buildTaskTree({ workspaces, agents: [agent("a"), agent("b")] });
  const initial = sortTaskTree(roots, "opened", { "home:b": 60_000 });
  expect(
    sortTaskTree(roots, "opened", { "home:a": 119_999, "home:b": 60_000 }, initial).map(childKey),
  ).toEqual(["home:b", "home:a"]);
  const nested = (time: number) =>
    buildTaskTree({
      workspaces,
      agents: [
        agent("parent"),
        agent("a", { parentAgentId: "parent", updatedAt: new Date(0) }),
        agent("b", { parentAgentId: "parent", updatedAt: new Date(time) }),
      ],
    });
  const before = sortTaskTree(nested(0), "activity", {});
  expect(sortTaskTree(nested(59_999), "activity", {}, before)[0]?.children.map(childKey)).toEqual([
    "home:a",
    "home:b",
  ]);
  expect(sortTaskTree(nested(60_000), "activity", {}, before)[0]?.children.map(childKey)).toEqual([
    "home:b",
    "home:a",
  ]);
  const attention = buildTaskTree({
    workspaces,
    agents: [agent("a"), agent("b", { pendingPermissionCount: 1 })],
  });
  expect(sortTaskTree(attention, "attention", {}, roots).map(childKey)).toEqual([
    "home:b",
    "home:a",
  ]);
});
it("limits Desk labels to 15 characters including ellipsis and removes line breaks", () => {
  expect(deskTabLabel("123456789012345")).toBe("123456789012345");
  expect(deskTabLabel("1234567890123456")).toBe("12345678901234…");
  expect(deskTabLabel("hello\nworld")).toBe("hello world");
  expect(Array.from(deskTabLabel("😀".repeat(16)))).toHaveLength(15);
});

it("does not jump across a near-simultaneous neighbor to reach an older task", () => {
  const roots = buildTaskTree({
    workspaces,
    agents: [
      agent("a", { updatedAt: new Date(0) }),
      agent("b", { updatedAt: new Date(40_000) }),
      agent("c", { updatedAt: new Date(80_000) }),
    ],
  });
  expect(sortTaskTree(roots, "activity", {}).map(childKey)).toEqual(["home:a", "home:b", "home:c"]);
});
