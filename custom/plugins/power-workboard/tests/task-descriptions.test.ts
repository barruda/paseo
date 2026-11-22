// CUSTOM(task-description-files): descriptions live in one file per task, out of the board JSON.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { visibleCards } from "../client/board-utils";
import {
  defaultDescriptionDirectory,
  directoryDescriptionFiles,
  memoryDescriptionFiles,
  type DescriptionFiles,
} from "../server/descriptions";
import { Store } from "../server/store";
import { Workboard } from "../server/workboard";
import {
  dataSchema,
  newTask,
  orchestratorConfigSchema,
  type Board,
  type Data,
} from "../shared/model";
import { fixture } from "./fixtures";

const NOW = "2026-09-23T00:00:00Z";
const tempDirectory = () =>
  mkdtempSync(join(tmpdir(), "pwb-task-descriptions-"));

/** A backing whose saved JSON a test can read, and make fail once. */
function backing(initial: Partial<Data> = {}) {
  let saved = dataSchema.parse(initial);
  let revision = 0;
  let failNext = false;
  return {
    saved: () => saved,
    failNextWrite: () => {
      failNext = true;
    },
    read: async () => ({
      status: "ready",
      revision: String(revision),
      values: structuredClone(saved),
    }),
    write: async (expected: string, values: Data) => {
      if (failNext) {
        failNext = false;
        throw new Error("daemon went away");
      }
      if (expected !== String(revision))
        return { status: "conflict", error: "Conflict" };
      saved = structuredClone(values);
      return {
        status: "saved",
        revision: String(++revision),
        values: structuredClone(saved),
      };
    },
  };
}

function legacyTask(id: string, description: string) {
  return { ...newTask(id, id, NOW), description };
}

describe("description files", () => {
  it("lives under PASEO_HOME's plugin data", () => {
    expect(defaultDescriptionDirectory({ PASEO_HOME: "/home/x/.paseo" })).toBe(
      "/home/x/.paseo/plugin-data/power-workboard/tasks",
    );
  });

  it("writes through a temporary file, reads back, and removes", async () => {
    const directory = join(tempDirectory(), "tasks");
    const files = directoryDescriptionFiles(directory);
    await files.write("t1", "# Ticket\n\n![shot](/x/images/a.png)");
    await files.write("t1", "second");
    expect(readdirSync(directory)).toEqual(["t1.md"]);
    expect(readFileSync(join(directory, "t1.md"), "utf8")).toBe("second");
    expect(await files.readAll(["t1", "missing"])).toEqual(
      new Map([["t1", "second"]]),
    );
    await files.remove("t1");
    await files.remove("t1");
    expect(readdirSync(directory)).toEqual([]);
  });

  it("refuses a task id that could leave the folder", async () => {
    const files = directoryDescriptionFiles(tempDirectory());
    await expect(files.write("../escape", "x")).rejects.toThrow(
      "Invalid task id",
    );
  });
});

describe("Store.description", () => {
  it("keeps the text in the file and only its length and revision in the JSON", async () => {
    const json = backing();
    const files = memoryDescriptionFiles();
    const store = new Store(json, files);
    await store.load();
    await store.update((data, descriptions) => {
      data.tasks.push(newTask("t1", "One", NOW));
      descriptions.set("t1", "Do it");
    });
    expect(store.description("t1")).toBe("Do it");
    expect(files.texts.get("t1")).toBe("Do it");
    expect(json.saved().tasks[0]).toMatchObject({
      description: "",
      descriptionLength: 5,
      descriptionRevision: 1,
    });

    // Saving the same text again changes nothing; a new text bumps the revision.
    await store.update((_data, descriptions) =>
      descriptions.set("t1", "Do it"),
    );
    expect(json.saved().tasks[0].descriptionRevision).toBe(1);
    await store.update((_data, descriptions) => {
      expect(descriptions.get("t1")).toBe("Do it");
      descriptions.set("t1", "");
      expect(descriptions.get("t1")).toBe("");
    });
    expect(store.description("t1")).toBe("");
    expect(json.saved().tasks[0]).toMatchObject({
      descriptionLength: 0,
      descriptionRevision: 2,
    });

    // A reopened store reads the texts back from the files.
    await store.update((_data, descriptions) => descriptions.set("t1", "Back"));
    const reopened = new Store(json, files);
    await reopened.load();
    expect(reopened.description("t1")).toBe("Back");
    expect(reopened.current.tasks[0].description).toBe("");
  });

  it("moves a text set straight on the task into its file", async () => {
    const json = backing();
    const files = memoryDescriptionFiles();
    const store = new Store(json, files);
    await store.load();
    await store.update((data) => {
      data.tasks.push({ ...newTask("t1", "One", NOW), description: "Direct" });
    });
    expect(store.description("t1")).toBe("Direct");
    expect(json.saved().tasks[0].description).toBe("");
  });

  it("deletes the file of a task that leaves the board", async () => {
    const files = memoryDescriptionFiles();
    const store = new Store(backing(), files);
    await store.load();
    await store.update((data, descriptions) => {
      data.tasks.push(newTask("t1", "One", NOW), newTask("t2", "Two", NOW));
      descriptions.set("t1", "one");
      descriptions.set("t2", "two");
    });
    await store.update((data) => {
      data.tasks = data.tasks.filter((t) => t.id !== "t1");
    });
    expect([...files.texts.keys()]).toEqual(["t2"]);
    expect(store.description("t1")).toBe("");
  });
});

describe("migration of descriptions saved in the JSON", () => {
  it("moves them to files and clears the JSON copy", async () => {
    const json = backing({
      tasks: [legacyTask("t1", "legacy one"), legacyTask("t2", "")],
    });
    const files = memoryDescriptionFiles();
    const store = new Store(json, files);
    await store.load();
    expect(store.hasLegacyDescriptions).toBe(true);
    expect(store.description("t1")).toBe("legacy one");
    expect(store.current.tasks[0].description).toBe("");
    await store.moveDescriptions();
    expect(store.hasLegacyDescriptions).toBe(false);
    expect(files.texts).toEqual(new Map([["t1", "legacy one"]]));
    expect(json.saved().tasks.map((t) => t.description)).toEqual(["", ""]);
    expect(json.saved().tasks[0]).toMatchObject({
      descriptionLength: 10,
      descriptionRevision: 1,
    });
  });

  it("keeps every text readable when the run is interrupted after the files", async () => {
    const json = backing({
      tasks: [legacyTask("t1", "first"), legacyTask("t2", "second")],
    });
    const files = memoryDescriptionFiles();
    const store = new Store(json, files);
    await store.load();
    json.failNextWrite();
    await expect(store.moveDescriptions()).rejects.toThrow("daemon went away");
    // The files exist, and the JSON still has its copy.
    expect(files.texts.get("t1")).toBe("first");
    expect(json.saved().tasks.map((t) => t.description)).toEqual([
      "first",
      "second",
    ]);

    const restarted = new Store(json, files);
    await restarted.load();
    expect(restarted.description("t1")).toBe("first");
    expect(restarted.description("t2")).toBe("second");
    await restarted.moveDescriptions();
    expect(json.saved().tasks.map((t) => t.description)).toEqual(["", ""]);
    const again = new Store(json, files);
    await again.load();
    expect(again.description("t2")).toBe("second");
    expect(again.hasLegacyDescriptions).toBe(false);
  });

  it("leaves the JSON untouched when a file cannot be written", async () => {
    const json = backing({ tasks: [legacyTask("t1", "keep me")] });
    const broken: DescriptionFiles = {
      ...memoryDescriptionFiles(),
      write: async () => {
        throw new Error("disk full");
      },
    };
    const store = new Store(json, broken);
    await store.load();
    await expect(store.moveDescriptions()).rejects.toThrow("disk full");
    expect(json.saved().tasks[0].description).toBe("keep me");
    expect(store.description("t1")).toBe("keep me");
  });

  it("runs when the board starts, and the JSON gets smaller", async () => {
    const long = "Long ticket text. ".repeat(500);
    const setup = fixture({
      defaultOrchestratorSeeded: true,
      tasks: [legacyTask("t1", long)],
    });
    const before = JSON.stringify((await setup.backing.read()).values).length;
    const board = new Workboard(setup.host, setup.store, () => Date.parse(NOW));
    await board.start();
    try {
      const saved = (await setup.backing.read()).values;
      expect(saved.tasks[0].description).toBe("");
      expect(before - JSON.stringify(saved).length).toBeGreaterThan(
        long.length - 100,
      );
      expect(board.taskDescriptions(["t1"])).toEqual([
        { taskId: "t1", revision: 1, text: long },
      ]);
    } finally {
      board.dispose();
    }
  });
});

describe("the board", () => {
  const project = {
    id: "p",
    name: "Project",
    directory: "/fixture",
    isGit: false,
  };

  it("creates, edits, reads and starts a task with its description out of the snapshot", async () => {
    const setup = fixture({ defaultOrchestratorSeeded: true });
    setup.inventory.projects.push(project);
    let now = Date.parse(NOW);
    const board = new Workboard(setup.host, setup.store, () => now);
    await board.start();
    try {
      await board.mutate({
        action: "create",
        title: "Task",
        description: "Do it",
        projectId: "p",
      });
      let card = board.snapshot().cards[0];
      expect(card).not.toHaveProperty("description");
      expect(card).toMatchObject({ descriptionLength: 5 });
      now += 1000;
      await board.mutate({
        action: "edit",
        taskId: card.id,
        updatedAt: card.updatedAt,
        title: card.title,
        description: "Do it well",
        projectId: "p",
      });
      card = board.snapshot().cards[0];
      expect(card.descriptionRevision).toBe(2);
      expect(board.taskDescriptions([card.id, "gone"])).toEqual([
        { taskId: card.id, revision: 2, text: "Do it well" },
      ]);
      expect((await setup.backing.read()).values.tasks[0].description).toBe("");

      await board.mutate({
        action: "stage",
        taskId: card.id,
        stage: "ready",
        expectedLabels: [],
      });
      await board.mutate({
        action: "orchestrator-save",
        orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
          name: "Always",
          schedule: { kind: "window", start: "00:00", end: "00:00" },
        }),
      });
      const prompt = (setup.host.startAgent as any).mock.calls[0][1].prompt;
      expect(prompt).toContain("# Task\n\nDo it well");
    } finally {
      board.dispose();
    }
  });
});

describe("board search", () => {
  it("matches descriptions passed in, since the snapshot has none", () => {
    const card = (id: string, title: string) => ({
      ...newTask(id, title, NOW),
      stage: "backlog",
      labels: [],
      managedLabels: [],
      changeRequest: null,
      changeRequestUnavailable: false,
      activity: "idle" as const,
      pinState: "none" as const,
      inPlace: false,
      dueAt: null,
      agents: [],
    });
    const board = {
      cards: [card("a", "Alpha"), card("b", "Beta")],
    } as unknown as Board;
    const descriptions = new Map([["b", "Fix the cache"]]);
    expect(
      visibleCards(board, "all", "cache", false, undefined, descriptions).map(
        (c) => c.id,
      ),
    ).toEqual(["b"]);
    expect(visibleCards(board, "all", "cache", false)).toEqual([]);
  });
});
