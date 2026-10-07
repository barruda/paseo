import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTask } from "./model";
import { defaultTasksFile, TaskStore } from "./store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "workspace-tasks-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("TaskStore", () => {
  it("persists each workspace separately across instances", async () => {
    const file = path.join(dir, "nested", "tasks.json");
    const store = new TaskStore(file);
    const append = (text: string) =>
      store.update("ws-1", (state) => ({
        state: addTask(state, { id: text, text }, "now"),
        result: null,
      }));
    await Promise.all([append("a"), append("b"), append("c")]);

    const reopened = new TaskStore(file);
    expect((await reopened.read("ws-1")).tasks.map((task) => task.text)).toEqual(["a", "b", "c"]);
    expect((await reopened.read("ws-2")).tasks).toEqual([]);
  });

  it("refuses to overwrite a file it can't parse", async () => {
    const file = path.join(dir, "tasks.json");
    await writeFile(file, "{ not json", "utf8");
    const store = new TaskStore(file);
    await expect(store.read("ws-1")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });
});

describe("defaultTasksFile", () => {
  it("lives under PASEO_HOME", () => {
    expect(defaultTasksFile({ PASEO_HOME: "/tmp/home" })).toBe(
      "/tmp/home/plugin-data/workspace-tasks/tasks.json",
    );
  });
});
