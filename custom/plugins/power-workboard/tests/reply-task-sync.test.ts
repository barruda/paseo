// CUSTOM(pm-chat-task-sync): a chat reply's `seu` line follows the board tasks it cites: amber
// while one waits in Needs you, neutral or green once none does.
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { assistantTaskStatesRpc } from "../shared/assistant-rpc";
import type { Delivery } from "../shared/assistant";
import { splitReply } from "../shared/reply-protocol";
import {
  citeTaskIds,
  citedTaskKey,
} from "../client/assistant/task-states-query";
import {
  buildReplyTaskStates,
  findTaskByRef,
  replyTaskLabel,
  replyTaskPhase,
  replyTaskView,
  type ReplyTaskState,
} from "../shared/reply-task-sync";

const ID_A = "10b1b0d7-1111-4222-8333-444455556666";
const ID_B = "2c3d4e5f-aaaa-4bbb-8ccc-dddddddddddd";
const ID_C = "3f00aa11-0000-4000-8000-000000000000";

const rawTask = (id: string, number: number, over = {}) => ({
  id,
  number,
  workspaceId: null,
  title: `Task ${number}`,
  description: "",
  projectId: "p",
  projectName: "Project",
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
  draftStage: "review",
  lastStage: "review",
  lastConversationAt: null,
  conversationStatus: "none",
  issue: null,
  archived: null,
  binding: null,
  ...over,
});

const delivery = (stage: Delivery["stage"], updatedAt: string): Delivery => ({
  stage,
  action: "notify",
  observe: false,
  attempt: 1,
  report: null,
  reason: stage === "needs-you" ? "notify" : null,
  detail: null,
  verifyOutput: null,
  fixesUsed: 0,
  conflictFixes: 0,
  dirtyRetries: 0,
  startedAt: "2026-11-20T10:00:00.000Z",
  updatedAt,
});

const state = (over: Partial<ReplyTaskState> = {}): ReplyTaskState => ({
  ref: "10b1b0d7",
  id: ID_A,
  number: 138,
  columnId: "review",
  column: "Ready to review",
  phase: "needs-you",
  needsYou: true,
  changedAt: "2026-11-20T11:00:00.000Z",
  ...over,
});

const yoursIds = (body: string) =>
  splitReply("```pwb\n" + body + "\n```")!.reply.yours!.taskIds;

describe("replyTaskPhase", () => {
  it("waits for the user only while the delivery is in Needs you", () => {
    expect(
      replyTaskPhase({
        archived: false,
        kind: "review",
        delivery: { stage: "needs-you" },
        run: { status: "finished" },
      }),
    ).toBe("needs-you");
    expect(
      replyTaskPhase({
        archived: false,
        kind: "review",
        delivery: { stage: "dismissed" },
        run: { status: "finished" },
      }),
    ).toBe("other");
    expect(
      replyTaskPhase({
        archived: false,
        kind: "review",
        delivery: undefined,
        run: undefined,
      }),
    ).toBe("other");
  });

  it("Done, Canceled and archived win over a stale Needs you", () => {
    const stale = { stage: "needs-you" } as const;
    expect(
      replyTaskPhase({
        archived: false,
        kind: "done",
        delivery: stale,
        run: undefined,
      }),
    ).toBe("done");
    expect(
      replyTaskPhase({
        archived: false,
        kind: "canceled",
        delivery: stale,
        run: undefined,
      }),
    ).toBe("canceled");
    expect(
      replyTaskPhase({
        archived: true,
        kind: "review",
        delivery: stale,
        run: undefined,
      }),
    ).toBe("archived");
  });

  it("a task back with its agent, or in delivery, is running", () => {
    for (const status of ["starting", "running", "queued", "waiting"] as const)
      expect(
        replyTaskPhase({
          archived: false,
          kind: "in-progress",
          delivery: { stage: "needs-you" },
          run: { status },
        }),
      ).toBe("running");
    expect(
      replyTaskPhase({
        archived: false,
        kind: "review",
        delivery: { stage: "merging" },
        run: { status: "finished" },
      }),
    ).toBe("running");
  });
});

describe("findTaskByRef", () => {
  const tasks = [{ id: ID_A }, { id: ID_B }];
  it("finds a task by its whole id or its first 8 characters", () => {
    expect(findTaskByRef(tasks, ID_B.toUpperCase())?.id).toBe(ID_B);
    expect(findTaskByRef(tasks, "10b1b0d7")?.id).toBe(ID_A);
    expect(findTaskByRef(tasks, "ffffffff")).toBeUndefined();
  });
});

describe("replyTaskView", () => {
  it("draws as before with no ids, before the answer, or when no cited task exists", () => {
    expect(replyTaskView([], [state()])).toEqual({ state: "none" });
    expect(replyTaskView(["10b1b0d7"], undefined)).toEqual({ state: "none" });
    expect(replyTaskView(["ffffffff"], [state()])).toEqual({ state: "none" });
  });

  it("stays pending while a cited task is in Needs you", () => {
    const view = replyTaskView(
      ["10b1b0d7", "2c3d4e5f"],
      [
        state(),
        state({ ref: "2c3d4e5f", id: ID_B, phase: "done", needsYou: false }),
      ],
    );
    expect(view.state).toBe("pending");
  });

  it("turns green once every cited task is Done", () => {
    expect(
      replyTaskView(
        ["10b1b0d7"],
        [
          state({
            phase: "done",
            needsYou: false,
            columnId: "done",
            column: "Done",
          }),
        ],
      ),
    ).toEqual({
      state: "settled",
      tone: "success",
      tasks: [expect.objectContaining({ phase: "done" })],
      at: "2026-11-20T11:00:00.000Z",
    });
  });

  it("turns neutral once none waits but not all are Done, with the newest change", () => {
    const view = replyTaskView(
      ["10b1b0d7", "2c3d4e5f", "ffffffff"],
      [
        state({ phase: "done", needsYou: false }),
        state({
          ref: "2c3d4e5f",
          id: ID_B,
          number: 140,
          phase: "running",
          needsYou: false,
          changedAt: "2026-11-20T12:30:00.000Z",
        }),
      ],
    );
    expect(view).toMatchObject({
      state: "settled",
      tone: "muted",
      at: "2026-11-20T12:30:00.000Z",
    });
    expect(view.state === "settled" && view.tasks.length).toBe(2);
  });

  it("reads the ids the protocol parses off the seu line", () => {
    expect(yoursIds("seu: testar #138 [10B1B0D7]")).toEqual(["10b1b0d7"]);
    expect(
      replyTaskView(yoursIds("seu: testar #138 [10B1B0D7]"), [state()]).state,
    ).toBe("pending");
  });
});

describe("replyTaskLabel", () => {
  const labels = { taskRunning: "em andamento", archived: "arquivado" };
  it("names the column, or the running and archived states", () => {
    expect(
      replyTaskLabel(
        state({ phase: "done", needsYou: false, column: "Done" }),
        labels,
      ),
    ).toBe("#138 Done");
    expect(
      replyTaskLabel(state({ phase: "running", needsYou: false }), labels),
    ).toBe("#138 em andamento");
    expect(
      replyTaskLabel(
        state({ phase: "archived", needsYou: false, number: 0 }),
        labels,
      ),
    ).toBe("10b1b0d7 arquivado");
  });
});

describe("workboard.assistant.tasks.state", () => {
  it("validates its input: task refs only, bounded", () => {
    const input = assistantTaskStatesRpc.input;
    expect(input.safeParse({ ids: ["10b1b0d7", ID_A] }).success).toBe(true);
    expect(input.safeParse({ ids: ["pm-abc12345"] }).success).toBe(false);
    expect(
      input.safeParse({ ids: Array.from({ length: 201 }, () => "10b1b0d7") })
        .success,
    ).toBe(false);
  });

  it("answers each cited task's column, Needs you and last change from the board", async () => {
    const setup = fixture({
      tasks: [
        rawTask(ID_A, 138),
        rawTask(ID_B, 140, { draftStage: "done" }),
        rawTask(ID_C, 141, { draftStage: "in-progress" }),
      ],
    } as never);
    await setup.store.load();
    try {
      await setup.store.update((data) => {
        data.assistant.deliveries[ID_A] = delivery(
          "needs-you",
          "2026-11-20T11:00:00.000Z",
        );
        data.assistant.deliveries[ID_B] = delivery(
          "needs-you",
          "2026-11-20T09:00:00.000Z",
        );
        data.orchestrations[ID_C] = {
          status: "running",
          workspaceId: null,
          agentId: "agent-c",
          startedAt: "2026-11-20T12:00:00.000Z",
        } as never;
      });
      const answer = assistantTaskStatesRpc.output.parse({
        tasks: setup.board.replyTaskStates([
          "10b1b0d7",
          ID_B,
          "3f00aa11",
          "ffffffff",
        ]),
      });
      expect(answer.tasks).toEqual([
        {
          ref: "10b1b0d7",
          id: ID_A,
          number: 138,
          columnId: "review",
          column: "Ready to review",
          phase: "needs-you",
          needsYou: true,
          changedAt: "2026-11-20T11:00:00.000Z",
        },
        {
          ref: ID_B,
          id: ID_B,
          number: 140,
          columnId: "done",
          column: "Done",
          phase: "done",
          needsYou: false,
          changedAt: "2026-11-20T10:00:00.000Z",
        },
        {
          ref: "3f00aa11",
          id: ID_C,
          number: 141,
          columnId: "in-progress",
          column: "In progress",
          phase: "running",
          needsYou: false,
          changedAt: "2026-11-20T12:00:00.000Z",
        },
      ]);

      // The user dismisses #138 from Needs you: the seu leaves amber.
      await setup.store.update((data) => {
        data.assistant.deliveries[ID_A].stage = "dismissed";
      });
      const [after] = setup.board.replyTaskStates(["10b1b0d7"]);
      expect(after).toMatchObject({ phase: "other", needsYou: false });
      expect(replyTaskView(["10b1b0d7"], [after])).toMatchObject({
        state: "settled",
        tone: "muted",
      });
    } finally {
      setup.board.dispose();
    }
  });

  it("builds the states without a board, from the stage the caller resolves", () => {
    const states = buildReplyTaskStates(["10B1B0D7", "10b1b0d7"], {
      tasks: [rawTask(ID_A, 138) as never],
      deliveries: {},
      orchestrations: {},
      groups: [
        { id: "review", kind: "review", name: null, label: "pwb:review" },
      ],
      stageOf: () => "review",
    });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      ref: "10b1b0d7",
      column: "pwb:review",
      phase: "other",
    });
  });
});

describe("the chat's shared task query", () => {
  it("asks once per host for the union of the ids the replies on screen cite", () => {
    const first = citeTaskIds("host-1", ["2c3d4e5f", "10b1b0d7"]);
    const second = citeTaskIds("host-1", ["10b1b0d7"]);
    const other = citeTaskIds("host-2", ["3f00aa11"]);
    expect(citedTaskKey("host-1")).toBe("10b1b0d7,2c3d4e5f");
    expect(citedTaskKey("host-2")).toBe("3f00aa11");
    first();
    expect(citedTaskKey("host-1")).toBe("10b1b0d7");
    second();
    other();
    expect(citedTaskKey("host-1")).toBe("");
    expect(citedTaskKey("host-2")).toBe("");
  });
});
