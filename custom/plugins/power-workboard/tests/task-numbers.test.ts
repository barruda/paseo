import { expect, it } from "vitest";
import { migrateData } from "../shared/migrations";
import { newTask } from "../shared/model";
import {
  parseTaskNumber,
  resolveTaskReference,
  taskNumberLabel,
} from "../shared/task-reference";
import { Workboard } from "../server/workboard";
import { fixture } from "./fixtures";

it("reads a short number with or without #, and nothing else", () => {
  expect(parseTaskNumber("42")).toBe(42);
  expect(parseTaskNumber(" #42 ")).toBe(42);
  expect(parseTaskNumber("042")).toBe(42);
  expect(parseTaskNumber("#0")).toBeNull();
  expect(parseTaskNumber("abc")).toBeNull();
  expect(parseTaskNumber("42a")).toBeNull();
  expect(taskNumberLabel(42)).toBe("#42");
  expect(taskNumberLabel(0)).toBe("");
});

it("resolves a task by UUID first, then by its number", () => {
  const tasks = [
    { id: "uuid-a", number: 1 },
    { id: "uuid-b", number: 2 },
  ];
  expect(resolveTaskReference(tasks, "uuid-b")).toBe(tasks[1]);
  expect(resolveTaskReference(tasks, "#2")).toBe(tasks[1]);
  expect(resolveTaskReference(tasks, "1")).toBe(tasks[0]);
  expect(resolveTaskReference(tasks, "#3")).toBeUndefined();
});

it("gives every new ticket the next number and never reuses one", async () => {
  const setup = fixture({ defaultOrchestratorSeeded: true });
  let now = Date.parse("2026-09-23T00:00:00Z");
  const board = new Workboard(setup.host, setup.store, () => now);
  await board.start();
  try {
    const create = async (title: string) => {
      now += 1000;
      await board.mutate({
        action: "create",
        title,
        description: "",
        projectId: null,
      });
    };
    await create("First");
    await create("Second");
    const numbers = () =>
      Object.fromEntries(
        board.snapshot().cards.map((card) => [card.title, card.number]),
      );
    expect(numbers()).toEqual({ First: 1, Second: 2 });
    // A merge into an existing workspace removes the merged task; its number stays spent.
    await setup.store.update((data) => {
      data.tasks = data.tasks.filter((task) => task.title !== "Second");
    });
    await create("Third");
    expect(numbers()).toEqual({ First: 1, Third: 3 });
    expect(setup.store.current.nextTaskNumber).toBe(4);
  } finally {
    board.dispose();
  }
});

it("migrates existing tickets in creation order and moves the counter past them", () => {
  const data = migrateData(
    {
      schemaVersion: 9,
      tasks: [
        newTask("b", "Second", "2026-01-02T00:00:00Z"),
        newTask("a", "First", "2026-01-01T00:00:00Z"),
        newTask("c", "Third", "2026-01-03T00:00:00Z"),
      ],
    },
    9,
  );
  expect(data.schemaVersion).toBe(10);
  expect(data.tasks.map((task) => [task.id, task.number])).toEqual([
    ["b", 2],
    ["a", 1],
    ["c", 3],
  ]);
  expect(data.nextTaskNumber).toBe(4);
});
