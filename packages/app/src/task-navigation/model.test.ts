import { describe, expect, it } from "vitest";
import {
  buildTaskTree,
  filterTaskTree,
  flattenTaskTree,
  limitIdleTasks,
  EMPTY_TASK_STATE_SETTLING,
  settleTaskStates,
  markableUnreadTaskKeys,
  taskKey,
  sortTaskTree,
  type TaskAgent,
  type TaskState,
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

describe("idle task limit", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();
  const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000);

  it("shows the five newest idle tasks from the last day, keeping their order", () => {
    const roots = buildTaskTree({
      workspaces,
      agents: [
        ...["a", "b", "c", "d", "e", "f"].map((id, index) =>
          agent(id, { updatedAt: hoursAgo(index + 1) }),
        ),
        agent("old", { updatedAt: hoursAgo(30) }),
      ],
    });
    const { visible, hiddenCount } = limitIdleTasks(roots, { now });
    expect(visible.map((node) => node.agent.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(hiddenCount).toBe(2);
  });

  it("always shows the crew holding the selected task without spending the limit", () => {
    const roots = buildTaskTree({
      workspaces,
      agents: [
        agent("recent", { updatedAt: hoursAgo(1) }),
        agent("old-parent", { updatedAt: hoursAgo(40) }),
        agent("old-child", { updatedAt: hoursAgo(40), parentAgentId: "old-parent" }),
      ],
    });
    const { visible, hiddenCount } = limitIdleTasks(roots, {
      now,
      maxCount: 1,
      keepKey: taskKey("home", "old-child"),
    });
    expect(visible.map((node) => node.agent.id).sort()).toEqual(["old-parent", "recent"]);
    expect(hiddenCount).toBe(0);
  });
});

describe("markable unread tasks", () => {
  it("offers only each workspace's newest finished root agent", () => {
    const keys = markableUnreadTaskKeys([
      agent("older", { updatedAt: new Date("2026-10-15T10:00:00Z") }),
      agent("newer", { updatedAt: new Date("2026-10-15T11:00:00Z") }),
      agent("child", { updatedAt: new Date("2026-10-15T13:00:00Z"), parentAgentId: "newer" }),
      agent("busy", { updatedAt: new Date("2026-10-15T14:00:00Z"), running: true }),
      agent("other", { workspaceId: "two" }),
      agent("unread", {
        workspaceId: "two",
        updatedAt: new Date("2026-10-15T15:00:00Z"),
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ]);
    expect([...keys].sort()).toEqual([taskKey("home", "newer"), taskKey("home", "other")]);
  });
});

describe("task state settling", () => {
  const live = (state: TaskState) => new Map([["home:a", state]]);

  it("shows a new task at once and holds a change until it lasts a second", () => {
    let step = settleTaskStates(EMPTY_TASK_STATE_SETTLING, live("working"), 0, 1000);
    expect(step.settling.shown.get("home:a")).toBe("working");
    step = settleTaskStates(step.settling, live("review"), 100, 1000);
    expect(step.settling.shown.get("home:a")).toBe("working");
    expect(step.wakeAt).toBe(1100);
    step = settleTaskStates(step.settling, live("review"), 1100, 1000);
    expect(step.settling.shown.get("home:a")).toBe("review");
    expect(step.wakeAt).toBeNull();
  });

  it("ignores a flip that reverts within the second", () => {
    let step = settleTaskStates(EMPTY_TASK_STATE_SETTLING, live("working"), 0, 1000);
    step = settleTaskStates(step.settling, live("idle"), 100, 1000);
    const shown = step.settling.shown;
    step = settleTaskStates(step.settling, live("working"), 400, 1000);
    expect(step.settling.shown).toBe(shown);
    expect(step.settling.pending.size).toBe(0);
    expect(step.wakeAt).toBeNull();
  });

  it("restarts the wait when the pending state changes", () => {
    let step = settleTaskStates(EMPTY_TASK_STATE_SETTLING, live("working"), 0, 1000);
    step = settleTaskStates(step.settling, live("idle"), 100, 1000);
    step = settleTaskStates(step.settling, live("review"), 600, 1000);
    expect(step.wakeAt).toBe(1600);
  });

  it("shows a request for the user at once", () => {
    let step = settleTaskStates(EMPTY_TASK_STATE_SETTLING, live("working"), 0, 1000);
    step = settleTaskStates(step.settling, live("needs-you"), 100, 1000);
    expect(step.settling.shown.get("home:a")).toBe("needs-you");
  });

  it("builds the tree from the shown states", () => {
    const [node] = buildTaskTree({
      agents: [agent("a", { running: false })],
      workspaces,
      states: live("working"),
    });
    expect(node?.state).toBe("working");
  });
});
