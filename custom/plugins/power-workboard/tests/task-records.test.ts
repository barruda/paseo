// CUSTOM(task-records-jsonl): task attempts and orchestrator logs live in append-only JSONL files,
// out of the board JSON.
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attemptSchema, type Attempt } from "../shared/assistant";
import {
  dataSchema,
  newTask,
  orchestratorConfigSchema,
  orchestratorLogEntrySchema,
  type Data,
  type OrchestratorLogEntry,
} from "../shared/model";
import {
  attemptRecords,
  defaultRecordDirectory,
  directoryRecordFiles,
  foldAttempts,
  memoryRecordFiles,
  newLogEntries,
  preRecordsBackupFile,
  type RecordFiles,
} from "../server/records";
import { Store } from "../server/store";
import { Workboard } from "../server/workboard";
import { fixture } from "./fixtures";

const NOW = "2026-11-21T10:00:00.000Z";
const tempDirectory = () => mkdtempSync(join(tmpdir(), "pwb-task-records-"));

const attempt = (index: number, extra: Partial<Attempt> = {}): Attempt =>
  attemptSchema.parse({
    index,
    agentId: `agent-${index}`,
    orchestratorId: "orch",
    startedAt: NOW,
    ...extra,
  });
const entry = (text: string, at = NOW): OrchestratorLogEntry =>
  orchestratorLogEntrySchema.parse({ at, level: "info", text });

/** A backing whose saved JSON a test can read, and make fail once. */
function backing(initial: Partial<Data> = {}) {
  let saved = dataSchema.parse(initial);
  let revision = 0;
  let failNext = false;
  const backups: string[] = [];
  return {
    backups,
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
    backup: async (what: "descriptions" | "records") => {
      backups.push(what);
    },
  };
}

const orchestrator = (id: string) =>
  orchestratorConfigSchema.parse({ id, name: id });

/** Board JSON as an older version saved it: attempts and logs inside. */
function legacyData(): Partial<Data> {
  return {
    tasks: [newTask("t1", "Task", NOW)],
    orchestrators: [orchestrator("orch")],
    orchestratorLogs: { orch: [entry("one"), entry("two")] },
    assistant: {
      ...dataSchema.parse({}).assistant,
      attempts: { t1: [attempt(1, { outcome: "done" }), attempt(2)] },
    },
  };
}

describe("record helpers", () => {
  it("lives under PASEO_HOME's plugin data, with its backup beside the JSON", () => {
    expect(defaultRecordDirectory({ PASEO_HOME: "/home/x/.paseo" })).toBe(
      "/home/x/.paseo/plugin-data/power-workboard",
    );
    expect(preRecordsBackupFile("/h/s/workboard-data.json")).toBe(
      "/h/s/workboard-data.pre-records.json",
    );
  });

  it("appends only the attempts that changed, and a reset when one is gone", () => {
    const before = { t1: [attempt(1), attempt(2)] };
    expect(attemptRecords(before, structuredClone(before))).toEqual([]);
    const closed = {
      t1: [attempt(1), attempt(2, { outcome: "done" })],
      t2: [attempt(1)],
    };
    expect(attemptRecords(before, closed)).toEqual([
      { taskId: "t1", attempt: closed.t1[1] },
      { taskId: "t2", attempt: closed.t2[0] },
    ]);
    expect(attemptRecords(before, { t1: [attempt(2)] })).toEqual([
      { taskId: "t1", reset: true },
      { taskId: "t1", attempt: attempt(2) },
    ]);
    expect(attemptRecords(before, {})).toEqual([{ taskId: "t1", reset: true }]);
  });

  it("folds records with the last one winning, sorted by index", () => {
    expect(
      foldAttempts([
        { taskId: "t1", attempt: attempt(2) },
        { taskId: "t1", attempt: attempt(1) },
        { taskId: "t1", attempt: attempt(2, { outcome: "done" }) },
        { taskId: "t2", attempt: attempt(1) },
        { taskId: "t2", reset: true },
      ]),
    ).toEqual({ t1: [attempt(1), attempt(2, { outcome: "done" })] });
  });

  it("finds the new log entries after the in-memory cap dropped old ones", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((t) => entry(t));
    expect(newLogEntries([], [a, b])).toEqual([a, b]);
    expect(newLogEntries([a, b], [a, b])).toEqual([]);
    expect(newLogEntries([a, b, c], [b, c, d])).toEqual([d]);
    expect(newLogEntries([a, b], [c, d])).toEqual([c, d]);
    // Two identical lines in a row are both kept.
    expect(newLogEntries([a], [a, a])).toEqual([a]);
  });
});

describe("record files", () => {
  it("appends attempts to one file per day and folds them back", async () => {
    const directory = tempDirectory();
    let now = new Date("2026-11-20T23:00:00Z");
    const files = directoryRecordFiles(directory, () => now);
    await files.appendAttempts([{ taskId: "t1", attempt: attempt(1) }]);
    now = new Date("2026-11-21T01:00:00Z");
    await files.appendAttempts([
      { taskId: "t1", attempt: attempt(1, { outcome: "done" }) },
      { taskId: "t1", attempt: attempt(2) },
    ]);
    expect(readdirSync(join(directory, "attempts")).sort()).toEqual([
      "2026-11-20.jsonl",
      "2026-11-21.jsonl",
    ]);
    const lines = readFileSync(
      join(directory, "attempts", "2026-11-21.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      at: "2026-11-21T01:00:00.000Z",
      taskId: "t1",
    });
    expect(await files.readAttempts()).toEqual({
      t1: [attempt(1, { outcome: "done" }), attempt(2)],
    });
  });

  it("skips a line cut by a crash", async () => {
    const directory = tempDirectory();
    const files = directoryRecordFiles(directory, () => new Date(NOW));
    await files.appendAttempts([{ taskId: "t1", attempt: attempt(1) }]);
    appendFileSync(
      join(directory, "attempts", "2026-11-21.jsonl"),
      '{"at":"x","taskId":"t1","attem',
    );
    expect(await files.readAttempts()).toEqual({ t1: [attempt(1)] });
  });

  it("reads the tail of an orchestrator log and removes it", async () => {
    const directory = tempDirectory();
    const files = directoryRecordFiles(directory);
    await files.appendLogs("orch", [entry("1"), entry("2")]);
    await files.appendLogs("orch", [entry("3")]);
    expect(await files.readLogs(["orch", "none"], 2)).toEqual({
      orch: [entry("2"), entry("3")],
    });
    await files.removeLogs("orch");
    expect(existsSync(join(directory, "orchestrator-logs", "orch.jsonl"))).toBe(
      false,
    );
  });

  it("refuses an orchestrator id that could leave the folder", async () => {
    const files = directoryRecordFiles(tempDirectory());
    await expect(files.appendLogs("../x", [entry("1")])).rejects.toThrow(
      "Invalid orchestrator id",
    );
  });
});

describe("Store with record files", () => {
  it("keeps attempts and logs in memory and out of the JSON", async () => {
    const json = backing({
      tasks: [newTask("t1", "Task", NOW)],
      orchestrators: [orchestrator("orch")],
    });
    const records = memoryRecordFiles();
    const store = new Store(json, undefined, records);
    await store.load();
    await store.update((data) => {
      data.assistant.attempts.t1 = [attempt(1)];
      data.orchestratorLogs.orch = [entry("started")];
    });
    await store.update((data) => {
      data.assistant.attempts.t1[0].outcome = "done";
    });
    expect(json.saved().assistant.attempts).toEqual({});
    expect(json.saved().orchestratorLogs).toEqual({});
    expect(store.current.assistant.attempts.t1).toEqual([
      attempt(1, { outcome: "done" }),
    ]);
    expect(records.attempts).toHaveLength(2);
    expect(records.logs.get("orch")).toEqual([entry("started")]);

    const reopened = new Store(json, undefined, records);
    await reopened.load();
    expect(reopened.current.assistant.attempts).toEqual(
      store.current.assistant.attempts,
    );
    expect(reopened.current.orchestratorLogs).toEqual(
      store.current.orchestratorLogs,
    );
  });

  it("keeps in memory only the last 100 log entries, while the file keeps all", async () => {
    const json = backing({ orchestrators: [orchestrator("orch")] });
    const records = memoryRecordFiles();
    records.logs.set(
      "orch",
      Array.from({ length: 150 }, (_, i) => entry(String(i))),
    );
    const store = new Store(json, undefined, records);
    await store.load();
    const tail = store.current.orchestratorLogs.orch;
    expect(tail).toHaveLength(100);
    expect(tail[0].text).toBe("50");
    await store.update((data) => {
      data.orchestratorLogs.orch = [...tail, entry("150")].slice(-100);
    });
    expect(records.logs.get("orch")).toHaveLength(151);
  });

  it("drops attempts of tasks that left the board long ago, and keeps recent ones", async () => {
    const json = backing({ tasks: [newTask("t1", "Task", NOW)] });
    const records = memoryRecordFiles();
    const recent = new Date().toISOString();
    records.attempts.push(
      {
        taskId: "t1",
        attempt: attempt(1, { startedAt: "2020-01-01T00:00:00Z" }),
      },
      {
        taskId: "gone",
        attempt: attempt(1, { startedAt: "2020-01-01T00:00:00Z" }),
      },
      { taskId: "recent", attempt: attempt(1, { startedAt: recent }) },
    );
    const store = new Store(json, undefined, records);
    await store.load();
    expect(Object.keys(store.current.assistant.attempts).sort()).toEqual([
      "recent",
      "t1",
    ]);
    // Dropping them from memory does not erase them from the files.
    await store.update((data) => {
      data.assistant.attempts.t1.push(attempt(2));
    });
    expect(Object.keys(await records.readAttempts()).sort()).toEqual([
      "gone",
      "recent",
      "t1",
    ]);
  });

  it("deletes the log file of a deleted orchestrator", async () => {
    const json = backing({ orchestrators: [orchestrator("orch")] });
    const records = memoryRecordFiles();
    records.logs.set("orch", [entry("1")]);
    const store = new Store(json, undefined, records);
    await store.load();
    await store.update((data) => {
      data.orchestrators = [];
      delete data.orchestratorLogs.orch;
    });
    expect(records.logs.has("orch")).toBe(false);
  });

  it("keeps a kind in the JSON when its append fails, and moves it on the next start", async () => {
    const json = backing({
      tasks: [newTask("t1", "Task", NOW)],
      orchestrators: [orchestrator("orch")],
    });
    const records = memoryRecordFiles();
    const failing: RecordFiles = {
      ...records,
      appendAttempts: async () => {
        throw new Error("ENOSPC");
      },
    };
    const store = new Store(json, undefined, failing);
    await store.load();
    await store.update((data) => {
      data.assistant.attempts.t1 = [attempt(1)];
      data.orchestratorLogs.orch = [entry("started")];
    });
    expect(json.saved().assistant.attempts).toEqual({ t1: [attempt(1)] });
    expect(json.saved().orchestratorLogs).toEqual({});

    const reopened = new Store(json, undefined, records);
    await reopened.load();
    expect(reopened.hasLegacyRecords).toBe(true);
    await reopened.moveRecords();
    expect(json.saved().assistant.attempts).toEqual({});
    expect(await records.readAttempts()).toEqual({ t1: [attempt(1)] });
  });

  it("appends nothing while the attempt files cannot be read", async () => {
    const json = backing({ tasks: [newTask("t1", "Task", NOW)] });
    const records = memoryRecordFiles();
    records.attempts.push({ taskId: "t1", attempt: attempt(1) });
    const store = new Store(json, undefined, {
      ...records,
      readAttempts: async () => {
        throw new Error("EACCES");
      },
    });
    await store.load();
    expect(store.hasLegacyRecords).toBe(false);
    await store.update((data) => {
      data.assistant.attempts.t1 = [attempt(1, { agentId: "new" })];
    });
    expect(records.attempts).toHaveLength(1);
    expect(json.saved().assistant.attempts.t1[0].agentId).toBe("new");
  });
});

describe("migration of attempts and logs saved in the JSON", () => {
  it("moves them to files after a backup and clears the JSON copy", async () => {
    const json = backing(legacyData());
    const records = memoryRecordFiles();
    const store = new Store(json, undefined, records);
    await store.load();
    const before = store.current;
    expect(store.hasLegacyRecords).toBe(true);
    // An ordinary save keeps the JSON copy.
    await store.update((data) => {
      data.tasks[0].title = "Renamed";
    });
    expect(json.saved().orchestratorLogs.orch).toHaveLength(2);
    expect(records.attempts).toEqual([]);
    await store.moveRecords();
    expect(json.backups).toEqual(["records"]);
    expect(store.hasLegacyRecords).toBe(false);
    expect(json.saved().assistant.attempts).toEqual({});
    expect(json.saved().orchestratorLogs).toEqual({});
    expect(store.current.assistant.attempts).toEqual(before.assistant.attempts);
    expect(store.current.orchestratorLogs).toEqual(before.orchestratorLogs);
    expect(await records.readAttempts()).toEqual(before.assistant.attempts);
    expect(records.logs.get("orch")).toEqual(before.orchestratorLogs.orch);
  });

  it("appends nothing twice when the run is interrupted after the files", async () => {
    const json = backing(legacyData());
    const records = memoryRecordFiles();
    const store = new Store(json, undefined, records);
    await store.load();
    json.failNextWrite();
    await expect(store.moveRecords()).rejects.toThrow("daemon went away");
    // The JSON still has its copy; the files have it too.
    expect(json.saved().orchestratorLogs.orch).toHaveLength(2);
    expect(records.logs.get("orch")).toHaveLength(2);

    const again = new Store(json, undefined, records);
    await again.load();
    expect(again.current.orchestratorLogs.orch.map((e) => e.text)).toEqual([
      "one",
      "two",
    ]);
    await again.moveRecords();
    expect(records.logs.get("orch")).toHaveLength(2);
    expect(await records.readAttempts()).toEqual(
      legacyData().assistant!.attempts,
    );
    expect(json.saved().orchestratorLogs).toEqual({});
  });

  it("does not move anything when the backup fails", async () => {
    const json = {
      ...backing(legacyData()),
      backup: async () => {
        throw new Error("EACCES");
      },
    };
    const records = memoryRecordFiles();
    const store = new Store(json, undefined, records);
    await store.load();
    await expect(store.moveRecords()).rejects.toThrow("EACCES");
    expect(records.attempts).toEqual([]);
    expect(json.saved().orchestratorLogs.orch).toHaveLength(2);
  });

  it("runs when the board starts, and the orchestrator log and attempts read the same", async () => {
    const setup = fixture({ defaultOrchestratorSeeded: true, ...legacyData() });
    const board = new Workboard(setup.host, setup.store, () => Date.parse(NOW));
    await board.start();
    try {
      const saved = (await setup.backing.read()).values;
      expect(saved.assistant.attempts).toEqual({});
      expect(saved.orchestratorLogs).toEqual({});
      expect(board.snapshot().orchestratorLogs.orch.map((e) => e.text)).toEqual(
        ["one", "two"],
      );
      expect(setup.store.current.assistant.attempts).toEqual(
        legacyData().assistant!.attempts,
      );
    } finally {
      board.dispose();
    }
    // A restart reads them back from the files.
    const reopened = new Store(setup.backing);
    const again = new Workboard(setup.host, reopened, () => Date.parse(NOW));
    await again.start();
    try {
      expect(again.snapshot().orchestratorLogs.orch.map((e) => e.text)).toEqual(
        ["one", "two"],
      );
      expect(reopened.current.assistant.attempts).toEqual(
        legacyData().assistant!.attempts,
      );
    } finally {
      again.dispose();
    }
  });
});
