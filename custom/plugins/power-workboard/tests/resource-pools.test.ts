import { expect, it } from "vitest";
import { Workboard } from "../server/workboard";
import { parseMeminfo, type MemoryReading } from "../server/resources";
import { dataSchema, orchestratorConfigSchema } from "../shared/model";
import { holdSummary } from "../client/Orchestrators";
import { strings } from "../client/strings";
import { fixture } from "./fixtures";

// CUSTOM(resource-pools): project orchestrators first, pools shared by orchestrators, a RAM floor.

const projects = ["p", "q", "r"].map((id) => ({
  id,
  name: `Project ${id}`,
  directory: `/fixture/${id}`,
  isGit: false,
}));
const GiB = 1024 ** 3;
const always = { kind: "window", start: "00:00", end: "00:00" } as const;

function setup(initial: Parameters<typeof fixture>[0] = {}) {
  const base = fixture(initial);
  base.inventory.projects.push(...projects);
  let now = Date.parse("2026-11-18T12:00:00.000Z");
  const memory: { reading: MemoryReading | null } = {
    reading: { availableBytes: 30 * GiB, totalBytes: 60 * GiB },
  };
  const board = new Workboard(base.host, base.store, () => now, 60_000, {
    memory: async () => memory.reading,
  });
  return {
    ...base,
    board,
    memory,
    advance: (ms: number) => (now += ms),
  };
}
type Setup = ReturnType<typeof setup>;
async function addOrchestrator(
  board: Workboard,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const before = new Set(board.snapshot().orchestrators.map((o) => o.id));
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Orchestrator",
      schedule: always,
      ...overrides,
    }),
  });
  return board.snapshot().orchestrators.find((o) => !before.has(o.id))!.id;
}
async function create(s: Setup, title: string, projectId: string) {
  s.advance(1000);
  await s.board.mutate({
    action: "create",
    title,
    description: `Do ${title}`,
    projectId,
    stage: "ready",
  });
}
const card = (board: Workboard, title: string) =>
  board.snapshot().cards.find((c) => c.title === title)!;
const runBy = (board: Workboard, title: string) =>
  board.snapshot().orchestrations[card(board, title).id]?.orchestratorId ??
  null;
const logOf = (board: Workboard, id: string) =>
  (board.snapshot().orchestratorLogs[id] ?? []).map((entry) => entry.text);
/** Let the task's agent end its turn and stay idle past the settle window. */
async function finish(s: Setup, title: string) {
  const { workspaceId } = card(s.board, title);
  await s.board.refresh();
  s.inventory.agents.find((a) => a.workspaceId === workspaceId)!.activity =
    "idle";
  s.advance(1000);
  await s.board.refresh();
  s.advance(21_000);
  await s.board.refresh();
}
async function savePools(board: Workboard, pools: unknown[]) {
  await board.mutate({ action: "pools-save", pools } as never);
}

it("a project's task goes to its own orchestrator even with the general Default on", async () => {
  const s = setup();
  await s.board.start();
  try {
    const [general] = s.board.snapshot().orchestrators;
    expect(general).toMatchObject({ name: "Default", projectId: null });
    const own = await addOrchestrator(s.board, { name: "P", projectId: "p" });
    await create(s, "In p", "p");
    await create(s, "In q", "q");
    expect(runBy(s.board, "In p")).toBe(own);
    expect(runBy(s.board, "In q")).toBe(general!.id);
  } finally {
    s.board.dispose();
  }
});

it("a disabled project orchestrator still keeps its tasks from the general one", async () => {
  const s = setup();
  await s.board.start();
  try {
    const own = await addOrchestrator(s.board, { projectId: "p" });
    await s.board.mutate({
      action: "orchestrator-enable",
      id: own,
      enabled: false,
    });
    await create(s, "In p", "p");
    expect(runBy(s.board, "In p")).toBeNull();
    expect(card(s.board, "In p").stage).toBe("ready");
    expect(s.board.snapshot().orchestratorStatus[own]?.waiting).toBe(1);
  } finally {
    s.board.dispose();
  }
});

it("two orchestrators in a pool with one slot never run two tasks together", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 1 },
    ]);
    const first = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
    });
    const second = await addOrchestrator(s.board, {
      projectId: "q",
      poolId: "unity",
    });
    await create(s, "P1", "p");
    await create(s, "Q1", "q");
    await create(s, "P2", "p");
    const running = () =>
      Object.values(s.board.snapshot().orchestrations).filter(
        (r) => r.status === "starting" || r.status === "running",
      ).length;
    expect(running()).toBe(1);
    expect(runBy(s.board, "P1")).toBe(first);
    expect(s.board.snapshot().orchestratorStatus[second]?.hold).toMatchObject({
      kind: "pool",
      poolId: "unity",
      running: 1,
      maxConcurrent: 1,
    });
    expect(logOf(s.board, second)).toContain(
      'Waiting: pool "Unity" is full (1/1)',
    );
    await s.board.refresh();
    expect(running()).toBe(1);
    // A long wait logs once.
    expect(
      logOf(s.board, second).filter((t) => t.startsWith("Waiting")),
    ).toHaveLength(1);
    await finish(s, "P1");
    expect(running()).toBe(1);
    expect(runBy(s.board, "Q1") ?? runBy(s.board, "P2")).not.toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("below the pool's RAM floor nothing of the pool starts, and the status says so", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 2, minFreeRamPercent: 20 },
    ]);
    const pooled = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
    });
    const free = await addOrchestrator(s.board, { projectId: "q" });
    await create(s, "Heavy", "p");
    await create(s, "Light", "q");
    expect(runBy(s.board, "Heavy")).toBeNull();
    expect(runBy(s.board, "Light")).toBe(free);
    expect(s.board.snapshot().orchestratorStatus[pooled]?.hold).toMatchObject({
      kind: "ram",
      freeRamPercent: 10,
      minFreeRamPercent: 20,
    });
    expect(logOf(s.board, pooled)).toContain(
      'Waiting for RAM: 10% free, pool "Unity" needs 20%',
    );
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(runBy(s.board, "Heavy")).toBe(pooled);
    expect(s.board.snapshot().orchestratorStatus[pooled]?.hold).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("an unreadable RAM never holds the pool", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  s.memory.reading = null;
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", minFreeRamPercent: 50 },
    ]);
    const pooled = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
    });
    await create(s, "Heavy", "p");
    expect(runBy(s.board, "Heavy")).toBe(pooled);
  } finally {
    s.board.dispose();
  }
});

it("removing a pool frees its orchestrators; an unknown pool is refused", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    await savePools(s.board, [{ id: "unity", name: "Unity" }]);
    const id = await addOrchestrator(s.board, { poolId: "unity" });
    await savePools(s.board, []);
    expect(
      s.board.snapshot().orchestrators.find((o) => o.id === id)?.poolId,
    ).toBeNull();
    await expect(
      s.board.mutate({
        action: "orchestrator-save",
        orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
          name: "Ghost",
          poolId: "gone",
        }),
      }),
    ).rejects.toThrow("Pool no longer exists");
  } finally {
    s.board.dispose();
  }
});

it("saving the board settings keeps the pools", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    await savePools(s.board, [{ id: "unity", name: "Unity" }]);
    const board = s.board.snapshot();
    await s.board.mutate({
      action: "settings",
      revision: board.revision,
      expectedSettings: board.settings,
      settings: { ...board.settings, pools: [] },
    });
    expect(s.board.snapshot().settings.pools).toEqual([
      { id: "unity", name: "Unity", maxConcurrent: 1, minFreeRamPercent: null },
    ]);
  } finally {
    s.board.dispose();
  }
});

it("stored data from before the pools keeps its orchestrators", () => {
  const stored = {
    schemaVersion: 9,
    settings: { autoArchive: true },
    orchestrators: [
      { id: "a", name: "Default", projectId: null },
      { id: "b", name: "DreamMMO", projectId: "p", maxConcurrent: 1 },
    ],
  };
  const data = dataSchema.parse(stored);
  expect(data.settings.pools).toEqual([]);
  expect(data.orchestrators.map((o) => [o.id, o.name, o.poolId])).toEqual([
    ["a", "Default", null],
    ["b", "DreamMMO", null],
  ]);
  expect(data.orchestrators[1]?.maxConcurrent).toBe(1);
});

it("reads MemAvailable and MemTotal from /proc/meminfo", () => {
  expect(
    parseMeminfo(
      "MemTotal:       64000000 kB\nMemFree:  1000 kB\nMemAvailable:   16000000 kB\n",
    ),
  ).toEqual({ availableBytes: 16000000 * 1024, totalBytes: 64000000 * 1024 });
  expect(parseMeminfo("MemTotal: 1000 kB\n")).toBeNull();
});

it("formats the reason an orchestrator's tasks wait", () => {
  const hold = {
    poolId: "u",
    poolName: "Unity",
    running: 1,
    maxConcurrent: 1,
    freeRamPercent: 12,
    minFreeRamPercent: 20,
  };
  for (const language of ["en", "zh"] as const) {
    const t = strings(language);
    expect(holdSummary(null, t)).toBeNull();
    expect(holdSummary(undefined, t)).toBeNull();
    expect(holdSummary({ ...hold, kind: "pool" }, t)).toContain("1/1");
  }
  const en = strings("en");
  expect(holdSummary({ ...hold, kind: "pool" }, en)).toBe(
    "Waiting: pool “Unity” is full (1/1)",
  );
  expect(holdSummary({ ...hold, kind: "ram" }, en)).toBe(
    "Waiting for RAM: 12% free, pool “Unity” needs 20%",
  );
  expect(holdSummary({ ...hold, kind: "ram", freeRamPercent: null }, en)).toBe(
    "Waiting for RAM: ?% free, pool “Unity” needs 20%",
  );
});
