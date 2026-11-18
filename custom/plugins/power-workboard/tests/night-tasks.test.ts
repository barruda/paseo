import { afterEach, expect, it, vi } from "vitest";
import { Workboard } from "../server/workboard";
import type { NightSystem } from "../server/night";
import { orchestratorConfigSchema } from "../shared/model";
import { fixture } from "./fixtures";

// CUSTOM(night-tasks): night tasks, tasks with a start time, and the night power-off, on a fake clock.

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: false,
};
/** 2026-11-17 is a Tuesday; times are the host's local time, like the night window. */
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 10, day, hours, minutes).getTime();

function setup(start = at(17, 21), interval = 60_000) {
  const base = fixture({ defaultOrchestratorSeeded: true });
  base.inventory.projects.push(project);
  let now = start;
  const system: NightSystem = {
    notify: vi.fn(async () => {}),
    powerOff: vi.fn(async () => {}),
  };
  const board = new Workboard(base.host, base.store, () => now, interval, {
    night: system,
  });
  return {
    ...base,
    board,
    system,
    now: () => now,
    set: (time: number) => (now = time),
    advance: (ms: number) => (now += ms),
  };
}
type Setup = ReturnType<typeof setup>;
const byTitle = (board: Workboard, title: string) =>
  board.snapshot().cards.find((card) => card.title === title)!;
const stageOf = (board: Workboard, title: string) =>
  byTitle(board, title).stage;
async function addOrchestrator(
  board: Workboard,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const before = new Set(board.snapshot().orchestrators.map((o) => o.id));
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Manual",
      schedule: { kind: "manual" },
      ...overrides,
    }),
  });
  return board.snapshot().orchestrators.find((o) => !before.has(o.id))!.id;
}
const create = (
  board: Workboard,
  title: string,
  timing?: { kind: "night" } | { kind: "at"; at: string },
) =>
  board.mutate({
    action: "create",
    title,
    description: `Do ${title}`,
    projectId: "p",
    ...(timing ? { timing } : {}),
  });
/** Let the task's agent end its turn and stay idle past the settle window. */
async function finish({ board, inventory, advance }: Setup, title: string) {
  const card = byTitle(board, title);
  await board.refresh();
  inventory.agents.find((a) => a.workspaceId === card.workspaceId)!.activity =
    "idle";
  advance(1000);
  await board.refresh();
  advance(21_000);
  await board.refresh();
}
const nightLog = (board: Workboard) =>
  board.snapshot().nightRuntime.log.map((entry) => entry.text);

afterEach(() => {
  vi.useRealTimers();
});

it("a task with a start time waits in Scheduled and moves to Ready to start at that time", async () => {
  const s = setup(at(17, 14));
  await s.board.start();
  try {
    await create(s.board, "Timed", {
      kind: "at",
      at: new Date(at(17, 15)).toISOString(),
    });
    expect(stageOf(s.board, "Timed")).toBe("scheduled");
    expect(byTitle(s.board, "Timed").timing).toEqual({
      kind: "at",
      at: new Date(at(17, 15)).toISOString(),
    });
    s.set(at(17, 14, 59));
    await s.board.refresh();
    expect(stageOf(s.board, "Timed")).toBe("scheduled");
    s.set(at(17, 15));
    await s.board.refresh();
    expect(stageOf(s.board, "Timed")).toBe("ready");
    expect(byTitle(s.board, "Timed").timing).toBeNull();
    // From Ready to start an always-on orchestrator takes it as usual.
    await addOrchestrator(s.board, {
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    });
    expect(stageOf(s.board, "Timed")).toBe("in-progress");
  } finally {
    s.board.dispose();
  }
});

it("a timer wakes the board for a start time even when the regular refresh is far off", async () => {
  vi.useFakeTimers({ now: at(17, 14) });
  const base = fixture({ defaultOrchestratorSeeded: true });
  base.inventory.projects.push(project);
  // The regular refresh runs every 10 minutes; only the start-time timer can be on time.
  const board = new Workboard(base.host, base.store, Date.now, 600_000, {
    night: { notify: vi.fn(), powerOff: vi.fn() },
  });
  await board.start();
  try {
    await create(board, "Timed", {
      kind: "at",
      at: new Date(at(17, 14, 1)).toISOString(),
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(stageOf(board, "Timed")).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stageOf(board, "Timed")).toBe("ready");
  } finally {
    board.dispose();
  }
});

it("a night task starts only inside the night window, whatever the orchestrator's schedule", async () => {
  const s = setup(at(17, 21));
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, { batchSize: 1 });
    await create(s.board, "Night", { kind: "night" });
    await create(s.board, "Daytime");
    expect(stageOf(s.board, "Night")).toBe("scheduled");
    expect(s.board.snapshot().nightStatus).toEqual({
      open: false,
      nextStartAt: new Date(at(17, 22)).toISOString(),
      waiting: 1,
    });
    await s.board.refresh();
    expect(s.host.startAgent).not.toHaveBeenCalled();

    s.set(at(17, 22));
    await s.board.refresh();
    expect(stageOf(s.board, "Night")).toBe("in-progress");
    expect(byTitle(s.board, "Night").timing).toEqual({ kind: "night" });
    const night =
      s.board.snapshot().orchestrations[byTitle(s.board, "Night").id];
    expect(night).toMatchObject({ night: true, orchestratorId: id });
    // The manual orchestrator's own run is untouched: no batch was used.
    expect(s.board.snapshot().orchestratorRuntime[id]?.quota ?? 0).toBe(0);
    expect(stageOf(s.board, "Daytime")).toBe("backlog");
    expect(s.board.snapshot().nightRuntime).toMatchObject({
      windowStart: new Date(at(17, 22)).toISOString(),
      started: 1,
    });

    // After the window closes, a new night task waits for the next night.
    s.set(at(18, 6));
    await create(s.board, "Tomorrow", { kind: "night" });
    await s.board.refresh();
    expect(stageOf(s.board, "Tomorrow")).toBe("scheduled");
    s.set(at(18, 22, 30));
    await s.board.refresh();
    expect(stageOf(s.board, "Tomorrow")).toBe("in-progress");
  } finally {
    s.board.dispose();
  }
});

it("a disabled orchestrator takes no night task, and a custom window is honored", async () => {
  const s = setup(at(17, 1));
  await s.board.start();
  try {
    await s.board.mutate({
      action: "night-settings",
      night: {
        start: "01:30",
        end: "03:00",
        shutdownWhenDone: false,
        shutdownCommand: "",
      },
    });
    const id = await addOrchestrator(s.board, { enabled: false });
    await create(s.board, "Night", { kind: "night" });
    s.set(at(17, 1, 30));
    await s.board.refresh();
    expect(stageOf(s.board, "Night")).toBe("scheduled");
    await s.board.mutate({ action: "orchestrator-enable", id, enabled: true });
    expect(stageOf(s.board, "Night")).toBe("in-progress");
  } finally {
    s.board.dispose();
  }
});

it("Scheduled holds the timing: dropping a draft there makes it a night task, editing moves it", async () => {
  const s = setup(at(17, 12));
  await s.board.start();
  try {
    await create(s.board, "Draft");
    const move = (stage: string) =>
      s.board.mutate({
        action: "stage",
        taskId: byTitle(s.board, "Draft").id,
        stage,
        expectedLabels: [],
      });
    await move("scheduled");
    expect(byTitle(s.board, "Draft").timing).toEqual({ kind: "night" });
    await move("backlog");
    expect(byTitle(s.board, "Draft").timing).toBeNull();

    const edit = (timing: unknown) => {
      const card = byTitle(s.board, "Draft");
      return s.board.mutate({
        action: "edit",
        taskId: card.id,
        updatedAt: card.updatedAt,
        title: card.title,
        description: card.description,
        projectId: card.projectId,
        timing: timing as never,
      });
    };
    const later = new Date(at(17, 18)).toISOString();
    await edit({ kind: "at", at: later });
    expect(stageOf(s.board, "Draft")).toBe("scheduled");
    expect(byTitle(s.board, "Draft").timing).toEqual({ kind: "at", at: later });
    await edit(null);
    expect(stageOf(s.board, "Draft")).toBe("backlog");
    expect(byTitle(s.board, "Draft").timing).toBeNull();
    await expect(edit({ kind: "at", at: "tomorrow-ish" })).rejects.toThrow(
      "Choose a valid start time",
    );
  } finally {
    s.board.dispose();
  }
});

async function nightRan(s: Setup, shutdownWhenDone = true) {
  await s.board.start();
  await s.board.mutate({
    action: "night-settings",
    night: {
      start: "22:00",
      end: "06:00",
      shutdownWhenDone,
      shutdownCommand: "echo off",
    },
  });
  await addOrchestrator(s.board);
  await create(s.board, "Night", { kind: "night" });
  s.set(at(17, 22));
  await s.board.refresh();
  expect(stageOf(s.board, "Night")).toBe("in-progress");
  await finish(s, "Night");
  expect(stageOf(s.board, "Night")).toBe("review");
}

it("without the option, finished night tasks never power the computer off", async () => {
  const s = setup();
  try {
    await nightRan(s, false);
    s.advance(10 * 60_000);
    await s.board.refresh();
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
    expect(s.system.powerOff).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("powers off after a warning once the night tasks are done and no other agent runs", async () => {
  const s = setup();
  try {
    await nightRan(s);
    const armedAt = s.board.snapshot().nightRuntime.shutdownAt;
    expect(armedAt).not.toBeNull();
    expect(Date.parse(armedAt!) - s.now()).toBe(5 * 60_000);
    expect(s.system.notify).toHaveBeenCalledTimes(1);
    expect(s.system.powerOff).not.toHaveBeenCalled();

    // Another agent starts during the countdown: the power-off is called off.
    s.inventory.agents.push({
      id: "other",
      workspaceId: "elsewhere",
      title: "Other",
      updatedAt: new Date(s.now()).toISOString(),
      lastUserMessageAt: null,
      archivedAt: null,
      activity: "running",
    });
    s.advance(60_000);
    await s.board.refresh();
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
    expect(nightLog(s.board).at(-1)).toBe(
      "Power-off canceled: an agent is running",
    );
    s.advance(10 * 60_000);
    await s.board.refresh();
    expect(s.system.powerOff).not.toHaveBeenCalled();

    // It ends: a new countdown, and the power-off when it runs out.
    s.inventory.agents.find((a) => a.id === "other")!.activity = "idle";
    await s.board.refresh();
    expect(s.board.snapshot().nightRuntime.shutdownAt).not.toBeNull();
    s.advance(4 * 60_000);
    await s.board.refresh();
    expect(s.system.powerOff).not.toHaveBeenCalled();
    s.advance(60_000);
    await s.board.refresh();
    expect(s.system.powerOff).toHaveBeenCalledWith("echo off");
    expect(s.board.snapshot().nightRuntime).toMatchObject({
      shutdownAt: null,
      handledFor: new Date(at(17, 22)).toISOString(),
    });
    s.advance(10 * 60_000);
    await s.board.refresh();
    expect(s.system.powerOff).toHaveBeenCalledTimes(1);
  } finally {
    s.board.dispose();
  }
});

it("waits for every night task, and Cancel keeps that night from powering off", async () => {
  const s = setup();
  try {
    await s.board.start();
    await s.board.mutate({
      action: "night-settings",
      night: {
        start: "22:00",
        end: "06:00",
        shutdownWhenDone: true,
        shutdownCommand: "",
      },
    });
    await addOrchestrator(s.board, { maxConcurrent: 1 });
    // The newest draft sits on top of the column and starts first.
    await create(s.board, "Second", { kind: "night" });
    s.advance(1000);
    await create(s.board, "First", { kind: "night" });
    s.set(at(17, 22));
    await s.board.refresh();
    // One at a time: First finishes and Second starts, so nothing arms in between.
    await finish(s, "First");
    expect(stageOf(s.board, "Second")).toBe("in-progress");
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
    await finish(s, "Second");
    expect(s.board.snapshot().nightRuntime.shutdownAt).not.toBeNull();

    await s.board.mutate({ action: "night-shutdown-cancel" });
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
    s.advance(10 * 60_000);
    await s.board.refresh();
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
    expect(s.system.powerOff).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("turning the option on by day does not power off after last night's tasks", async () => {
  const s = setup();
  try {
    await nightRan(s, false);
    s.set(at(18, 14));
    await s.board.refresh();
    await s.board.mutate({
      action: "night-settings",
      night: {
        start: "22:00",
        end: "06:00",
        shutdownWhenDone: true,
        shutdownCommand: "",
      },
    });
    await s.board.refresh();
    expect(s.board.snapshot().nightRuntime.shutdownAt).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a countdown that ended while Paseo was off is dropped, not run", async () => {
  const s = setup();
  try {
    await nightRan(s);
    expect(s.board.snapshot().nightRuntime.shutdownAt).not.toBeNull();
    // A restart hours later, still inside the night window.
    s.board.dispose();
    s.advance(3 * 60 * 60_000);
    const later = new Workboard(s.host, s.store, s.now, 60_000, {
      night: s.system,
    });
    await later.start();
    try {
      expect(later.snapshot().nightRuntime.shutdownAt).toBeNull();
      expect(nightLog(later).at(-1)).toBe(
        "Power-off canceled: the countdown ended while Paseo was not running",
      );
      expect(s.system.powerOff).not.toHaveBeenCalled();
    } finally {
      later.dispose();
    }
  } finally {
    s.board.dispose();
  }
});
