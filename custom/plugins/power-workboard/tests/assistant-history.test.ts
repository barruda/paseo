import { mkdtemp, readdir, writeFile, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HistoryStore,
  defaultHistoryDirectory,
  type HistoryEventInput,
} from "../server/assistant/history";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pwb-history-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const base = (over: Partial<HistoryEventInput> = {}): HistoryEventInput => ({
  kind: "done",
  taskId: "t1",
  taskTitle: "Task",
  projectId: "p1",
  projectName: "Project",
  orchestratorId: "o1",
  orchestratorName: "Orch",
  agentId: "a1",
  attempt: 1,
  action: null,
  text: "x",
  ...over,
});
const query = (over = {}) => ({
  cursor: null,
  limit: 50,
  projectId: null,
  orchestratorId: null,
  taskId: null,
  kinds: [],
  from: null,
  to: null,
  ...over,
});
const at = (day: number, hour = 12) =>
  new Date(2026, 5, day, hour).toISOString();

describe("history store", () => {
  it("computes the default directory", () => {
    expect(defaultHistoryDirectory({ PASEO_HOME: "/x/home" })).toBe(
      "/x/home/plugin-data/power-workboard/history",
    );
    expect(defaultHistoryDirectory({ PASEO_HOME: "~/h" })).toBe(
      path.join(os.homedir(), "h", "plugin-data", "power-workboard", "history"),
    );
  });

  it("appends concurrently into day files and lists newest first", async () => {
    const store = new HistoryStore(path.join(dir, "sub"), {
      now: () => new Date(2026, 5, 10, 9),
    });
    const stored = await Promise.all(
      [1, 2, 3].map((day) =>
        store.append(base({ at: at(day), text: `d${day}` })),
      ),
    );
    expect(new Set(stored.map((event) => event.id)).size).toBe(3);
    expect((await store.append(base())).at).toBe(
      new Date(2026, 5, 10, 9).toISOString(),
    );
    expect((await readdir(path.join(dir, "sub"))).sort()).toEqual([
      "2026-06-01.jsonl",
      "2026-06-02.jsonl",
      "2026-06-03.jsonl",
      "2026-06-10.jsonl",
    ]);
    const { events, nextCursor } = await store.list(query());
    expect(events.map((event) => event.text)).toEqual(["x", "d3", "d2", "d1"]);
    expect(nextCursor).toBeNull();
  });

  it("rejects invalid events", async () => {
    const store = new HistoryStore(dir);
    await expect(
      store.append({ ...base(), kind: "nope" as never }),
    ).rejects.toThrow();
  });

  it("filters", async () => {
    const store = new HistoryStore(dir);
    await store.append(base({ at: at(1), text: "a" }));
    await store.append(
      base({ at: at(2), text: "b", projectId: "p2", kind: "merged" }),
    );
    await store.append(
      base({ at: at(3), text: "c", orchestratorId: "o2", taskId: "t2" }),
    );
    const texts = async (over: object) =>
      (await store.list(query(over))).events.map((event) => event.text);
    expect(await texts({ projectId: "p2" })).toEqual(["b"]);
    expect(await texts({ orchestratorId: "o2" })).toEqual(["c"]);
    expect(await texts({ taskId: "t2" })).toEqual(["c"]);
    expect(await texts({ kinds: ["merged"] })).toEqual(["b"]);
    expect(await texts({ from: at(2), to: at(2) })).toEqual(["b"]);
    expect(await texts({ from: at(2) })).toEqual(["c", "b"]);
    expect(await texts({ to: at(2) })).toEqual(["b", "a"]);
  });

  it("paginates with a cursor across and within days", async () => {
    const store = new HistoryStore(dir);
    for (let i = 0; i < 5; i++)
      await store.append(base({ at: at(1 + (i % 2), 8 + i), text: `e${i}` }));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<HistoryStore["list"]>> = await store.list(
        query({ limit: 2, cursor }),
      );
      seen.push(...page.events.map((event) => event.text));
      cursor = page.nextCursor;
    } while (cursor);
    // Day 2 holds e1 (9h) and e3 (11h); day 1 holds e0 (8h), e2 (10h), e4 (12h).
    expect(seen).toEqual(["e3", "e1", "e4", "e2", "e0"]);
  });

  it("skips malformed lines", async () => {
    const store = new HistoryStore(dir);
    await store.append(base({ at: at(1), text: "ok" }));
    await appendFile(
      path.join(dir, "2026-06-01.jsonl"),
      'not json\n{"kind":"done"}\n\n',
    );
    await store.append(base({ at: at(1, 13), text: "ok2" }));
    expect(
      (await store.list(query())).events.map((event) => event.text),
    ).toEqual(["ok2", "ok"]);
  });

  it("returns since oldest first", async () => {
    const store = new HistoryStore(dir);
    await store.append(base({ at: at(3), text: "c" }));
    await store.append(base({ at: at(1), text: "a" }));
    await store.append(base({ at: at(2), text: "b" }));
    expect((await store.since(at(2))).map((event) => event.text)).toEqual([
      "b",
      "c",
    ]);
  });

  it("prunes day files older than the retention", async () => {
    const store = new HistoryStore(dir, {
      now: () => new Date(2026, 5, 30, 10),
      retentionDays: 10,
    });
    await writeFile(path.join(dir, "2026-06-01.jsonl"), "");
    await writeFile(path.join(dir, "2026-06-19.jsonl"), "");
    await writeFile(path.join(dir, "2026-06-20.jsonl"), "");
    await writeFile(path.join(dir, "notes.txt"), "");
    await store.prune();
    expect((await readdir(dir)).sort()).toEqual([
      "2026-06-20.jsonl",
      "notes.txt",
    ]);
  });
});
