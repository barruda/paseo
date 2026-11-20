// CUSTOM(assistant-reports): the report entry schema, its store, the merge of the history with the
// assistant's entries, the Reports views and the board_report tool.
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSchema, type Board, type Data } from "../shared/model";
import type { HistoryEvent } from "../shared/assistant";
import {
  reportEntryInputSchema,
  type AssistantReport,
} from "../shared/assistant-reports";
import {
  ATTACH_AFTER_MS,
  ATTACH_BEFORE_BOARD_MS,
  ATTACH_BEFORE_MS,
  ReportStore,
  buildReportColumns,
  buildReportTasks,
  buildReportTimeline,
  defaultReportsDirectory,
  mergeTimeline,
  orchestratorPart,
} from "../server/assistant/reports";
import { boardReportTool } from "../server/assistant/chat";
import type { ViewSource } from "../server/assistant/views";
import type { QuickMessage } from "../shared/quick";

const T0 = Date.parse("2026-06-10T12:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const event = (
  id: string,
  minutes: number,
  over: Partial<HistoryEvent> = {},
): HistoryEvent => ({
  id,
  at: at(minutes),
  kind: "task-started",
  taskId: "t1",
  taskTitle: "Task one",
  projectId: "p1",
  projectName: "Proj",
  orchestratorId: "o1",
  orchestratorName: "Orch",
  agentId: "a1",
  attempt: 1,
  action: null,
  reason: null,
  text: `event ${id}`,
  detail: null,
  by: null,
  ...over,
});

const entry = (
  id: string,
  minutes: number,
  over: Partial<AssistantReport> = {},
): AssistantReport => ({
  id,
  at: at(minutes),
  taskId: "t1",
  taskTitle: "Task one",
  projectId: "p1",
  projectName: "Proj",
  kind: "reviewed",
  summary: `entry ${id}`,
  detail: null,
  decisions: [],
  orchestrator: null,
  quickMessageId: null,
  ...over,
});

const reportBlock = (summary: string) =>
  `<report>${JSON.stringify({ status: "done", summary })}</report>`;

describe("reportEntryInputSchema", () => {
  const valid = {
    taskId: "t1",
    kind: "merged",
    summary: "Merged the fix into custom.",
  };

  it("accepts a full entry", () => {
    expect(
      reportEntryInputSchema.parse({
        ...valid,
        detail: "- checked the diff",
        decisions: ["merge now"],
        orchestrator: { agentId: "a1", prompt: "fix", reply: "done" },
        quickMessageId: "q-1",
        quickStatus: "ok",
        projectId: "p1",
      }),
    ).toMatchObject({ kind: "merged", decisions: ["merge now"] });
  });

  it("refuses invalid entries with a reason", () => {
    const issues = (value: unknown) => {
      const result = reportEntryInputSchema.safeParse(value);
      expect(result.success).toBe(false);
      return result.error!.issues.map((issue) => issue.message).join("; ");
    };
    expect(issues({ ...valid, summary: "one\ntwo" })).toContain("one line");
    expect(issues({ ...valid, summary: "   " })).toMatch(/too small|>=1/i);
    expect(issues({ ...valid, kind: "deployed" })).toMatch(/kind|option/i);
    expect(issues({ ...valid, decision: ["typo"] })).toMatch(/decision/);
    expect(issues({ ...valid, summary: "x".repeat(301) })).toMatch(
      /too big|<=300/i,
    );
    expect(issues({ kind: "note", summary: "no task" })).toMatch(/expected/i);
  });
});

describe("ReportStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "pwb-reports-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("computes the default directory next to the history", () => {
    expect(defaultReportsDirectory({ PASEO_HOME: "/x/home" })).toBe(
      "/x/home/plugin-data/power-workboard/reports",
    );
  });

  it("appends into day files, reads them back oldest first, and prunes old days", async () => {
    let now = new Date(2026, 5, 10, 9);
    const store = new ReportStore(path.join(dir, "reports"), {
      now: () => now,
      retentionDays: 5,
    });
    const base = {
      taskId: "t1",
      taskTitle: "Task",
      projectId: null,
      projectName: "",
      kind: "note" as const,
      detail: null,
      decisions: [],
      orchestrator: null,
      quickMessageId: null,
    };
    await store.append({
      ...base,
      summary: "old",
      at: new Date(2026, 5, 1, 9).toISOString(),
    });
    const second = await store.append({ ...base, summary: "now" });
    expect(second.id).toBeTruthy();
    expect(second.at).toBe(now.toISOString());
    expect((await store.since(null)).map((r) => r.summary)).toEqual([
      "old",
      "now",
    ]);
    expect(
      (await store.since(new Date(2026, 5, 5).toISOString())).map(
        (r) => r.summary,
      ),
    ).toEqual(["now"]);
    now = new Date(2026, 5, 10, 12);
    await store.prune();
    expect(await readdir(path.join(dir, "reports"))).toEqual([
      "2026-06-10.jsonl",
    ]);
  });

  it("reuses a parsed day file until it changes, and filters while reading", async () => {
    const now = new Date(2026, 5, 10, 9);
    const store = new ReportStore(path.join(dir, "reports"), {
      now: () => now,
    });
    const base = {
      projectId: null,
      projectName: "",
      kind: "note" as const,
      detail: null,
      decisions: [],
      orchestrator: null,
      quickMessageId: null,
    };
    await store.append({
      ...base,
      taskId: "t1",
      taskTitle: "One",
      summary: "aaa",
      at: new Date(2026, 5, 10, 9, 1).toISOString(),
    });
    await store.append({
      ...base,
      taskId: "t2",
      taskTitle: "Two",
      summary: "two",
      at: new Date(2026, 5, 10, 9, 2).toISOString(),
    });
    // A whole-millisecond mtime, so restoring it below gives back the exact same value.
    const file = path.join(dir, "reports", "2026-06-10.jsonl");
    const mtime = new Date(2026, 5, 10, 9, 30);
    await utimes(file, mtime, mtime);
    expect((await store.since(null)).map((r) => r.summary)).toEqual([
      "aaa",
      "two",
    ]);
    // Same size and mtime: the cached parse is served, the file is not read again.
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace('"aaa"', '"bbb"'),
    );
    await utimes(file, mtime, mtime);
    expect((await store.since(null)).map((r) => r.summary)).toEqual([
      "aaa",
      "two",
    ]);
    // An append changes the file: it is read again.
    await store.append({
      ...base,
      taskId: "t1",
      taskTitle: "One",
      summary: "three",
      at: new Date(2026, 5, 10, 9, 3).toISOString(),
    });
    expect(
      (await store.since(null, (r) => r.taskId === "t1")).map((r) => r.summary),
    ).toEqual(["bbb", "three"]);
  });
});

describe("orchestratorPart", () => {
  it("reads the agent's report out of its reply", () => {
    expect(
      orchestratorPart({
        agentId: "a1",
        prompt: "Fix the test",
        reply: `Fixed it.\n${reportBlock("All green")}`,
      }),
    ).toEqual({
      agentId: "a1",
      prompt: "Fix the test",
      reply: "Fixed it.",
      report: expect.objectContaining({ status: "done", summary: "All green" }),
    });
    expect(orchestratorPart({ agentId: "a1" })).toEqual({
      agentId: "a1",
      prompt: null,
      reply: null,
      report: null,
    });
  });
});

describe("mergeTimeline", () => {
  it("folds events into the entry they belong to and keeps the rest as automatic items", () => {
    const items = mergeTimeline(
      [
        // 30 min before the entry: too far, stands alone.
        event("started", -30, { kind: "task-started" }),
        // 5 min before: the report the entry reviewed.
        event("report", -5, { kind: "report", detail: "I fixed it" }),
        // 1 min after: the merge the entry started.
        event("merged", 1, { kind: "merged", agentId: null }),
        // 10 min after: unrelated, stands alone.
        event("moved", 10, { kind: "task-moved", agentId: null }),
      ],
      [entry("r1", 0, { kind: "merged", decisions: ["low risk"] })],
    );
    expect(items.map((item) => `${item.source}:${item.id}`)).toEqual([
      "auto:started",
      "assistant:r1",
      "auto:moved",
    ]);
    const assistant = items[1];
    expect(assistant).toMatchObject({
      source: "assistant",
      kind: "merged",
      decisions: ["low risk"],
    });
    if (assistant.source !== "assistant") throw new Error("unreachable");
    expect(assistant.events.map((e) => e.id)).toEqual(["report", "merged"]);
  });

  const owners = (items: ReturnType<typeof mergeTimeline>) =>
    Object.fromEntries(
      items.flatMap((item) =>
        item.source === "assistant"
          ? item.events.map((e) => [e.id, item.id])
          : [[item.id, "auto"]],
      ),
    );

  it("gives an event to the nearest entry, before or after it", () => {
    const items = mergeTimeline(
      [
        event("near-before", 1, { kind: "verify-passed" }),
        event("near-after", 4, { kind: "verify-passed" }),
      ],
      [entry("before", 0), entry("after", 5)],
    );
    expect(owners(items)).toEqual({
      "near-before": "before",
      "near-after": "after",
    });
  });

  it("gives a continue to the feedback entry rather than the review before it", () => {
    // reviewed at T, the continue at T+60 s, the feedback entry at T+90 s.
    const items = mergeTimeline(
      [event("continued", 1, { kind: "task-continued", detail: "Add a test" })],
      [
        entry("reviewed", 0, { kind: "reviewed" }),
        entry("feedback", 1.5, { kind: "feedback" }),
      ],
    );
    expect(owners(items)).toEqual({ continued: "feedback" });
    // The kind wins over the distance: the review is nearer, the feedback still owns it.
    const later = mergeTimeline(
      [event("continued", 0.5, { kind: "task-continued" })],
      [
        entry("reviewed", 0, { kind: "reviewed" }),
        entry("feedback", 2, { kind: "feedback" }),
      ],
    );
    expect(owners(later)).toEqual({ continued: "feedback" });
  });

  // CUSTOM(assistant-cards)
  it("uses by: the user's own actions stand alone, the assistant's join its entry", () => {
    const items = mergeTimeline(
      [
        // A second before the assistant's entry, but the user moved it.
        event("user-move", -0.02, {
          kind: "task-moved",
          agentId: null,
          by: "user",
        }),
        // Ten minutes before: too old for the legacy window, fine for the assistant's own.
        event("assistant-create", -10, {
          kind: "task-created",
          agentId: null,
          by: "assistant",
        }),
        event("user-continue", 0.5, {
          kind: "task-continued",
          by: "user",
        }),
        event("engine-report", -5, { kind: "report", by: "orchestrator" }),
      ],
      [entry("r1", 0, { kind: "created" })],
    );
    expect(owners(items)).toEqual({
      "user-move": "auto",
      "assistant-create": "r1",
      "user-continue": "auto",
      "engine-report": "r1",
    });
    const auto = items.find((i) => i.id === "user-move");
    expect(auto?.source === "auto" && auto.by).toBe("user");
  });

  it("keeps a ticket moved by hand minutes before an entry out of that entry (events without by)", () => {
    const window = ATTACH_BEFORE_BOARD_MS / 60_000;
    const items = mergeTimeline(
      [
        event("by-hand", -10, { kind: "task-moved", agentId: null }),
        event("created-by-hand", -window - 1, {
          kind: "task-created",
          agentId: null,
        }),
        event("by-assistant", -0.5, { kind: "task-moved", agentId: null }),
        // Other kinds keep the long window.
        event("report", -10, { kind: "report" }),
      ],
      [entry("r1", 0, { kind: "moved" })],
    );
    expect(owners(items)).toEqual({
      "by-hand": "auto",
      "created-by-hand": "auto",
      "by-assistant": "r1",
      report: "r1",
    });
  });

  it("uses the attach windows at their edges", () => {
    const before = ATTACH_BEFORE_MS / 60_000;
    const after = ATTACH_AFTER_MS / 60_000;
    const items = mergeTimeline(
      [
        event("edge-before", -before),
        event("past-before", -before - 1),
        event("edge-after", after),
        event("past-after", after + 1),
      ],
      [entry("r1", 0)],
    );
    expect(items.filter((i) => i.source === "auto").map((i) => i.id)).toEqual([
      "past-before",
      "past-after",
    ]);
  });

  it("gives automatic items the agent's side: the report with its parsed delivery report, the feedback as the prompt", () => {
    const items = mergeTimeline(
      [
        event("report", 0, { kind: "report", attempt: 2, detail: "Did it" }),
        event("continued", 30, {
          kind: "task-continued",
          detail: "Please add a test",
        }),
        event("told", 60, { kind: "told-assistant", agentId: "chat" }),
      ],
      [],
      {
        stage: "needs-you",
        action: "review",
        observe: false,
        attempt: 2,
        report: {
          status: "done",
          summary: "Did it",
          filesChanged: [],
          checks: [],
          risks: ["none"],
          question: null,
          progress: null,
          resumeAfter: null,
          waitingFor: null,
          options: [],
          recommend: null,
          why: null,
          outcomes: [],
          notDone: [],
        },
        reason: "review",
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        conflictFixes: 0,
        dirtyRetries: 0,
        startedAt: at(0),
        updatedAt: at(0),
      },
    );
    expect(items[0]).toMatchObject({
      source: "auto",
      detail: null,
      orchestrator: {
        agentId: "a1",
        reply: "Did it",
        report: { status: "done", risks: ["none"] },
      },
    });
    expect(items[1]).toMatchObject({
      detail: null,
      orchestrator: { agentId: "a1", prompt: "Please add a test", reply: null },
    });
    expect(items[2]).toMatchObject({ orchestrator: null });
  });

  it("keeps the agent's side of the events folded into an entry", () => {
    const items = mergeTimeline(
      [
        event("report", -5, { kind: "report", attempt: 1, detail: "Did it" }),
        event("verify", -4, {
          kind: "verify-failed",
          agentId: null,
          detail: "1 test failed",
        }),
        event("continued", 0.5, {
          kind: "task-continued",
          detail: "Please add a test",
        }),
      ],
      [entry("r1", 0, { kind: "feedback" })],
      {
        stage: "fixing",
        action: "review",
        observe: false,
        attempt: 1,
        report: {
          status: "done",
          summary: "Did it",
          filesChanged: [],
          checks: [],
          risks: [],
          question: null,
          progress: null,
          resumeAfter: null,
          waitingFor: null,
          options: [],
          recommend: null,
          why: null,
          outcomes: [],
          notDone: [],
        },
        reason: null,
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        conflictFixes: 0,
        dirtyRetries: 0,
        startedAt: at(-10),
        updatedAt: at(0),
      },
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    if (item.source !== "assistant") throw new Error("unreachable");
    expect(item.events).toEqual([
      expect.objectContaining({
        id: "report",
        text: "event report",
        detail: null,
        orchestrator: {
          agentId: "a1",
          prompt: null,
          reply: "Did it",
          report: expect.objectContaining({ status: "done" }),
        },
      }),
      expect.objectContaining({
        id: "verify",
        detail: "1 test failed",
        orchestrator: null,
      }),
      expect.objectContaining({
        id: "continued",
        detail: null,
        orchestrator: {
          agentId: "a1",
          prompt: "Please add a test",
          reply: null,
          report: null,
        },
      }),
    ]);
  });
});

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workspaceId: `w-${id}`,
  title: `Task ${id}`,
  description: "",
  projectId: "p1",
  projectName: "Proj",
  createdAt: at(-100),
  updatedAt: at(-100),
  draftStage: "backlog",
  lastStage: "review",
  lastConversationAt: null,
  conversationStatus: "none",
  issue: null,
  archived: null,
  binding: null,
  ...over,
});

const source = (tasks: Record<string, unknown>[]): ViewSource => ({
  data: dataSchema.parse({ tasks }) as Data,
  board: {
    settings: {
      groups: [
        { id: "ready", kind: "ready", name: "Ready to start", label: "r" },
        { id: "review", kind: "review", name: null, label: "pwb:review" },
      ],
      groupOrder: [],
    },
    cards: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      stage: t.id === "t1" ? "review" : "ready",
      projectId: t.projectId,
      projectName: t.projectName,
      archived: null,
    })),
    projects: [{ id: "p1", name: "Proj", directory: "/p", isGit: true }],
    orchestratorStatus: {},
  } as unknown as Board,
  agents: [],
  now: new Date(T0),
});

describe("Reports views", () => {
  it("lists every ticket with actions, newest action first", () => {
    const view = source([
      task("t1", { title: "Task one" }),
      task("t2", { title: "Task two" }),
    ]);
    const tasks = buildReportTasks(
      view,
      [
        event("e1", 0),
        event("e2", 5, { taskId: "t2" }),
        // A task that left the board keeps its last known title.
        event("e3", 1, {
          taskId: "gone",
          taskTitle: "Old task",
          projectId: "p-old",
          projectName: "Old",
        }),
      ],
      [entry("r1", 20, { summary: "Reviewed and merged." })],
    );
    expect(tasks).toEqual([
      {
        taskId: "t1",
        title: "Task one",
        projectId: "p1",
        projectName: "Proj",
        column: "pwb:review",
        columnId: "review",
        lastAt: at(20),
        lastSummary: "Reviewed and merged.",
        items: 2,
        assistantItems: 1,
      },
      expect.objectContaining({
        taskId: "t2",
        column: "Ready to start",
        columnId: "ready",
        assistantItems: 0,
      }),
      expect.objectContaining({
        taskId: "gone",
        title: "Old task",
        projectName: "Old",
        column: null,
        columnId: null,
      }),
    ]);
  });

  it("lists the board's columns in board order, with name, kind and color", () => {
    const view = source([task("t1")]);
    view.board.settings.groupOrder = ["review", "ready"];
    expect(buildReportColumns(view)).toEqual([
      { id: "review", name: "pwb:review", kind: "review", color: "orange" },
      { id: "ready", name: "Ready to start", kind: "ready", color: "violet" },
    ]);
  });

  it("builds one ticket's header and timeline, or null without records", () => {
    const view = source([
      task("t1", { title: "Task one", description: "Do the thing.\n\nMore." }),
    ]);
    const timeline = buildReportTimeline(
      view,
      "t1",
      [event("e1", 0), event("other", 0, { taskId: "t2" })],
      [entry("r1", 1)],
    );
    expect(timeline?.task).toEqual({
      taskId: "t1",
      title: "Task one",
      projectId: "p1",
      projectName: "Proj",
      column: "pwb:review",
      description: "Do the thing.\n\nMore.",
    });
    expect(timeline?.items.map((item) => item.id)).toEqual(["r1"]);
    expect(buildReportTimeline(view, "t2", [], [])).toBeNull();
  });
});

describe("board_report", () => {
  const quick = (over: Partial<QuickMessage> = {}): QuickMessage => ({
    id: "q-1",
    text: "merge it",
    source: "opendeck",
    sentAt: at(0),
    agentId: "chat",
    status: "pending",
    message: null,
    ackedAt: null,
    inferred: false,
    ...over,
  });

  function setup(messages: QuickMessage[] = []) {
    const view = source([task("t1", { title: "Task one" })]);
    view.data.orchestrations = {
      t1: { agentId: "a1" },
    } as unknown as Data["orchestrations"];
    const appended: unknown[] = [];
    const reports = {
      append: vi.fn(async (input: any) => {
        appended.push(input);
        return { ...input, id: "r1", at: at(0) } as AssistantReport;
      }),
    };
    const inbox = { list: () => messages, ack: vi.fn() };
    const lastReply = vi.fn(
      async () => `All done.\n${reportBlock("Fixed the bug")}`,
    );
    const noteAssistantReported = vi.fn(async () => {});
    const tool = boardReportTool(
      () => ({
        assistantSource: () => view,
        snapshot: () => view.board,
        chatLastReply: lastReply,
        noteAssistantReported,
      }),
      reports,
      inbox,
    );
    return { tool, appended, inbox, lastReply, noteAssistantReported };
  }

  it("records the entry with the task's project and the agent's last reply", async () => {
    const s = setup();
    const result = await s.tool.execute({
      taskId: "t1",
      kind: "reviewed",
      summary: "Reviewed the diff; it is good.",
      detail: "- tests pass",
      decisions: ["merge"],
      orchestrator: { agentId: "a1", prompt: "Add a test" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Reviewed the diff; it is good.");
    expect(s.lastReply).toHaveBeenCalledWith("a1");
    // CUSTOM(assistant-wake): a recorded action suppresses the 10-minute reminder.
    expect(s.noteAssistantReported).toHaveBeenCalledWith("t1");
    expect(s.appended[0]).toEqual({
      taskId: "t1",
      taskTitle: "Task one",
      projectId: "p1",
      projectName: "Proj",
      kind: "reviewed",
      summary: "Reviewed the diff; it is good.",
      detail: "- tests pass",
      decisions: ["merge"],
      orchestrator: {
        agentId: "a1",
        prompt: "Add a test",
        reply: "All done.",
        report: expect.objectContaining({ summary: "Fixed the bug" }),
      },
      quickMessageId: null,
    });
  });

  it("does not read the reply of an agent the board did not start", async () => {
    const s = setup();
    await s.tool.execute({
      taskId: "t1",
      kind: "note",
      summary: "Asked another agent.",
      orchestrator: { agentId: "stranger" },
    });
    expect(s.lastReply).not.toHaveBeenCalled();
    expect((s.appended[0] as AssistantReport).orchestrator).toEqual({
      agentId: "stranger",
      prompt: null,
      reply: null,
      report: null,
    });
  });

  it("updates the quick message's status row with the summary", async () => {
    const s = setup([quick()]);
    const result = await s.tool.execute({
      taskId: "t1",
      kind: "merged",
      summary: "Merged into custom.",
      quickMessageId: "q-1",
    });
    expect(s.inbox.ack).toHaveBeenCalledWith(
      "q-1",
      "ok",
      "Merged into custom.",
    );
    expect(result.text).toContain("Status row for q-1: ok.");

    const asked = setup([quick({ status: "needs-input", message: "?" })]);
    await asked.tool.execute({
      taskId: "t1",
      kind: "note",
      summary: "Still waiting for the user.",
      quickMessageId: "q-1",
    });
    expect(asked.inbox.ack).toHaveBeenCalledWith(
      "q-1",
      "needs-input",
      "Still waiting for the user.",
    );

    const gone = setup([]);
    const missing = await gone.tool.execute({
      taskId: "t1",
      kind: "note",
      summary: "Done.",
      quickMessageId: "q-9",
    });
    expect(missing.isError).toBeUndefined();
    expect(missing.text).toContain("q-9 is gone");
    expect(gone.appended).toHaveLength(1);
  });

  it("refuses an invalid entry or an unknown task with a clear error and stores nothing", async () => {
    const s = setup();
    const invalid = await s.tool.execute({
      taskId: "t1",
      kind: "reviewed",
      summary: "line one\nline two",
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain("summary");
    expect(invalid.text).toContain("one line");
    const unknown = await s.tool.execute({
      taskId: "nope",
      kind: "note",
      summary: "Hi.",
    });
    expect(unknown).toMatchObject({ isError: true });
    expect(unknown.text).toContain("No task with id nope");
    expect(s.appended).toEqual([]);
  });
});
