import { describe, expect, it } from "vitest";
import { dataSchema, type Board, type Data } from "../shared/model";
import type { HistoryEvent } from "../shared/assistant";
import {
  buildOverview,
  buildStats,
  buildTree,
  readConversation,
  type ViewSource,
} from "../server/assistant/views";
import type { TimelinePage } from "../server/conversations";
import type { Agent } from "../server/host";

const now = new Date(2026, 5, 15, 15);
const iso = (day: number, hour = 12) =>
  new Date(2026, 5, day, hour).toISOString();
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workspaceId: `w-${id}`,
  title: `Task ${id}`,
  description: "",
  projectId: "p1",
  projectName: "Proj",
  createdAt: iso(1),
  updatedAt: iso(14),
  draftStage: "backlog",
  lastStage: "in-progress",
  lastConversationAt: null,
  conversationStatus: "none",
  issue: null,
  archived: null,
  binding: null,
  ...over,
});
const archivedState = {
  operationId: "op",
  status: "archived",
  kind: "automatic",
  stage: "done",
  startedAt: iso(1),
  archivedAt: iso(2),
  lastConversationAt: null,
  detail: "",
};
const attempt = (index: number, agentId: string | null, over = {}) => ({
  index,
  agentId,
  orchestratorId: "o1",
  startedAt: iso(14, 8 + index),
  ...over,
});
const delivery = (stage: string, over = {}) => ({
  stage,
  action: "notify",
  attempt: 1,
  startedAt: iso(14),
  updatedAt: iso(14, 13),
  ...over,
});
const make = (raw: Record<string, unknown>): Data => dataSchema.parse(raw);

const board = {
  settings: {
    groups: [
      {
        id: "ready",
        kind: "ready",
        name: "Ready to start",
        label: "pwb:ready",
      },
      { id: "review", kind: "review", name: null, label: "pwb:review" },
    ],
  },
  cards: [
    { id: "t1", stage: "review", archived: null },
    { id: "t2", stage: "ready", archived: null },
    { id: "t3", stage: "ready", archived: null },
    { id: "t9", stage: "ready", archived: { status: "archived" } },
  ],
  projects: [{ id: "p1", name: "Proj", directory: "/p", isGit: true }],
  orchestratorStatus: {
    o1: { active: true, running: 0, waiting: 0, nextRunAt: null },
  },
} as unknown as Board;

const agent = (id: string, over: Partial<Agent> = {}) =>
  ({
    id,
    title: `Agent ${id}`,
    activity: "idle",
    archivedAt: null,
    ...over,
  }) as Agent;

const data = make({
  tasks: [
    task("t1", { orchestratorId: "o1" }),
    task("t2", { updatedAt: iso(13) }),
    task("t3", { workspaceId: null }),
    task("t4", { archived: archivedState, updatedAt: iso(14) }),
    task("t5", { updatedAt: new Date(2026, 3, 1).toISOString() }),
    task("t6"),
  ],
  orchestrators: [
    { id: "o1", name: "Alpha", projectId: "p1" },
    { id: "o2", name: "Beta" },
  ],
  orchestrations: {
    t2: {
      status: "running",
      startedAt: iso(14, 9),
      agentId: "a2",
      orchestratorId: "o1",
    },
    t6: { status: "finished", startedAt: iso(14, 9), agentId: "a6" },
  },
  orchestratorLogs: {
    o1: [
      { at: iso(14, 1), level: "info", text: "old", taskId: "t1" },
      { at: iso(14, 2), level: "warn", text: "new", taskId: "t1" },
      { at: iso(14, 3), level: "info", text: "other", taskId: "t2" },
    ],
  },
  assistant: {
    deliveries: {
      t1: delivery("needs-you", { reason: "blocked", detail: "d" }),
      t3: delivery("needs-you", { updatedAt: iso(14, 14), reason: "failed" }),
      t4: delivery("needs-you"),
      gone: delivery("needs-you"),
      t6: delivery("merging"),
    },
    attempts: {
      t1: [attempt(1, "a1"), attempt(2, "a1b", { trigger: "feedback" })],
      t3: [attempt(1, "a3", { orchestratorId: null })],
      t4: [attempt(1, "a4")],
    },
  },
});
const source: ViewSource = {
  data,
  board,
  agents: [
    agent("a1b", { activity: "running" }),
    agent("a1"),
    agent("sub1", { parentAgentId: "a1b" } as never),
  ],
  now,
};

describe("overview", () => {
  it("lists needs-you, running and queued", () => {
    const overview = buildOverview(source);
    expect(overview.enabled).toBe(true);
    expect(overview.needsYou.map((item) => item.taskId)).toEqual(["t3", "t1"]);
    const t1 = overview.needsYou[1];
    expect(t1).toMatchObject({
      agentId: "a1b",
      orchestratorName: "Alpha",
      canMerge: true,
      attempt: 2,
    });
    expect(overview.needsYou[0]).toMatchObject({
      canMerge: false,
      orchestratorName: null,
    });
    expect(
      overview.running.map((item) => [item.taskId, item.stage]).sort(),
    ).toEqual([
      ["t2", "running"],
      ["t6", "merging"],
    ]);
    expect(overview.queued).toBe(2);
  });
});

const event = (
  kind: HistoryEvent["kind"],
  at: string,
  over: Partial<HistoryEvent> = {},
): HistoryEvent => ({
  id: Math.random().toString(),
  at,
  kind,
  taskId: "t1",
  taskTitle: "T",
  projectId: "p1",
  projectName: "Proj",
  orchestratorId: "o1",
  orchestratorName: "Alpha",
  agentId: null,
  attempt: 1,
  action: null,
  reason: null,
  text: "",
  detail: null,
  ...over,
});

describe("stats", () => {
  it("computes totals and fills every day", () => {
    const events = [
      event("done", iso(13, 10), { taskId: "t3", attempt: 1 }),
      event("done", iso(15, 10), { taskId: "t1", attempt: 2 }),
      event("merged", iso(15, 11)),
      event("failed", iso(15, 12), {
        projectId: null,
        projectName: "None",
        orchestratorId: null,
        orchestratorName: null,
      }),
      event("needs-you", iso(14, 12)),
      event("done", iso(1, 10), { taskId: "old" }),
    ];
    const stats = buildStats(source, events, 3);
    expect(stats.perDay.map((day) => day.date)).toEqual([
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
    ]);
    expect(stats.perDay[1]).toMatchObject({ done: 0, needsYou: 1 });
    expect(stats.perDay[2]).toMatchObject({ done: 1, merged: 1, failed: 1 });
    expect(stats.totals).toMatchObject({
      doneToday: 1,
      doneInPeriod: 2,
      mergedInPeriod: 1,
      firstTryRate: 0.5,
      averageAttempts: 1.5,
      running: 2,
      queued: 2,
      needsYou: 2,
    });
    // t1 started 14th 09:00 (attempt 1), done 15th 10:00 -> 25h; t3 started 14th 09:00, done 13th: skipped
    expect(stats.totals.averageDurationMs).toBe(25 * 3600_000);
    expect(
      stats.perProject.find((row) => row.projectId === "p1"),
    ).toMatchObject({ done: 2, merged: 1 });
    expect(stats.perProject.find((row) => row.projectId === null)?.failed).toBe(
      1,
    );
    expect(stats.perOrchestrator).toHaveLength(2);
  });

  it("has nulls with no events", () => {
    const stats = buildStats(source, [], 2);
    expect(stats.totals.firstTryRate).toBeNull();
    expect(stats.totals.averageDurationMs).toBeNull();
    expect(stats.perDay).toHaveLength(2);
  });
});

describe("tree", () => {
  it("groups by orchestrator, includes hand-started, excludes subagents and stale tasks", () => {
    const tree = buildTree(source);
    expect(tree.orchestrators.map((item) => item.id)).toEqual([
      "o1",
      "o2",
      null,
    ]);
    const [alpha, beta, hand] = tree.orchestrators;
    expect(alpha).toMatchObject({
      name: "Alpha",
      active: true,
      projectName: "Proj",
    });
    expect(alpha.tasks.map((item) => item.taskId)).toEqual(["t1", "t2"]);
    expect(alpha.tasks[0]).toMatchObject({
      column: "pwb:review",
      deliveryStage: "needs-you",
    });
    expect(alpha.tasks[0].agents).toEqual([
      {
        agentId: "a1",
        title: "Agent a1",
        status: "idle",
        attempt: 1,
        current: false,
      },
      {
        agentId: "a1b",
        title: "Agent a1b",
        status: "running",
        attempt: 2,
        current: true,
      },
    ]);
    expect(alpha.tasks[1]).toMatchObject({ column: "Ready to start" });
    expect(alpha.tasks[1].agents[0]).toMatchObject({
      agentId: "a2",
      status: "gone",
    });
    expect(JSON.stringify(tree)).not.toContain("sub1");
    expect(beta).toMatchObject({ active: false, tasks: [] });
    expect(hand.name).toBe("Started by hand");
    expect(hand.tasks.map((item) => item.taskId).sort()).toEqual(["t3", "t6"]);
  });
});

const page = (
  items: Array<{ type: string; [key: string]: unknown }>,
  over = {},
): TimelinePage => ({
  epoch: "e",
  gap: false,
  staleCursor: false,
  error: null,
  hasOlder: true,
  startCursor: { epoch: "e", seq: 10 },
  window: { maxSeq: 20 },
  entries: items.map((item, index) => ({ timestamp: iso(14, index), item })),
  ...over,
});

describe("readConversation", () => {
  it("maps items, merges assistant chunks and fills metadata", async () => {
    let call: unknown;
    const read = async (options: unknown) => {
      call = options;
      return page([
        { type: "user_message", text: "hi" },
        { type: "assistant_message", text: "Hel" },
        { type: "assistant_message", text: "lo" + "y".repeat(10000) },
        { type: "reasoning", text: "hmm" + "t".repeat(10000) },
        {
          type: "tool_call",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "ls", output: "x".repeat(10000) },
        },
        { type: "assistant_message", text: "again" },
        { type: "notification", level: "info", message: "note" },
        { type: "compaction", status: "completed" },
      ]);
    };
    const result = await readConversation(source, "a1b", read, {
      before: null,
      limit: 30,
    });
    expect(call).toEqual({ direction: "tail", cursor: undefined, limit: 30 });
    expect(
      result.items.map((item) => [item.kind, item.text.slice(0, 5)]),
    ).toEqual([
      ["user", "hi"],
      ["assistant", "Hello"],
      ["thought", "hmmtt"],
      ["tool", "ls\nxx"],
      ["assistant", "again"],
      ["system", "note"],
    ]);
    expect(result.items[1].text.length).toBe(10005); // assistant text is not capped at 4 KB
    expect(result.items[2].text.length).toBeLessThanOrEqual(4100);
    expect(result.items[3]).toMatchObject({
      toolName: "Bash",
      toolStatus: "completed",
    });
    expect(result.items[3].text.length).toBeLessThanOrEqual(4100);
    expect(result).toMatchObject({
      title: "Agent a1b",
      status: "running",
      hasOlder: true,
      cursor: { epoch: "e", seq: 10 },
      taskId: "t1",
    });
    expect(result.report).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.log.map((entry) => entry.text)).toEqual(["new", "old"]);
  });

  it("reads before a cursor and tolerates unknown agents", async () => {
    let call: unknown;
    const result = await readConversation(
      source,
      "nobody",
      async (options) => {
        call = options;
        return page([], { hasOlder: false, startCursor: null });
      },
      { before: { epoch: "e", seq: 5 }, limit: 10 },
    );
    expect(call).toEqual({
      direction: "before",
      cursor: { epoch: "e", seq: 5 },
      limit: 10,
    });
    expect(result).toMatchObject({
      status: "gone",
      title: null,
      taskId: null,
      hasOlder: false,
      cursor: null,
      log: [],
    });
  });
});
