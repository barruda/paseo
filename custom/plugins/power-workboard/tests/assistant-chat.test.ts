import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { Workboard } from "../server/workboard";
import {
  CHAT_INSTRUCTIONS,
  CHAT_LABEL,
  attachChatTools,
  chatTools,
} from "../server/assistant/chat";
import { fixture } from "./fixtures";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: true,
};

async function chat() {
  const directory = path.join(
    mkdtempSync(path.join(os.tmpdir(), "pwb-chat-")),
    "chat",
  );
  const setup = fixture({ defaultOrchestratorSeeded: true });
  setup.inventory.projects.push(project);
  const board = new Workboard(setup.host, setup.store, setup.now, 60000, {
    chatDirectory: directory,
  });
  await board.start();
  const events: any[] = [];
  const history = {
    list: vi.fn(async () => ({
      events: [
        {
          at: "2026-09-23T00:00:00Z",
          kind: "merged",
          taskId: "t1",
          taskTitle: "Task",
          text: "Merged",
        },
      ],
      nextCursor: null,
    })),
  };
  const tools = chatTools(() => board, history as any);
  const run = (name: string, input: Record<string, unknown> = {}) =>
    tools.find((t) => t.name === name)!.execute(input);
  return { ...setup, board, directory, tools, run, history, events };
}
const create = async (c: Awaited<ReturnType<typeof chat>>, input = {}) => {
  const result = await c.run("board_create_task", {
    title: "Fix it",
    description: "Goal",
    projectId: "p",
    ...input,
  });
  expect(result.isError).toBeUndefined();
  expect(result).not.toHaveProperty("structuredContent");
  const match = /^Created (\S+) ".*" in .* \((\S+)\)/.exec(result.text ?? "");
  if (!match) throw new Error(`Unexpected create result: ${result.text}`);
  return { taskId: match[1], column: match[2] };
};

it("chat.open creates the chat agent once, reuses it, and recreates it when archived, gone or fresh", async () => {
  const c = await chat();
  try {
    const first = await c.board.openChat(false);
    expect(first.created).toBe(true);
    expect(existsSync(c.directory)).toBe(true);
    const [cwd, start] = (c.host.startAgentIn as any).mock.calls[0];
    expect(cwd).toBe(c.directory);
    expect(start).toMatchObject({
      provider: "claude/claude-opus-5-5",
      thinkingOptionId: "high",
      modeId: "bypassPermissions",
      title: "Projects Assistant",
      labels: { [CHAT_LABEL]: "true" },
      prompt: CHAT_INSTRUCTIONS,
    });
    expect(
      start.prompt.startsWith("Reply with one short line saying you're ready."), // CUSTOM(agent-profiles): the role is the system prompt now
    ).toBe(true);
    expect(c.store.current.assistant.chatAgentId).toBe(first.agentId);

    expect(await c.board.openChat(false)).toEqual({
      agentId: first.agentId,
      created: false,
    });
    expect(c.host.startAgentIn).toHaveBeenCalledTimes(1);

    c.inventory.agents.find((a) => a.id === first.agentId)!.archivedAt =
      "2026-09-23T00:00:00Z";
    const second = await c.board.openChat(false);
    expect(second.created).toBe(true);
    expect(second.agentId).not.toBe(first.agentId);

    const third = await c.board.openChat(true);
    expect(third.created).toBe(true);
    expect(c.store.current.assistant.chatAgentId).toBe(third.agentId);

    c.inventory.agents.length = 0; // gone
    expect((await c.board.openChat(false)).created).toBe(true);
    expect(c.host.startAgentIn).toHaveBeenCalledTimes(4);
  } finally {
    c.board.dispose();
  }
});

it("the session_open hook attaches the tools only to the chat agent's own sessions", async () => {
  const c = await chat();
  try {
    const base = {
      agentId: "a",
      purpose: "interactive",
      tools: [] as unknown[],
    };
    const labeled = { ...base, labels: { [CHAT_LABEL]: "true" } };
    const result = attachChatTools(labeled, c.tools)!;
    expect(result.tools.map((t: any) => t.name)).toEqual([
      "board_overview",
      "board_list_tasks",
      "board_get_task",
      "board_create_task",
      "board_update_task",
      "board_move_task",
      "board_task_action",
      "board_run_orchestrator",
      "board_history",
      "board_read_agent",
    ]);
    expect(attachChatTools({ ...base, labels: {} }, c.tools)).toBeUndefined();
    expect(
      attachChatTools({ ...base, labels: { [CHAT_LABEL]: "false" } }, c.tools),
    ).toBeUndefined();
    expect(
      attachChatTools({ ...labeled, purpose: "history" }, c.tools),
    ).toBeUndefined();
  } finally {
    c.board.dispose();
  }
});

it("create_task goes to the Backlog by default and to Ready to start with start: true", async () => {
  const c = await chat();
  try {
    const draft = await create(c);
    expect(draft.column).toBe("backlog");
    const started = await create(c, { title: "Now", start: true });
    expect(started.column).toBe("ready");
    const cards = c.board.snapshot().cards;
    expect(cards.find((x) => x.id === draft.taskId)).toMatchObject({
      title: "Fix it",
      description: "Goal",
      projectId: "p",
    });
    const list = await c.run("board_list_tasks", { column: "ready" });
    expect(list.text).toContain("Now");
    expect(list.text).not.toContain("Fix it");
    const overview = await c.run("board_overview");
    expect(overview.text).toContain("p | Project | git");
    expect(overview.text).toContain("backlog");
  } finally {
    c.board.dispose();
  }
});

it("update_task and move_task go through the board's own mutations", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    expect(
      (await c.run("board_update_task", { taskId, title: "Renamed" })).isError,
    ).toBeUndefined();
    expect(c.board.snapshot().cards[0]).toMatchObject({
      title: "Renamed",
      description: "Goal",
    });
    expect(
      (await c.run("board_move_task", { taskId, column: "ready" })).text,
    ).toContain("Moved");
    expect(c.board.snapshot().cards[0].stage).toBe("ready");
    // The board refuses a task without a workspace in In progress; the tool says so as text.
    const refused = await c.run("board_move_task", {
      taskId,
      column: "in-progress",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^Error: /);
    expect(
      (await c.run("board_move_task", { taskId, column: "nowhere" })).text,
    ).toContain("No column");
    const detail = await c.run("board_get_task", { taskId });
    expect(detail.text).toContain("Renamed");
    expect(detail.text).toContain("Delivery: none");
  } finally {
    c.board.dispose();
  }
});

it("task_action reuses the assistant actions; run_orchestrator and history work", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    const none = await c.run("board_task_action", { taskId, type: "dismiss" });
    expect(none.isError).toBe(true);
    await c.store.update((data) => {
      data.assistant.deliveries[taskId] = {
        stage: "needs-you",
        action: "notify",
        observe: false,
        attempt: 1,
        report: null,
        reason: "notify",
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        startedAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
      };
    });
    expect(
      (await c.run("board_task_action", { taskId, type: "dismiss" })).text,
    ).toContain("dismiss");
    expect(c.store.current.assistant.deliveries[taskId].stage).toBe(
      "dismissed",
    );
    expect(
      (await c.run("board_task_action", { taskId, type: "merge-now" })).isError,
    ).toBe(true);
    expect(
      (await c.run("board_run_orchestrator", { orchestratorId: "missing" }))
        .isError,
    ).toBe(true);
    const events = await c.run("board_history", { limit: 5, taskId: "t1" });
    expect(events.text).toContain("merged | Task (t1) | Merged");
    expect(c.history.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, taskId: "t1" }),
    );
  } finally {
    c.board.dispose();
  }
});

it("read_agent refuses agents the board did not start", async () => {
  const c = await chat();
  try {
    const refused = await c.run("board_read_agent", { agentId: "stranger" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("not managed");
    await c.store.update((data) => {
      data.assistant.attempts.t = [
        {
          index: 1,
          agentId: "mine",
          orchestratorId: null,
          startedAt: "2026-09-23T00:00:00Z",
          finishedAt: null,
          outcome: "running",
          trigger: "start",
          feedback: null,
          retries: 0,
        },
      ];
    });
    const allowed = await c.run("board_read_agent", { agentId: "mine" });
    expect(allowed.text ?? "").not.toContain("not managed");
  } finally {
    c.board.dispose();
  }
});

it("no board tool returns structuredContent and board_overview text carries everything", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    await c.store.update((data) => {
      data.assistant.deliveries[taskId] = {
        stage: "needs-you",
        action: "notify",
        observe: false,
        attempt: 2,
        report: null,
        reason: "notify",
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        startedAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
      };
    });
    for (const [name, input] of [
      ["board_overview", {}],
      ["board_list_tasks", {}],
      ["board_get_task", { taskId }],
      ["board_history", {}],
    ] as const) {
      expect(await c.run(name, input)).not.toHaveProperty("structuredContent");
    }
    const overview = (await c.run("board_overview")).text!;
    expect(overview).toContain("Projects:");
    expect(overview).toContain("Orchestrators:");
    expect(overview).toContain("Columns:");
    expect(overview).toContain("Assistant:");
    expect(overview).toMatch(
      new RegExp(`${taskId} \\| Fix it \\|.*attempt: 2.*since: .*can merge: `),
    );
    expect(overview).toContain("agent: ");
  } finally {
    c.board.dispose();
  }
});

it("project and orchestrator references resolve by id or name; unknown ones list the choices", async () => {
  const c = await chat();
  try {
    const byName = await create(c, { projectId: "project" });
    const byDirectory = await create(c, { projectId: "FIXTURE" });
    const cards = () => c.board.snapshot().cards;
    expect(cards().find((x) => x.id === byName.taskId)?.projectId).toBe("p");
    expect(cards().find((x) => x.id === byDirectory.taskId)?.projectId).toBe(
      "p",
    );

    const bad = await c.run("board_create_task", {
      title: "Lost",
      projectId: "nope",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("p (Project)");
    expect(cards().some((x) => x.title === "Lost")).toBe(false);

    await c.board.mutate({
      action: "orchestrator-save",
      orchestrator: { name: "Night Shift", enabled: false },
    } as any);
    const orchestrator = c.board.snapshot().orchestrators[0];
    expect(orchestrator.name).toBe("Night Shift");
    const badOrchestrator = await c.run("board_create_task", {
      title: "Lost",
      orchestratorId: "nope",
    });
    expect(badOrchestrator.isError).toBe(true);
    expect(badOrchestrator.text).toContain(
      `${orchestrator.id} (${orchestrator.name})`,
    );
    const named = await c.run("board_create_task", {
      title: "Named",
      orchestratorId: orchestrator.name.toUpperCase(),
    });
    expect(named.isError).toBeUndefined();

    const { taskId } = await create(c, { projectId: undefined });
    expect(
      (await c.run("board_update_task", { taskId, projectId: "Project" }))
        .isError,
    ).toBeUndefined();
    expect(cards().find((x) => x.id === taskId)?.projectId).toBe("p");
    const refused = await c.run("board_update_task", {
      taskId,
      projectId: "power-workspace",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("p (Project)");
    expect(cards().find((x) => x.id === taskId)?.projectId).toBe("p");
    await c.run("board_update_task", { taskId, projectId: null });
    expect(cards().find((x) => x.id === taskId)?.projectId).toBeNull();

    const list = await c.run("board_list_tasks", { projectId: "project" });
    expect(list.text).toContain(byName.taskId);
    expect(
      (await c.run("board_list_tasks", { projectId: "nope" })).isError,
    ).toBe(true);
  } finally {
    c.board.dispose();
  }
});
