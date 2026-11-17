// CUSTOM(projects-assistant): pure helpers of the Projects Conversations page.
import type { Attempt, ConversationItem, Tree } from "../../shared/assistant";
import type { ConversationsStrings } from "./conversations-strings";

export type Segment = { kind: "text" | "code"; text: string };

/** Split text on ``` fences. An unclosed fence runs to the end. Blank text segments are dropped. */
export function splitFences(input: string): Segment[] {
  const segments: Segment[] = [];
  const lines = input.split("\n");
  let kind: Segment["kind"] = "text";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n");
    if (kind === "code" || text.trim().length > 0)
      segments.push({ kind, text });
    buffer = [];
  };
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      flush();
      kind = kind === "text" ? "code" : "text";
      continue;
    }
    buffer.push(line);
  }
  flush();
  return segments;
}

type Orchestrator = Tree["orchestrators"][number];

/** Keep tasks whose title contains the query; drop orchestrators left with no task. */
export function filterTree(tree: Tree, query: string): Tree {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const orchestrators: Orchestrator[] = [];
  for (const orchestrator of tree.orchestrators) {
    const tasks = orchestrator.tasks.filter((task) =>
      task.title.toLowerCase().includes(q),
    );
    if (tasks.length > 0) orchestrators.push({ ...orchestrator, tasks });
  }
  return { orchestrators };
}

export function treeIsEmpty(tree: Tree): boolean {
  return tree.orchestrators.every((o) => o.tasks.length === 0);
}

export function firstRunningAgent(
  tree: Tree,
): { agentId: string; taskId: string } | null {
  for (const orchestrator of tree.orchestrators)
    for (const task of orchestrator.tasks)
      for (const agent of task.agents)
        if (agent.status === "running")
          return { agentId: agent.agentId, taskId: task.taskId };
  return null;
}

/** Where an agent sits in the tree, by agent id or, failing that, by task id. */
export function locate(
  tree: Tree,
  agentId: string | null,
  taskId: string | null,
): { orchestratorKey: string; taskId: string } | null {
  for (const orchestrator of tree.orchestrators)
    for (const task of orchestrator.tasks) {
      const hit = agentId
        ? task.agents.some((a) => a.agentId === agentId)
        : taskId === task.taskId;
      if (hit)
        return {
          orchestratorKey: orchestratorKey(orchestrator),
          taskId: task.taskId,
        };
    }
  return null;
}

export const orchestratorKey = (o: Pick<Orchestrator, "id">): string =>
  o.id ?? "__manual__";

export function attemptLabel(
  attempt: Pick<Attempt, "index" | "trigger">,
  t: ConversationsStrings,
): string {
  return `${t.attempt} ${attempt.index} · ${t.trigger[attempt.trigger] ?? attempt.trigger}`;
}

export function agentLabel(
  agent: { title: string | null; attempt: number | null },
  index: number,
  t: ConversationsStrings,
): string {
  const title = agent.title?.trim();
  if (title) return title;
  return `${t.attempt} ${agent.attempt ?? index + 1}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function attemptDuration(
  attempt: Pick<Attempt, "startedAt" | "finishedAt">,
  now: number,
): string {
  const start = Date.parse(attempt.startedAt);
  if (Number.isNaN(start)) return "";
  const end = attempt.finishedAt ? Date.parse(attempt.finishedAt) : now;
  return formatDuration(end - start);
}

export function relativeTime(
  at: string,
  now: number,
  t: ConversationsStrings,
): string {
  const ms = now - Date.parse(at);
  if (Number.isNaN(ms)) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return t.ago.now;
  if (m < 60) return `${m}${t.ago.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t.ago.h}`;
  return `${Math.floor(h / 24)}${t.ago.d}`;
}

/** Older items first, then the latest page, without repeated ids. */
export function mergeItems(
  older: ConversationItem[],
  latest: ConversationItem[],
): ConversationItem[] {
  const seen = new Set<string>();
  const out: ConversationItem[] = [];
  for (const item of [...older, ...latest]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function pollInterval(status: string | undefined): number {
  return status === "running" ? 3_000 : 15_000;
}
