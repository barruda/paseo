// CUSTOM(delete-task): the card menu's Delete task removes the task from the board for good.
import { expect, it } from "vitest";
import { Store } from "../server/store";
import { Workboard } from "../server/workboard";
import type { HistoryEvent } from "../shared/assistant";
import { orchestratorConfigSchema } from "../shared/model";
import { fixture } from "./fixtures";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: false,
};

async function setup() {
  const events: HistoryEvent[] = [];
  const history = {
    append: async (input: any) => {
      const event = { reason: null, detail: null, id: "e", at: "t", ...input };
      events.push(event);
      return event as HistoryEvent;
    },
  };
  const f = fixture({ defaultOrchestratorSeeded: true });
  f.inventory.projects.push(project);
  let now = Date.parse("2026-09-23T00:00:00Z");
  const board = new Workboard(f.host, f.store, () => now, 60000, { history });
  await board.start();
  const create = async (title: string) => {
    now += 1000;
    const snapshot = await board.mutate({
      action: "create",
      title,
      description: `About ${title}`,
      projectId: "p",
    });
    return snapshot.cards.find((card) => card.title === title)!;
  };
  return { ...f, board, events, create };
}

it("deletes a parked task, its description and its order, and records it in the history", async () => {
  const f = await setup();
  const a = await f.create("A");
  const b = await f.create("B");
  expect(f.store.description(a.id)).toBe("About A");
  const after = await f.board.mutate({ action: "delete-task", taskId: a.id });
  expect(after.cards.map((card) => card.title)).toEqual(["B"]);
  expect(f.store.current.tasks.map((task) => task.id)).toEqual([b.id]);
  expect(f.store.description(a.id)).toBe("");
  expect(Object.values(f.store.current.cardOrderByStage).flat()).not.toContain(
    a.id,
  );
  expect(f.events.at(-1)).toMatchObject({
    kind: "task-deleted",
    taskId: a.id,
    taskTitle: "A",
    by: "user",
  });
  // A new board on the same storage (a plugin reload or a daemon restart) does not bring it back.
  const reloaded = new Workboard(f.host, new Store(f.backing), f.now);
  await reloaded.start();
  expect(reloaded.snapshot().cards.map((card) => card.title)).toEqual(["B"]);
});

it("deleting a task whose agent is running archives the agent and starts nothing new", async () => {
  const f = await setup();
  const task = await f.create("Task");
  await f.board.mutate({
    action: "stage",
    taskId: task.id,
    stage: "ready",
    expectedLabels: [],
  });
  await f.board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Always",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    }),
  });
  const record = f.store.current.orchestrations[task.id]!;
  expect(record.agentId).toBeTruthy();
  const agent = f.inventory.agents.find((a) => a.id === record.agentId)!;
  expect(agent.activity).toBe("running");
  const agentsBefore = f.inventory.agents.length;

  await f.board.mutate({ action: "delete-task", taskId: task.id });

  expect(f.host.archiveAgent).toHaveBeenCalledWith(agent.id);
  expect(agent.archivedAt).not.toBeNull();
  expect(f.store.current.orchestrations[task.id]).toBeUndefined();
  expect(f.store.current.assistant.deliveries[task.id]).toBeUndefined();
  await f.board.refresh();
  expect(f.board.snapshot().cards).toEqual([]);
  expect(f.inventory.agents.length).toBe(agentsBefore);
  // The workspace is left as it is: no git or workspace cleanup.
  expect(f.host.archive).not.toHaveBeenCalled();
});

it("deleting a task of a package takes it out of the package", async () => {
  const f = await setup();
  const a = await f.create("A");
  const b = await f.create("B");
  let board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [a.id, b.id],
  });
  expect(board.packages[0]!.total).toBe(2);
  board = await f.board.mutate({ action: "delete-task", taskId: a.id });
  expect(board.packages[0]!.total).toBe(1);
  expect(
    board.cards
      .filter((card) => card.packageId === board.packages[0]!.id)
      .map((card) => card.title),
  ).toEqual(["B"]);
});

it("deleting an id that is not on the board fails with a clear error and changes nothing", async () => {
  const f = await setup();
  await f.create("A");
  await expect(
    f.board.mutate({ action: "delete-task", taskId: "missing" }),
  ).rejects.toThrow("Task no longer exists");
  expect(f.board.snapshot().cards.map((card) => card.title)).toEqual(["A"]);
  expect(f.events.some((event) => event.kind === "task-deleted")).toBe(false);
});
