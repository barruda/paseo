import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { agentEvidence } from "./fixtures";
import { refinementChatTitle, Workboard } from "../server/workboard";
import {
  BOARD_AGENT_LABEL, // CUSTOM(hidden-board-agents)
  DEFAULT_GROUPS,
  dataSchema,
  newTask,
  orchestratorConfigSchema,
  settingsSchema,
} from "../shared/model";
import { fixture, workspace } from "./fixtures";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: false,
};

/** No default orchestrator: each test adds the ones it needs. */
function orchestrated() {
  const setup = fixture({ defaultOrchestratorSeeded: true });
  setup.inventory.projects.push(project);
  let now = Date.parse("2026-09-23T00:00:00Z");
  const board = new Workboard(setup.host, setup.store, () => now);
  return { ...setup, board, advance: (ms: number) => (now += ms) };
}
const stageOf = (board: Workboard, title: string) =>
  board.snapshot().cards.find((card) => card.title === title)?.stage;
const byTitle = (board: Workboard, title: string) =>
  board.snapshot().cards.find((card) => card.title === title)!;
/** An orchestrator whose window never closes, so it takes tasks as soon as they are ready. */
async function addOrchestrator(
  board: Workboard,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const before = new Set(board.snapshot().orchestrators.map((o) => o.id));
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Always",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
      ...overrides,
    }),
  });
  return board.snapshot().orchestrators.find((o) => !before.has(o.id))!.id;
}
async function setEnabled(board: Workboard, id: string, enabled: boolean) {
  const config = board.snapshot().orchestrators.find((o) => o.id === id)!;
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: { ...config, enabled },
  });
}
const logText = (board: Workboard, id: string) =>
  (board.snapshot().orchestratorLogs[id] ?? []).map((entry) => entry.text);
const toReady = (board: Workboard, title: string) =>
  board.mutate({
    action: "stage",
    taskId: byTitle(board, title).id,
    stage: "ready",
    expectedLabels: [],
  });

it("starts with Backlog, Scheduled, Ready to start, In progress, Ready to review and Done on its own labels", () => {
  expect(
    DEFAULT_GROUPS.map(({ id, name, label }) => [id, name, label]),
  ).toEqual([
    ["backlog", "Backlog", "pwb:backlog"],
    ["scheduled", "Scheduled", "pwb:scheduled"],
    ["ready", "Ready to start", "pwb:ready"],
    ["in-progress", "In progress", "pwb:in-progress"],
    ["review", "Ready to review", "pwb:review"],
    ["done", "Done", "pwb:done"],
  ]);
});

it("never imports workspaces it did not register", async () => {
  const { board, inventory, host } = fixture();
  inventory.workspaces.push(
    workspace("native", "Native workspace"),
    workspace("labeled", "Labeled", ["pwb:in-progress"]),
  );
  await board.start();
  try {
    expect(board.snapshot().cards).toEqual([]);
    await board.refresh();
    expect(board.snapshot().cards).toEqual([]);
    expect(host.setLabel).not.toHaveBeenCalled();
  } finally {
    board.dispose();
  }
});

it("tracks a workspace once a task starts work on it", async () => {
  const { board, inventory } = fixture();
  inventory.workspaces.push(workspace("other", "Other"));
  await board.start();
  try {
    const view = await board.mutate({
      action: "create",
      title: "Task",
      description: "",
      projectId: null,
    });
    const task = view.cards[0];
    expect(task.stage).toBe("backlog");
    const started = await board.mutate({
      action: "start",
      taskId: task.id,
      target: { kind: "new", source: { kind: "directory", path: "/fixture" } },
    });
    expect(started.cards).toHaveLength(1);
    expect(started.cards[0]).toMatchObject({
      workspaceId: "w1",
      stage: "in-progress",
    });
    expect(inventory.workspaces.find((w) => w.id === "w1")!.labels).toEqual([
      "pwb:in-progress",
    ]);
  } finally {
    board.dispose();
  }
});

it("adds Scheduled and Ready to start after Backlog to a board saved before they existed", async () => {
  const groups = DEFAULT_GROUPS.filter(
    (group) => group.kind !== "ready" && group.kind !== "scheduled",
  );
  const { board } = fixture({
    settings: settingsSchema.parse({ groups }),
  });
  await board.start();
  try {
    const settings = board.snapshot().settings;
    expect(settings.groups.map((group) => group.id)).toContain("ready");
    expect(settings.groupOrder).toEqual([
      "backlog",
      "scheduled",
      "ready",
      "in-progress",
      "review",
      "done",
    ]);
  } finally {
    board.dispose();
  }
});

it("orchestrates Ready to start tasks up to the limit and moves finished ones to review", async () => {
  const { board, inventory, host, advance } = orchestrated();
  await board.start();
  try {
    for (const title of ["Backlog only", "Last", "Second", "Top"]) {
      advance(1000);
      await board.mutate({
        action: "create",
        title,
        description: `Do ${title}`,
        projectId: "p",
      });
    }
    // The last card moved lands on top, and the orchestrator takes the column top first.
    for (const title of ["Last", "Second", "Top"]) {
      advance(1000);
      await toReady(board, title);
    }
    await addOrchestrator(board, { maxConcurrent: 2 });
    expect(host.startAgent).toHaveBeenCalledTimes(2);
    const prompt = (host.startAgent as any).mock.calls[0][1].prompt as string;
    expect(prompt).toContain("# Top\n\nDo Top");
    // CUSTOM(hidden-board-agents): every orchestrator agent is a hidden, silent board agent.
    for (const [, start] of (host.startAgent as any).mock.calls)
      expect(start.labels).toEqual({ [BOARD_AGENT_LABEL]: "true" });
    expect(stageOf(board, "Last")).toBe("ready");
    const inProgress = board
      .snapshot()
      .cards.filter((card) => card.stage === "in-progress");
    expect(inProgress).toHaveLength(2);

    // The first agent finishes its turn.
    const finished = inProgress[0];
    const agent = inventory.agents.find(
      (a) => a.workspaceId === finished.workspaceId,
    )!;
    await board.refresh();
    agent.activity = "attention";
    advance(1000);
    await board.refresh();
    advance(20_000);
    await board.refresh();
    expect(stageOf(board, finished.title)).toBe("review");
    expect(board.snapshot().orchestrations[finished.id].status).toBe(
      "finished",
    );
    // Its slot goes to the next Ready to start task; Backlog is never taken.
    expect(host.startAgent).toHaveBeenCalledTimes(3);
    expect(stageOf(board, "Last")).toBe("in-progress");
    expect(stageOf(board, "Backlog only")).toBe("backlog");
  } finally {
    board.dispose();
  }
});

// CUSTOM(restart-resume): one running task whose board can be replaced by a "restarted" one.
async function startedTask() {
  const setup = fixture({ defaultOrchestratorSeeded: true });
  setup.inventory.projects.push(project);
  let now = Date.parse("2026-09-23T00:00:00Z");
  const board = new Workboard(setup.host, setup.store, () => now);
  await board.start();
  await board.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  await toReady(board, "Task");
  await addOrchestrator(board);
  const task = byTitle(board, "Task");
  const agent = setup.inventory.agents.find(
    (a) => a.workspaceId === task.workspaceId,
  )!;
  await board.refresh();
  return {
    host: setup.host,
    store: setup.store,
    board,
    task,
    agent,
    setNow: (ms: number) => {
      now = ms;
    },
    now: () => now,
  };
}

/** Replace the board as a daemon restart does: the agent is idle, last active before the boot. */
async function restarted(
  task: Awaited<ReturnType<typeof startedTask>>,
  daemonStart: string | null,
  at: number,
  options: { restartStateFile?: string } = {},
) {
  task.board.dispose();
  task.agent.activity = "idle";
  task.agent.updatedAt = daemonStart
    ? new Date(Date.parse(daemonStart) - 60_000).toISOString()
    : "2026-09-22T23:00:00Z";
  task.agent.lastUserMessageAt = daemonStart
    ? new Date(Date.parse(daemonStart) - 3_600_000).toISOString()
    : "2026-09-22T22:00:00Z";
  task.host.identity.startedAt = daemonStart;
  task.setNow(at);
  const board = new Workboard(task.host, task.store, task.now, 60000, options);
  await board.start();
  return board;
}

it("a task cut by a daemon restart gets a continue instead of a no-report finish", async () => {
  const task = await startedTask();
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).toHaveBeenCalledWith(
      task.agent.id,
      expect.stringContaining("Continue from where you stopped"),
    );
    expect(
      task.store.current.assistant.deliveries[task.task.id],
    ).toBeUndefined();
    expect(board.snapshot().orchestrations[task.task.id].status).toBe(
      "running",
    );
    expect(stageOf(board, "Task")).toBe("in-progress");
  } finally {
    board.dispose();
  }
});

it("a restart resume is sent once, then the turn gets its grace", async () => {
  const task = await startedTask();
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).toHaveBeenCalledTimes(1);
    // The inventory still shows the old activity: the grace stops a second continue.
    task.agent.activity = "idle";
    task.setNow(Date.parse("2026-09-23T00:06:00Z"));
    await board.refresh();
    expect(task.host.sendAgent).toHaveBeenCalledTimes(1);
    expect(
      task.store.current.assistant.deliveries[task.task.id],
    ).toBeUndefined();
  } finally {
    board.dispose();
  }
});

it("a resume that never starts a turn settles as no-report after the grace", async () => {
  const task = await startedTask();
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    task.agent.activity = "idle";
    task.setNow(Date.parse("2026-09-23T00:07:00Z")); // past the 90 s grace
    await board.refresh();
    task.setNow(Date.parse("2026-09-23T00:07:30Z")); // past the idle settle
    await board.refresh();
    expect(task.store.current.assistant.deliveries[task.task.id]).toMatchObject(
      {
        reason: "no-report",
      },
    );
  } finally {
    board.dispose();
  }
});

it("a task whose agent ran after the daemon start is not resumed", async () => {
  const task = await startedTask();
  task.board.dispose();
  task.host.identity.startedAt = "2026-09-23T00:05:00Z";
  task.agent.activity = "idle";
  task.agent.updatedAt = "2026-09-23T00:05:30Z";
  task.setNow(Date.parse("2026-09-23T00:05:40Z"));
  const board = new Workboard(task.host, task.store, task.now);
  await board.start();
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    task.setNow(Date.parse("2026-09-23T00:06:10Z"));
    await board.refresh();
    expect(task.store.current.assistant.deliveries[task.task.id]).toMatchObject(
      {
        reason: "no-report",
      },
    );
  } finally {
    board.dispose();
  }
});

it("a worker that ran the restart is not resumed by the board", async () => {
  const task = await startedTask();
  const dir = mkdtempSync(join(tmpdir(), "pwb-restart-skip-"));
  const file = join(dir, "skip.json");
  writeFileSync(
    file,
    JSON.stringify({
      at: "2026-09-23T00:05:00Z",
      agents: [task.agent.id],
    }),
  );
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
    { restartStateFile: file },
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    task.setNow(Date.parse("2026-09-23T00:06:00Z"));
    await board.refresh();
    expect(task.store.current.assistant.deliveries[task.task.id]).toMatchObject(
      { reason: "no-report" },
    );
  } finally {
    board.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("without a daemon start the interrupted rule is off", async () => {
  const task = await startedTask();
  const board = await restarted(task, null, Date.parse("2026-09-23T00:05:10Z"));
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    task.setNow(Date.parse("2026-09-23T00:06:00Z"));
    await board.refresh();
    expect(task.store.current.assistant.deliveries[task.task.id]).toMatchObject(
      { reason: "no-report" },
    );
  } finally {
    board.dispose();
  }
});

it("a task already settling before the restart is not resumed", async () => {
  const task = await startedTask();
  await task.store.update((data) => {
    data.orchestrations[task.task.id]!.idleSince = "2026-09-23T00:04:00Z";
  });
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    expect(task.store.current.assistant.deliveries[task.task.id]).toMatchObject(
      { reason: "no-report" },
    );
  } finally {
    board.dispose();
  }
});

it("a task never seen running is not resumed", async () => {
  const task = await startedTask();
  await task.store.update((data) => {
    const record = data.orchestrations[task.task.id]!;
    record.sawRunning = false;
    record.startedAt = "2026-09-23T00:05:05Z";
    record.idleSince = null;
  });
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    task.setNow(Date.parse("2026-09-23T00:05:30Z"));
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
  } finally {
    board.dispose();
  }
});

it("a task the restart script already messaged is not messaged again", async () => {
  const task = await startedTask();
  task.board.dispose();
  task.host.identity.startedAt = "2026-09-23T00:05:00Z";
  task.agent.activity = "idle";
  task.agent.updatedAt = "2026-09-23T00:04:00Z";
  task.agent.lastUserMessageAt = "2026-09-23T00:05:30Z";
  task.setNow(Date.parse("2026-09-23T00:05:40Z"));
  const board = new Workboard(task.host, task.store, task.now);
  await board.start();
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
    task.setNow(Date.parse("2026-09-23T00:06:10Z"));
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
  } finally {
    board.dispose();
  }
});

it("a permission wait is not resumed by the restart rule", async () => {
  const task = await startedTask();
  task.agent.waitingPermission = true;
  const board = await restarted(
    task,
    "2026-09-23T00:05:00Z",
    Date.parse("2026-09-23T00:05:10Z"),
  );
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalled();
  } finally {
    board.dispose();
  }
});

it("an agent in error is not sent the restart message", async () => {
  const task = await startedTask();
  task.board.dispose();
  task.host.identity.startedAt = "2026-09-23T00:05:00Z";
  task.agent.activity = "error";
  task.agent.lastError = "boom";
  task.agent.updatedAt = "2026-09-23T00:04:00Z";
  task.agent.lastUserMessageAt = "2026-09-23T00:03:00Z";
  task.setNow(Date.parse("2026-09-23T00:05:10Z"));
  const board = new Workboard(task.host, task.store, task.now);
  await board.start();
  try {
    await board.refresh();
    expect(task.host.sendAgent).not.toHaveBeenCalledWith(
      task.agent.id,
      expect.stringContaining("restart was intentional"),
    );
  } finally {
    board.dispose();
  }
});

it("disabling stops new starts and a task without a project waits for an edit", async () => {
  const { board, host } = orchestrated();
  await board.start();
  try {
    const view = await board.mutate({
      action: "create",
      title: "Loose",
      description: "",
      projectId: null,
    });
    await toReady(board, "Loose");
    const id = await addOrchestrator(board);
    const task = view.cards[0];
    expect(board.snapshot().orchestrations[task.id]).toMatchObject({
      status: "failed",
      error: "Choose a project for this task",
    });
    expect(host.startAgent).not.toHaveBeenCalled();

    await setEnabled(board, id, false);
    const edited = board.snapshot().cards[0];
    await board.mutate({
      action: "edit",
      taskId: task.id,
      updatedAt: edited.updatedAt,
      title: "Loose",
      description: "",
      projectId: "p",
    });
    await board.refresh();
    expect(host.startAgent).not.toHaveBeenCalled();

    await setEnabled(board, id, true);
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(stageOf(board, "Loose")).toBe("in-progress");
  } finally {
    board.dispose();
  }
});

it("refines a draft in a chat and /write-ticket replaces its title and description", async () => {
  const { board, host, inventory } = orchestrated();
  await board.start();
  try {
    await board.mutate({
      action: "create",
      title: "rough idea",
      description: "make it faster",
      projectId: "p",
    });
    const task = byTitle(board, "rough idea");
    const view = await board.mutate({ action: "refine", taskId: task.id });
    const refinement = view.refinements[task.id];
    expect(refinement.status).toBe("chatting");
    expect(host.startAgentIn).toHaveBeenCalledWith(
      "/fixture",
      expect.objectContaining({
        modeId: "default",
        unattended: true,
        title: "rough idea · refine",
      }),
    );
    expect(
      (host.startAgentIn as any).mock.calls[0][1].prompt as string,
    ).toContain("# rough idea\n\nmake it faster");
    // CUSTOM(sidebar-agent-tabs): the refinement chat is an orchestrator in the sidebar, but the
    // label does not make it a board agent, so it still opens and notifies like before.
    expect((host.startAgentIn as any).mock.calls[0][1].labels).toEqual({
      "pwb/refinement-chat": "true",
    });
    // Reopening reuses the same chat while its agent lives.
    await board.mutate({ action: "refine", taskId: task.id });
    expect(host.startAgentIn).toHaveBeenCalledTimes(1);

    await expect(board.writeTicket("someone-else", "")).rejects.toThrow(
      "not a Workboard refinement",
    );
    await board.writeTicket(refinement.agentId, "the cache");
    expect((host.runAgent as any).mock.calls[0][1]).toContain(
      "Focus on: the cache",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await board.refresh();
    const written = board.snapshot().cards.find((card) => card.id === task.id)!;
    expect(written).toMatchObject({ title: "Ticket", description: "Body" });
    expect(written.stage).toBe("backlog");
    expect(board.snapshot().refinements[task.id].status).toBe("written");

    // An archived chat is replaced by a new one.
    inventory.agents.find((a) => a.id === refinement.agentId)!.archivedAt =
      "2026-09-23T00:00:00Z";
    await board.mutate({ action: "refine", taskId: task.id });
    expect(host.startAgentIn).toHaveBeenCalledTimes(2);
    expect(board.snapshot().refinements[task.id].status).toBe("chatting");
  } finally {
    board.dispose();
  }
});

it("the refinement chat name ends with the kind, even for a long title", () => {
  expect(refinementChatTitle("X")).toBe("X · refine");
  const long = refinementChatTitle(`${"a".repeat(190)} ${"b".repeat(300)}`);
  expect(long.length).toBeLessThanOrEqual(200);
  expect(long.endsWith(" · refine")).toBe(true);
  expect(long.startsWith("a".repeat(190))).toBe(true);
});

it("a refinement needs a project", async () => {
  const { board } = orchestrated();
  await board.start();
  try {
    const view = await board.mutate({
      action: "create",
      title: "Loose",
      description: "",
      projectId: null,
    });
    await expect(
      board.mutate({ action: "refine", taskId: view.cards[0].id }),
    ).rejects.toThrow("Choose a project for this task");
  } finally {
    board.dispose();
  }
});

async function reviewed() {
  const setup = orchestrated();
  await setup.board.start();
  await setup.board.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  await toReady(setup.board, "Task");
  const orchestratorId = await addOrchestrator(setup.board);
  const task = byTitle(setup.board, "Task");
  const agent = setup.inventory.agents.find(
    (a) => a.workspaceId === task.workspaceId,
  )!;
  await setup.board.refresh();
  agent.activity = "idle";
  setup.advance(1000);
  await setup.board.refresh();
  setup.advance(20_000);
  await setup.board.refresh();
  return { ...setup, task, agent, orchestratorId };
}

it("a finished task shows the agent's last reply and Done moves it to Done", async () => {
  const { board, task, host } = await reviewed();
  try {
    expect(stageOf(board, "Task")).toBe("review");
    expect(board.snapshot().orchestrations[task.id].summary).toBe(
      "Changed X. Check Y.",
    );
    await board.mutate({
      action: "review",
      taskId: task.id,
      outcome: "done",
      feedback: "",
    });
    expect(stageOf(board, "Task")).toBe("done");
    expect(host.sendAgent).not.toHaveBeenCalled();
  } finally {
    board.dispose();
  }
});

it("Continue sends the feedback to the same agent, right away while its window is open", async () => {
  const { board, task, agent, host, advance } = await reviewed();
  try {
    await board.mutate({
      action: "review",
      taskId: task.id,
      outcome: "continue",
      feedback: "Also cover the empty case",
    });
    expect(stageOf(board, "Task")).toBe("in-progress");
    expect(host.sendAgent).toHaveBeenCalledWith(
      agent.id,
      expect.stringContaining("Also cover the empty case"),
    );
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(board.snapshot().orchestrations[task.id]).toMatchObject({
      status: "running",
      summary: null,
      feedback: null,
    });

    // The second turn ends: back to review.
    await board.refresh();
    agent.activity = "idle";
    advance(1000);
    await board.refresh();
    advance(20_000);
    await board.refresh();
    expect(stageOf(board, "Task")).toBe("review");
  } finally {
    board.dispose();
  }
});

it("while disabled, a task sent back waits in Ready to start for the next pass", async () => {
  const { board, task, host, orchestratorId } = await reviewed();
  try {
    await setEnabled(board, orchestratorId, false);
    await board.mutate({
      action: "review",
      taskId: task.id,
      outcome: "continue",
      feedback: "More",
    });
    expect(stageOf(board, "Task")).toBe("ready");
    expect(board.snapshot().orchestrations[task.id]).toMatchObject({
      status: "queued",
      feedback: "More",
    });
    await board.refresh();
    expect(host.sendAgent).not.toHaveBeenCalled();

    await setEnabled(board, orchestratorId, true);
    expect(host.sendAgent).toHaveBeenCalledTimes(1);
    expect(stageOf(board, "Task")).toBe("in-progress");
  } finally {
    board.dispose();
  }
});

async function readyTasks(
  board: Workboard,
  advance: (ms: number) => number,
  titles: string[],
  extra: Record<string, unknown> = {},
) {
  for (const title of titles) {
    advance(1000);
    await board.mutate({
      action: "create",
      title,
      description: "",
      projectId: "p",
      ...extra,
    });
    await toReady(board, title);
  }
}
const finish = async (
  board: Workboard,
  inventory: ReturnType<typeof orchestrated>["inventory"],
  advance: (ms: number) => number,
  title: string,
) => {
  const card = byTitle(board, title);
  await board.refresh();
  inventory.agents.find((a) => a.workspaceId === card.workspaceId)!.activity =
    "idle";
  advance(1000);
  await board.refresh();
  advance(20_000);
  await board.refresh();
};

it("Run now takes one batch, as many at a time as its limit allows, and then stops", async () => {
  const { board, host, inventory, advance } = orchestrated();
  await board.start();
  try {
    const id = await addOrchestrator(board, {
      name: "Manual",
      schedule: { kind: "manual" },
      maxConcurrent: 1,
      batchSize: 2,
    });
    await readyTasks(board, advance, ["C", "B", "A"]);
    expect(host.startAgent).not.toHaveBeenCalled();
    expect(board.snapshot().orchestratorStatus[id]).toMatchObject({
      active: false,
      waiting: 3,
      nextRunAt: null,
    });

    await board.mutate({ action: "orchestrator-run", id });
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(stageOf(board, "A")).toBe("in-progress");
    await finish(board, inventory, advance, "A");
    expect(host.startAgent).toHaveBeenCalledTimes(2);
    expect(stageOf(board, "B")).toBe("in-progress");
    await finish(board, inventory, advance, "B");
    // The batch was two: C waits for the next run.
    expect(host.startAgent).toHaveBeenCalledTimes(2);
    expect(stageOf(board, "C")).toBe("ready");
    expect(board.snapshot().orchestratorStatus[id].active).toBe(false);
    expect(logText(board, id)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Run now"),
        'Started "A"',
        'Finished "A"; ready to review',
        "Run finished (batch done): 2 started",
      ]),
    );
  } finally {
    board.dispose();
  }
});

it("a daily time starts a run once, and Stop ends it", async () => {
  const { board, host, advance, now } = (() => {
    const setup = orchestrated();
    return { ...setup, now: () => setup.advance(0) };
  })();
  await board.start();
  try {
    const at = new Date(now() + 2 * 60_000);
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const id = await addOrchestrator(board, {
      name: "Nightly",
      schedule: { kind: "daily", times: [time] },
      maxConcurrent: 1,
      batchSize: 5,
    });
    await readyTasks(board, advance, ["Two", "One"]);
    expect(host.startAgent).not.toHaveBeenCalled();
    expect(board.snapshot().orchestratorStatus[id].nextRunAt).not.toBeNull();

    advance(3 * 60_000);
    await board.refresh();
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(logText(board, id)).toContain("Scheduled run: up to 5 tasks");
    await board.refresh();
    expect(
      logText(board, id).filter((t) => t.startsWith("Scheduled")),
    ).toHaveLength(1);

    await board.mutate({ action: "orchestrator-stop", id });
    expect(board.snapshot().orchestratorStatus[id].active).toBe(false);
  } finally {
    board.dispose();
  }
});

it("disabling ends the run and logs it; Run now is refused until it is enabled again", async () => {
  const { board, host, advance } = orchestrated();
  await board.start();
  try {
    const id = await addOrchestrator(board, {
      name: "Manual",
      schedule: { kind: "manual" },
      maxConcurrent: 1,
      batchSize: 5,
    });
    await readyTasks(board, advance, ["B", "A"]);
    await board.mutate({ action: "orchestrator-run", id });
    expect(board.snapshot().orchestratorRuntime[id].quota).toBeGreaterThan(0);

    await board.mutate({ action: "orchestrator-enable", id, enabled: false });
    expect(board.snapshot().orchestratorRuntime[id].quota).toBe(0);
    expect(board.snapshot().orchestratorStatus[id].active).toBe(false);
    expect(logText(board, id)).toEqual(
      expect.arrayContaining([
        "Disabled: no new tasks start; running agents keep going",
        expect.stringContaining("Run finished (disabled)"),
      ]),
    );
    await expect(
      board.mutate({ action: "orchestrator-run", id }),
    ).rejects.toThrow("Orchestrator is disabled");
    expect(host.startAgent).toHaveBeenCalledTimes(1);

    await board.mutate({ action: "orchestrator-enable", id, enabled: true });
    expect(logText(board, id)).toContain("Enabled");
    await board.mutate({ action: "orchestrator-run", id });
    expect(board.snapshot().orchestratorStatus[id].active).toBe(true);
  } finally {
    board.dispose();
  }
});

it("a disabled orchestrator takes no tasks, even with an open window, until it is enabled", async () => {
  const { board, host, advance } = orchestrated();
  await board.start();
  try {
    const id = await addOrchestrator(board, { name: "Always" });
    await board.mutate({ action: "orchestrator-enable", id, enabled: false });
    await readyTasks(board, advance, ["A"]);
    await board.refresh();
    expect(host.startAgent).not.toHaveBeenCalled();
    expect(stageOf(board, "A")).toBe("ready");
    expect(board.snapshot().orchestratorStatus[id]).toMatchObject({
      active: false,
      nextRunAt: null,
    });

    await board.mutate({ action: "orchestrator-enable", id, enabled: true });
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(stageOf(board, "A")).toBe("in-progress");
  } finally {
    board.dispose();
  }
});

it("a task chosen for an orchestrator goes to it; others go to their project's orchestrator", async () => {
  const { board, advance } = orchestrated();
  await board.start();
  try {
    const project = await addOrchestrator(board, {
      name: "Project p",
      projectId: "p",
    });
    const other = await addOrchestrator(board, {
      name: "Other",
      projectId: "elsewhere",
    });
    await readyTasks(board, advance, ["Chosen"], { orchestratorId: other });
    await readyTasks(board, advance, ["Unassigned"]);
    const records = board.snapshot().orchestrations;
    expect(records[byTitle(board, "Chosen").id].orchestratorId).toBe(other);
    expect(records[byTitle(board, "Unassigned").id].orchestratorId).toBe(
      project,
    );

    await board.mutate({ action: "orchestrator-delete", id: other });
    expect(byTitle(board, "Chosen").orchestratorId).toBeNull();
    expect(board.snapshot().orchestratorLogs[other]).toBeUndefined();
  } finally {
    board.dispose();
  }
});

it("changes the agent of several orchestrators at once and leaves the rest alone", async () => {
  const { board } = orchestrated();
  await board.start();
  try {
    const first = await addOrchestrator(board, { name: "First" });
    const second = await addOrchestrator(board, { name: "Second" });
    const untouched = await addOrchestrator(board, { name: "Untouched" });
    const view = await board.mutate({
      action: "orchestrators-set-agent",
      ids: [first, second],
      provider: "codex/gpt-5",
      modeId: "read-only",
      thinkingOptionId: "high",
    });
    const find = (id: string) =>
      view.orchestrators.find((config) => config.id === id)!;
    for (const id of [first, second]) {
      expect(find(id)).toMatchObject({
        provider: "codex/gpt-5",
        modeId: "read-only",
        thinkingOptionId: "high",
      });
      expect(logText(board, id)).toContain("Agent changed to codex/gpt-5");
    }
    expect(find(untouched)).toMatchObject({
      provider: "claude/claude-opus-5-5",
      modeId: null,
      thinkingOptionId: "medium",
    });
    expect(logText(board, untouched)).not.toContain(
      "Agent changed to codex/gpt-5",
    );
    // CUSTOM(unattended-automation): OpenCode-like providers carry the Permissions choice.
    const asked = await board.mutate({
      action: "orchestrators-set-agent",
      ids: [first],
      provider: "opencode/some-model",
      modeId: "build",
      thinkingOptionId: null,
      autoAccept: false,
    });
    expect(
      asked.orchestrators.find((config) => config.id === first),
    ).toMatchObject({ provider: "opencode/some-model", autoAccept: false });
    await expect(
      board.mutate({
        action: "orchestrators-set-agent",
        ids: [],
        provider: "codex/gpt-5",
        modeId: null,
        thinkingOptionId: null,
      }),
    ).rejects.toThrow("No orchestrators selected");
    await expect(
      board.mutate({
        action: "orchestrators-set-agent",
        ids: [first],
        provider: "codex",
        modeId: null,
        thinkingOptionId: null,
      }),
    ).rejects.toThrow("provider-model-invalid");
  } finally {
    board.dispose();
  }
});

it("a new board gets an always-on default orchestrator once", async () => {
  const setup = fixture();
  setup.inventory.projects.push(project);
  await setup.board.start();
  try {
    const [first] = setup.board.snapshot().orchestrators;
    expect(first).toMatchObject({
      name: "Default",
      projectId: null,
      enabled: true,
      provider: "claude/claude-opus-5-5",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    });
    await setup.board.mutate({ action: "orchestrator-delete", id: first.id });
    setup.board.dispose();
    const again = new Workboard(setup.host, setup.store, setup.now);
    await again.start();
    expect(again.snapshot().orchestrators).toEqual([]);
    again.dispose();
  } finally {
    setup.board.dispose();
  }
});

/** A reviewed task accepted as Done, in a git project. */
async function done() {
  const setup = await reviewed();
  setup.inventory.workspaces.find(
    (w) => w.id === setup.task.workspaceId,
  )!.projectKind = "git";
  await setup.board.mutate({
    action: "review",
    taskId: setup.task.id,
    outcome: "done",
    feedback: "",
  });
  return setup;
}
const settle = async (board: Workboard) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await board.refresh();
};

it("Commit commits a Done task's changes, and refuses a clean checkout", async () => {
  const { board, task, host } = await done();
  try {
    const view = await board.mutate({
      action: "finish",
      taskId: task.id,
      step: "commit",
    });
    expect(view.finishes[task.id].running).toBe("commit");
    await settle(board);
    expect(host.commit).toHaveBeenCalledWith("/fixture");
    expect(board.snapshot().finishes[task.id]).toMatchObject({
      running: null,
      committedAt: expect.any(String),
      error: null,
    });

    (host.gitDirty as any).mockResolvedValueOnce(false);
    await board.mutate({ action: "finish", taskId: task.id, step: "commit" });
    await settle(board);
    expect(board.snapshot().finishes[task.id].error).toBe("Nothing to commit");
  } finally {
    board.dispose();
  }
});

it("Commit refuses an untracked node_modules symlink and commits nothing", async () => {
  const { board, task, host } = await done();
  try {
    (host.gitStatusLines as any).mockResolvedValue(["?? node_modules"]);
    await board.mutate({ action: "finish", taskId: task.id, step: "merge" });
    await settle(board);
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.mergeToBase).not.toHaveBeenCalled();
    expect(board.snapshot().finishes[task.id].error).toContain(
      "untracked dependency paths would enter the commit (node_modules)",
    );
  } finally {
    board.dispose();
  }
});

it("Merge commits what is left and merges into the project; PR asks the agent", async () => {
  const { board, task, host, agent } = await done();
  try {
    await board.mutate({ action: "finish", taskId: task.id, step: "merge" });
    await settle(board);
    expect(host.commit).toHaveBeenCalledTimes(1);
    expect(host.mergeToBase).toHaveBeenCalledWith("/fixture");
    expect(board.snapshot().finishes[task.id].mergedAt).toEqual(
      expect.any(String),
    );

    await board.mutate({ action: "finish", taskId: task.id, step: "pr" });
    await settle(board);
    expect((host.askAgent as any).mock.calls[0][0]).toBe(agent.id);
    expect(board.snapshot().finishes[task.id]).toMatchObject({
      prTitle: "Add X",
      prBody: "What changed.",
    });
  } finally {
    board.dispose();
  }
});

it("only a Done task in a git project can be finished", async () => {
  const { board, task } = await reviewed();
  try {
    await expect(
      board.mutate({ action: "finish", taskId: task.id, step: "commit" }),
    ).rejects.toThrow("Only a Done task");
  } finally {
    board.dispose();
  }
});

it("a task created in Ready to start goes straight to an active orchestrator", async () => {
  const { board, host } = orchestrated();
  await board.start();
  try {
    await addOrchestrator(board);
    await board.mutate({
      action: "create",
      title: "Now",
      description: "",
      projectId: "p",
      stage: "ready",
    });
    expect(host.startAgent).toHaveBeenCalledTimes(1);
    expect(stageOf(board, "Now")).toBe("in-progress");
    await expect(
      board.mutate({
        action: "create",
        title: "Bad",
        description: "",
        projectId: "p",
        stage: "in-progress",
      }),
    ).rejects.toThrow("Choose a To do group");
  } finally {
    board.dispose();
  }
});

// CUSTOM(done-auto-archive)
function archiveScan(
  label: string,
  kind: "worktree" | "directory" = "worktree",
  baseBranch = "",
) {
  const assistant = dataSchema.parse({}).assistant;
  assistant.settings.projects.p = {
    action: assistant.settings.defaultAction,
    baseBranch,
  } as never;
  const stage = label.replace("pwb:", "");
  const test = fixture({
    assistant,
    tasks: [
      {
        ...newTask("t", "Task", "2026-08-01T00:00:00Z", stage),
        workspaceId: "w",
        projectId: "p",
        conversationGateAt: "2026-08-01T00:00:00.000Z",
        conversationGateEvidence: "exact",
        lastConversationAt: "2026-08-01T00:00:00.000Z",
        conversationStatus: "known",
        conversationDisplayEvidence: "exact",
      },
    ],
  });
  test.inventory.projects.push({ ...project, isGit: true });
  test.inventory.workspaces.push({
    ...workspace("w", undefined, [label]),
    workspaceKind: kind,
  });
  test.inventory.agents.push({
    id: "a",
    workspaceId: "w",
    title: null,
    updatedAt: "2026-08-01T00:00:00Z",
    lastUserMessageAt: "2026-08-01T00:00:00Z",
    activity: "idle",
  });
  test.host.conversation = agentEvidence("2026-08-01T00:00:00Z");
  return test;
}

it("archives a Done task's worktree and passes the project's base to safety", async () => {
  const test = archiveScan("pwb:done", "worktree", "custom");
  try {
    await test.board.start();
    expect(test.host.safety).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w" }),
      "custom",
    );
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("w");
    expect(test.board.snapshot().cards[0].archived).toMatchObject({
      status: "archived",
    });
  } finally {
    test.board.dispose();
  }
});

it("keeps a Done task's worktree and flags it when its branch is unmerged", async () => {
  const test = archiveScan("pwb:done");
  vi.mocked(test.host.safety).mockResolvedValue("git-unmerged");
  try {
    await test.board.start();
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.board.snapshot().cards[0].issue).toBe("git-unmerged");
  } finally {
    test.board.dispose();
  }
});

it("never archives a Done task's local checkout workspace", async () => {
  const test = archiveScan("pwb:done", "directory");
  try {
    await test.board.start();
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.host.safety).not.toHaveBeenCalled();
    expect(test.board.snapshot().cards[0].issue ?? null).toBeNull();
  } finally {
    test.board.dispose();
  }
});

it("never archives a worktree whose task is not in a done or canceled group", async () => {
  const test = archiveScan("pwb:in-progress");
  try {
    await test.board.start();
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.board.snapshot().cards[0].archived ?? null).toBeNull();
  } finally {
    test.board.dispose();
  }
});
