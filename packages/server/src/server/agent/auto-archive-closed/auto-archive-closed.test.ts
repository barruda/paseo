import { expect, test } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  createAutoArchiveClosed,
  selectAgentsToAutoArchive,
  type AutoArchiveRecord,
} from "./index.js";

const DAY = 24 * 60 * 60_000;
const NOW = 100 * DAY;

function rec(id: string, patch: Partial<AutoArchiveRecord> & { ageDays?: number } = {}) {
  const { ageDays = 3, ...rest } = patch;
  return {
    id,
    parentAgentId: null,
    archived: false,
    live: false,
    hasOpenTab: false,
    updatedAt: NOW - ageDays * DAY,
    ...rest,
  } satisfies AutoArchiveRecord;
}

test("off selects nothing", () => {
  expect(selectAgentsToAutoArchive([rec("a", { ageDays: 90 })], NOW, 0)).toEqual([]);
});

test("only agents idle for more than the threshold are selected", () => {
  const records = [
    rec("old", { ageDays: 2.5 }),
    rec("edge", { ageDays: 2 }),
    rec("new", { ageDays: 1 }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["old"]);
});

test("archived, live and open-tab agents are skipped", () => {
  const records = [
    rec("archived", { archived: true }),
    rec("live", { live: true }),
    rec("open", { hasOpenTab: true }),
    rec("ok"),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["ok"]);
});

test("a parent with a live, open or recent child is skipped, but quiet old children stand alone", () => {
  for (const child of [
    rec("c", { parentAgentId: "p", live: true }),
    rec("c", { parentAgentId: "p", hasOpenTab: true }),
    rec("c", { parentAgentId: "p", ageDays: 1 }),
  ]) {
    expect(selectAgentsToAutoArchive([rec("p"), child], NOW, 2)).toEqual([]);
  }
  const quietSibling = rec("quiet", { parentAgentId: "p" });
  const busy = rec("busy", { parentAgentId: "p", live: true });
  expect(selectAgentsToAutoArchive([rec("p"), busy, quietSibling], NOW, 2)).toEqual(["quiet"]);
});

test("a descendant two levels down blocks the root too", () => {
  const records = [
    rec("root"),
    rec("mid", { parentAgentId: "root" }),
    rec("leaf", { parentAgentId: "mid", live: true }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual([]);
});

test("an eligible parent is archived once; its old closed children ride the cascade", () => {
  const records = [
    rec("p"),
    rec("c1", { parentAgentId: "p" }),
    rec("c2", { parentAgentId: "c1", archived: false }),
    rec("done", { parentAgentId: "p", archived: true, live: true }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["p"]);
});

test("the sweep archives sequentially, reads days live and rechecks each agent", async () => {
  let days = 0;
  const archived: string[] = [];
  let active = 0;
  const auto = createAutoArchiveClosed({
    days: () => days,
    records: async () => [rec("a"), rec("b"), rec("c")],
    stillEligible: async (id) => id !== "b",
    archive: async (id) => {
      active++;
      expect(active).toBe(1);
      await Promise.resolve();
      archived.push(id);
      active--;
    },
    logger: createTestLogger(),
    now: () => NOW,
    initialDelayMs: 10 * DAY,
    intervalMs: 10 * DAY,
  });
  try {
    expect(await auto.sweep()).toBe(0);
    days = 2;
    expect(await auto.sweep()).toBe(2);
    expect(archived).toEqual(["a", "c"]);
  } finally {
    await auto.close();
  }
});
