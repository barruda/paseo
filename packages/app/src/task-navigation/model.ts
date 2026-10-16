// CUSTOM(task-navigation): a task projection independent of workspace ordering and tab placement.
import type { Agent } from "@/stores/session-store";

export type TaskState = "needs-you" | "failed" | "review" | "working" | "idle" | "closed";
export type TaskFilter = "all" | "needs-you" | "review" | "working" | "idle";
export interface TaskAgent {
  serverId: string;
  id: string;
  workspaceId?: string;
  title: string | null;
  provider: string;
  model: string | null;
  status: Agent["status"];
  running: boolean;
  pendingPermissionCount: number;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"];
  parentAgentId: string | null;
  updatedAt: Date;
}
export interface TaskWorkspace {
  serverId: string;
  workspaceId: string;
  projectKey: string;
  projectName: string;
  name: string;
  directory: string;
}
export interface TaskNode {
  key: string;
  agent: TaskAgent;
  workspace: TaskWorkspace;
  state: TaskState;
  crewState: TaskState;
  children: TaskNode[];
  contextOnly: boolean;
}
export const TASK_STATE_ORDER: readonly TaskState[] = [
  "needs-you",
  "failed",
  "review",
  "working",
  "idle",
  "closed",
];
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  "needs-you": "Needs you",
  failed: "Failed",
  review: "Ready to review",
  working: "Working",
  idle: "Idle",
  closed: "Closed",
};
export function taskKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}
export function taskState(agent: TaskAgent): TaskState {
  if (agent.status === "error" || (agent.requiresAttention && agent.attentionReason === "error"))
    return "failed";
  if (
    agent.pendingPermissionCount > 0 ||
    (agent.requiresAttention && agent.attentionReason === "permission")
  )
    return "needs-you";
  if (agent.running || agent.status === "initializing") return "working";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "review";
  return agent.status === "closed" ? "closed" : "idle";
}
export function matchesTaskFilter(state: TaskState, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs-you") return state === "needs-you" || state === "failed";
  if (filter === "idle") return state === "idle" || state === "closed";
  return state === filter;
}
function compareNodes(a: TaskNode, b: TaskNode): number {
  return (
    TASK_STATE_ORDER.indexOf(a.crewState) - TASK_STATE_ORDER.indexOf(b.crewState) ||
    b.agent.updatedAt.getTime() - a.agent.updatedAt.getTime() ||
    a.key.localeCompare(b.key)
  );
}

export function buildTaskTree(input: {
  agents: readonly TaskAgent[];
  workspaces: readonly TaskWorkspace[];
}): TaskNode[] {
  const workspaces = new Map(input.workspaces.map((w) => [taskKey(w.serverId, w.workspaceId), w]));
  const nodes = new Map<string, TaskNode>();
  for (const agent of input.agents) {
    const workspace = agent.workspaceId
      ? workspaces.get(taskKey(agent.serverId, agent.workspaceId))
      : undefined;
    if (!workspace) continue;
    const key = taskKey(agent.serverId, agent.id);
    const state = taskState(agent);
    nodes.set(key, {
      key,
      agent,
      workspace,
      state,
      crewState: state,
      children: [],
      contextOnly: false,
    });
  }
  const parents = new Map<string, string>();
  for (const node of nodes.values()) {
    if (!node.agent.parentAgentId) continue;
    const parent = taskKey(node.agent.serverId, node.agent.parentAgentId);
    if (parent !== node.key && nodes.has(parent)) parents.set(node.key, parent);
  }
  // A malformed imported cycle must not hide an entire crew or recurse forever.
  const checked = new Set<string>();
  for (const key of nodes.keys()) {
    const path = new Set<string>();
    let current: string | undefined = key;
    while (current && !checked.has(current)) {
      if (path.has(current)) {
        parents.delete(current);
        break;
      }
      path.add(current);
      current = parents.get(current);
    }
    for (const item of path) checked.add(item);
  }
  const roots: TaskNode[] = [];
  for (const node of nodes.values()) {
    const parentKey = parents.get(node.key);
    const parent = parentKey ? nodes.get(parentKey) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const settle = (node: TaskNode): void => {
    for (const child of node.children) settle(child);
    node.children.sort(compareNodes);
    for (const child of node.children) {
      if (TASK_STATE_ORDER.indexOf(child.crewState) < TASK_STATE_ORDER.indexOf(node.crewState))
        node.crewState = child.crewState;
    }
  };
  for (const root of roots) settle(root);
  return roots.sort(compareNodes);
}

/** Keep the ancestor path to a match; a matching parent keeps its cross-workspace descendants. */
export function filterTaskTree(
  roots: readonly TaskNode[],
  input: {
    query: string;
    projectKey?: string;
    projectKeys?: readonly string[] | null;
    filter: TaskFilter;
  },
): TaskNode[] {
  const query = input.query.trim().toLocaleLowerCase();
  const visit = (node: TaskNode, inheritedMatch: boolean): TaskNode | null => {
    const ownScopeMatch =
      (input.projectKeys == null || input.projectKeys.includes(node.workspace.projectKey)) &&
      (!input.projectKey || node.workspace.projectKey === input.projectKey) &&
      (!query ||
        [
          node.agent.title,
          node.agent.id,
          node.agent.provider,
          node.agent.model,
          node.workspace.name,
          node.workspace.projectName,
          node.workspace.directory,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query));
    const scopeMatch = inheritedMatch || ownScopeMatch;
    const matches = scopeMatch && matchesTaskFilter(node.state, input.filter);
    const children = node.children
      .map((child) => visit(child, scopeMatch))
      .filter((child): child is TaskNode => child !== null);
    if (!matches && children.length === 0) return null;
    const visibleStates = [
      ...(matches ? [node.state] : []),
      ...children.map((child) => child.crewState),
    ];
    const crewState =
      visibleStates.sort((a, b) => TASK_STATE_ORDER.indexOf(a) - TASK_STATE_ORDER.indexOf(b))[0] ??
      node.state;
    return { ...node, children, crewState, contextOnly: !matches };
  };
  return roots.map((root) => visit(root, false)).filter((root): root is TaskNode => root !== null);
}
export function flattenTaskTree(
  roots: readonly TaskNode[],
  collapsed: ReadonlySet<string> = new Set(),
): { node: TaskNode; depth: number }[] {
  const rows: { node: TaskNode; depth: number }[] = [];
  const visit = (node: TaskNode, depth: number) => {
    rows.push({ node, depth });
    if (!collapsed.has(node.key)) for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

/** Preserve near-simultaneous activity order; insertion avoids a non-transitive sort comparator. */
export function sortTaskTree(
  roots: readonly TaskNode[],
  sort: "attention" | "activity" | "opened" | "title",
  openedAt: Readonly<Record<string, number>>,
  previous: readonly TaskNode[] = [],
): TaskNode[] {
  const previousByKey = new Map(previous.map((node) => [node.key, node]));
  const rank = new Map(previous.map((node, index) => [node.key, index]));
  const nodes = roots.map((node) => ({
    ...node,
    children: sortTaskTree(node.children, sort, openedAt, previousByKey.get(node.key)?.children),
  }));
  if (sort === "title")
    return nodes.sort(
      (a, b) =>
        (a.agent.title ?? "").localeCompare(b.agent.title ?? "") || a.key.localeCompare(b.key),
    );
  nodes.sort(
    (a, b) =>
      (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity) || a.key.localeCompare(b.key),
  );
  const timestamp = (node: TaskNode) =>
    sort === "opened" ? (openedAt[node.key] ?? 0) : node.agent.updatedAt.getTime();
  const precedes = (a: TaskNode, b: TaskNode) => {
    if (sort === "attention" && a.crewState !== b.crewState)
      return TASK_STATE_ORDER.indexOf(a.crewState) < TASK_STATE_ORDER.indexOf(b.crewState);
    return timestamp(a) - timestamp(b) >= 60_000;
  };
  const result: TaskNode[] = [];
  for (const node of nodes) {
    let index = result.length;
    while (index > 0 && precedes(node, result[index - 1]!)) index -= 1;
    result.splice(index, 0, node);
  }
  return result;
}

export function deskTabLabel(label: string): string {
  const characters = Array.from(label.replace(/\s+/g, " ").trim());
  return characters.length > 15 ? `${characters.slice(0, 14).join("")}…` : characters.join("");
}
