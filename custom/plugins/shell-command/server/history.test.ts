import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultHistoryFile, HistoryStore, pushHistory } from "./history";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shell-history-"));
  roots.push(root);
  return path.join(root, "nested", "history.json");
}

describe("pushHistory", () => {
  it("puts the command first and drops its older copy", () => {
    expect(pushHistory(["ls", "git status", "pwd"], "git status")).toEqual([
      "git status",
      "ls",
      "pwd",
    ]);
  });

  it("keeps the newest entries", () => {
    expect(pushHistory(["b", "c"], "a", 2)).toEqual(["a", "b"]);
  });
});

describe("HistoryStore", () => {
  it("keeps each key's history apart and survives a reload", async () => {
    const file = await tempFile();
    const store = new HistoryStore(file);
    await Promise.all([store.add("project:a", "ls"), store.add("project:b", "pwd")]);
    await store.add("project:a", "git status");

    const reloaded = new HistoryStore(file);
    await expect(reloaded.read("project:a")).resolves.toEqual(["git status", "ls"]);
    await expect(reloaded.read("project:b")).resolves.toEqual(["pwd"]);
    await expect(reloaded.read("project:c")).resolves.toEqual([]);
  });

  it("refuses to overwrite a file it can't parse", async () => {
    const file = await tempFile();
    const store = new HistoryStore(file);
    await store.add("project:a", "ls");
    await writeFile(file, "not json", "utf8");

    const broken = new HistoryStore(file);
    await expect(broken.add("project:a", "pwd")).rejects.toThrow();
    await expect(readFile(file, "utf8")).resolves.toBe("not json");
  });

  it("lives under PASEO_HOME", () => {
    expect(defaultHistoryFile({ PASEO_HOME: "/srv/paseo" })).toBe(
      "/srv/paseo/plugin-data/shell-command/history.json",
    );
  });
});
