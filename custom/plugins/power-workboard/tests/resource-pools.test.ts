import { expect, it, vi } from "vitest";
import {
  RAM_SETTLE_MS,
  Workboard,
  type AssistantOptions,
} from "../server/workboard";
import { parseMeminfo, type MemoryReading } from "../server/resources";
import {
  cardsForStage,
  dataSchema,
  orchestratorConfigSchema,
} from "../shared/model";
import { FIX_WAIT_LIMIT_MS, assistantDataSchema } from "../shared/assistant";
import {
  firstDisabledWarning,
  holdSummary,
  projectRole,
} from "../client/Orchestrators";
import {
  fixHoldText,
  fixWaitedText,
} from "../client/assistant/dashboard-strings";
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

function setup(
  initial: Parameters<typeof fixture>[0] = {},
  options: AssistantOptions = {},
) {
  const base = fixture(initial);
  base.inventory.projects.push(...projects);
  let now = Date.parse("2026-11-18T12:00:00.000Z");
  const memory: { reading: MemoryReading | null } = {
    reading: { availableBytes: 30 * GiB, totalBytes: 60 * GiB },
  };
  const board = new Workboard(base.host, base.store, () => now, 60_000, {
    memory: async () => memory.reading,
    ...options,
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
    schemaVersion: 10,
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
    until: null,
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

// Review follow-ups (task 77c52211).

const running = (s: Setup) =>
  Object.values(s.board.snapshot().orchestrations).filter(
    (r) => r.status === "starting" || r.status === "running",
  ).length;

it("a pool with a RAM floor starts one agent, then waits for the RAM to settle", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 2, minFreeRamPercent: 20 },
    ]);
    const pooled = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
      maxConcurrent: 2,
    });
    await create(s, "P1", "p");
    await create(s, "P2", "p");
    // 50% free is well above the floor, but the first agent's Unity doesn't show yet.
    expect(running(s)).toBe(1);
    const hold = s.board.snapshot().orchestratorStatus[pooled]?.hold;
    expect(hold).toMatchObject({ kind: "settle", poolId: "unity" });
    const startedAt =
      s.board.snapshot().orchestrations[card(s.board, "P1").id]!.startedAt;
    expect(hold?.kind === "settle" ? hold.until : null).toBe(
      new Date(Date.parse(startedAt) + RAM_SETTLE_MS).toISOString(),
    );
    // Routine: the settle wait is in the status, not in the log.
    expect(
      logOf(s.board, pooled).filter((t) => t.startsWith("Waiting")),
    ).toEqual([]);
    s.advance(RAM_SETTLE_MS - 2000);
    await s.board.refresh();
    expect(running(s)).toBe(1);
    // The first agent took RAM meanwhile: the floor holds now.
    s.memory.reading = { availableBytes: 9 * GiB, totalBytes: 60 * GiB };
    s.advance(5000);
    await s.board.refresh();
    expect(running(s)).toBe(1);
    expect(s.board.snapshot().orchestratorStatus[pooled]?.hold).toMatchObject({
      kind: "ram",
      freeRamPercent: 15,
    });
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(running(s)).toBe(2);
  } finally {
    s.board.dispose();
  }
});

it("a pool without a RAM floor starts all its free slots at once", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    await savePools(s.board, [{ id: "gpu", name: "GPU", maxConcurrent: 2 }]);
    await addOrchestrator(s.board, { projectId: "p", poolId: "gpu" });
    await addOrchestrator(s.board, { projectId: "q", poolId: "gpu" });
    await create(s, "P1", "p");
    await create(s, "Q1", "q");
    expect(running(s)).toBe(2);
  } finally {
    s.board.dispose();
  }
});

it("the status shows a hold only when the orchestrator would take the task now, with the RAM of now", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 1, minFreeRamPercent: 20 },
    ]);
    const manual = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
      schedule: { kind: "manual" },
    });
    const windowed = await addOrchestrator(s.board, {
      projectId: "q",
      poolId: "unity",
    });
    await create(s, "In p", "p");
    await create(s, "In q", "q");
    const status = () => s.board.snapshot().orchestratorStatus;
    // Manual without a run: its task waits for Run now, not for the pool.
    expect(status()[manual]).toMatchObject({ waiting: 1, hold: null });
    expect(status()[windowed]?.hold).toMatchObject({
      kind: "ram",
      freeRamPercent: 10,
    });
    // The snapshot RPC rereads the RAM; the status follows without a pass.
    s.memory.reading = { availableBytes: 9 * GiB, totalBytes: 60 * GiB };
    await s.board.readPoolMemory();
    expect(status()[windowed]?.hold).toMatchObject({
      kind: "ram",
      freeRamPercent: 15,
    });
  } finally {
    s.board.dispose();
  }
});

it("a pool's free slot goes to the top card of the column, whichever orchestrator owns it", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 1, minFreeRamPercent: 20 },
    ]);
    await addOrchestrator(s.board, { projectId: "p", poolId: "unity" });
    const second = await addOrchestrator(s.board, {
      projectId: "q",
      poolId: "unity",
    });
    await create(s, "P1", "p");
    await create(s, "Q1", "q");
    const board = s.board.snapshot();
    const top = cardsForStage(board.cards, "ready", board.cardOrderByStage)[0]!;
    expect(top.title).toBe("Q1");
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(running(s)).toBe(1);
    expect(runBy(s.board, "Q1")).toBe(second);
    expect(runBy(s.board, "P1")).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a second orchestrator of the same project doesn't take the task the pool holds back", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", minFreeRamPercent: 20 },
    ]);
    const first = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
    });
    const second = await addOrchestrator(s.board, { projectId: "p" });
    await create(s, "In p", "p");
    expect(runBy(s.board, "In p")).toBeNull();
    expect(s.board.snapshot().orchestratorStatus[second]?.waiting).toBe(0);
    // A task chosen for the second one is still its own.
    s.advance(1000);
    await s.board.mutate({
      action: "create",
      title: "Chosen",
      description: "Do it",
      projectId: "p",
      orchestratorId: second,
      stage: "ready",
    } as never);
    expect(runBy(s.board, "Chosen")).toBe(second);
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(runBy(s.board, "In p")).toBe(first);
  } finally {
    s.board.dispose();
  }
});

const report = `Did it.\n<report>${JSON.stringify({ status: "done", summary: "Added X" })}</report>`;

/** A board whose project "p" merges after `npm test`, with one fix allowed. */
function mergeSetup(verify: AssistantOptions["verify"]) {
  const s = setup(
    {
      defaultOrchestratorSeeded: true,
      assistant: assistantDataSchema.parse({
        settings: {
          projects: {
            p: { action: "merge", verifyCommand: "npm test", autoFixes: 1 },
          },
        },
      }),
    },
    { verify },
  );
  (s.host.lastReply as any).mockResolvedValue(report);
  const agentOf = (title: string) =>
    s.inventory.agents.find(
      (a) => a.workspaceId === card(s.board, title).workspaceId,
    )!;
  const makeGit = (title: string) =>
    (s.inventory.workspaces.find(
      (w) => w.id === card(s.board, title).workspaceId,
    )!.projectKind = "git");
  const delivery = (title: string) =>
    s.store.current.assistant.deliveries[card(s.board, title).id];
  const sentTo = () =>
    (s.host.sendAgent as any).mock.calls.map((call: unknown[]) => call[0]);
  return { ...s, agentOf, makeGit, delivery, sentTo };
}
const failOnce = () =>
  vi
    .fn<NonNullable<AssistantOptions["verify"]>>()
    .mockResolvedValueOnce({ passed: false, output: "1 test failed" })
    .mockResolvedValue({ passed: true, output: "ok" });

it("without a pool a failed check goes back to the agent at once, even with tasks in Ready", async () => {
  const s = mergeSetup(failOnce());
  await s.board.start();
  try {
    const own = await addOrchestrator(s.board, {
      projectId: "p",
      maxConcurrent: 1,
    });
    await create(s, "A", "p");
    await create(s, "B", "p");
    await create(s, "C", "p");
    const agentA = s.agentOf("A");
    s.makeGit("A");
    await finish(s, "A");
    // A's slot went to the next card in the same pass, as before the pools.
    expect(runBy(s.board, "B") ?? runBy(s.board, "C")).toBe(own);
    await vi.waitFor(() => expect(s.sentTo()).toContain(agentA.id));
    expect(s.delivery("A")).toMatchObject({ stage: "fixing", fixesUsed: 1 });
    expect(s.delivery("A")?.queuedFix ?? null).toBeNull();
    expect(
      s.board.snapshot().orchestrations[card(s.board, "A").id],
    ).toMatchObject({ status: "running" });
  } finally {
    s.board.dispose();
  }
});

it("in a pool the delivering task keeps its slot, and its fix waits only for the RAM", async () => {
  const s = mergeSetup(failOnce());
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 1, minFreeRamPercent: 20 },
    ]);
    const own = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
      maxConcurrent: 2,
    });
    await create(s, "A", "p");
    await create(s, "B", "p");
    expect(runBy(s.board, "A")).toBe(own);
    expect(runBy(s.board, "B")).toBeNull();
    const agentA = s.agentOf("A");
    s.makeGit("A");
    // A's agent took the RAM: its failed check can't wake it yet.
    s.advance(RAM_SETTLE_MS);
    s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
    await finish(s, "A");
    await vi.waitFor(() =>
      expect(s.delivery("A")?.queuedFix).toMatchObject({
        reason: "verify-failed",
      }),
    );
    expect(s.delivery("A")).toMatchObject({
      stage: "fixing",
      fixesUsed: 1,
      detail: 'Waiting for RAM: 10% free, pool "Unity" needs 20%',
    });
    expect(s.sentTo()).not.toContain(agentA.id);
    // The slot stays A's: B doesn't take it while A's fix waits.
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(s.sentTo()).toContain(agentA.id);
    expect(runBy(s.board, "B")).toBeNull();
    expect(s.delivery("A")).toMatchObject({
      stage: "fixing",
      queuedFix: null,
      detail: null,
    });
    expect(
      s.board.snapshot().orchestrations[card(s.board, "A").id],
    ).toMatchObject({ status: "running" });
    expect(logOf(s.board, own)).toContain('Sent the waiting fix to "A"');
  } finally {
    s.board.dispose();
  }
});

it("in a pool a new task doesn't take the slot of a task whose check is running", async () => {
  let checked!: (result: { passed: boolean; output: string }) => void;
  const verify = vi.fn<NonNullable<AssistantOptions["verify"]>>(
    () => new Promise((resolve) => (checked = resolve)),
  );
  const s = mergeSetup(verify);
  await s.board.start();
  try {
    await savePools(s.board, [
      { id: "unity", name: "Unity", maxConcurrent: 1 },
    ]);
    const own = await addOrchestrator(s.board, {
      projectId: "p",
      poolId: "unity",
      maxConcurrent: 2,
    });
    await create(s, "A", "p");
    await create(s, "B", "p");
    const agentA = s.agentOf("A");
    s.makeGit("A");
    await finish(s, "A");
    await vi.waitFor(() => expect(verify).toHaveBeenCalled());
    expect(s.delivery("A")?.stage).toBe("verifying");
    await s.board.refresh();
    expect(runBy(s.board, "B")).toBeNull();
    expect(s.board.snapshot().orchestratorStatus[own]?.hold).toMatchObject({
      kind: "pool",
      running: 1,
    });
    // The check fails: the fix goes at once, on the slot A kept.
    checked({ passed: false, output: "1 test failed" });
    await vi.waitFor(() => expect(s.sentTo()).toContain(agentA.id));
    expect(s.delivery("A")?.queuedFix ?? null).toBeNull();
    await s.board.refresh();
    expect(runBy(s.board, "B")).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a finished task's agent takes a slot only while it is in a turn", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    const own = await addOrchestrator(s.board, {
      projectId: "p",
      maxConcurrent: 1,
    });
    await create(s, "A", "p");
    await finish(s, "A");
    expect(
      s.board.snapshot().orchestrations[card(s.board, "A").id]?.status,
    ).toBe("finished");
    const agentA = s.inventory.agents.find(
      (a) => a.workspaceId === card(s.board, "A").workspaceId,
    )!;
    await s.board.assistantAction({
      type: "send",
      agentId: agentA.id,
      text: "One more thing",
    });
    expect(agentA.activity).toBe("running");
    await s.board.refresh(); // Paseo reports the agent running
    await create(s, "B", "p");
    expect(runBy(s.board, "B")).toBeNull();
    expect(s.board.snapshot().orchestratorStatus[own]?.running).toBe(1);
    // Running only because of background work: no turn, no slot.
    agentA.turnActive = false;
    await s.board.refresh();
    expect(s.board.snapshot().orchestratorStatus[own]?.running).toBe(1); // B
    expect(runBy(s.board, "B")).toBe(own);
  } finally {
    s.board.dispose();
  }
});

it("a finished task's agent waiting on a permission doesn't hold the slot", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    const own = await addOrchestrator(s.board, {
      projectId: "p",
      maxConcurrent: 1,
    });
    await create(s, "A", "p");
    await finish(s, "A");
    const agentA = s.inventory.agents.find(
      (a) => a.workspaceId === card(s.board, "A").workspaceId,
    )!;
    agentA.activity = "waiting";
    await s.board.refresh();
    await create(s, "B", "p");
    expect(runBy(s.board, "B")).toBe(own);
  } finally {
    s.board.dispose();
  }
});

// Low-severity follow-ups of review e7e2730a.

/** A board in a pool with a RAM floor whose task "A" has a fix queued for RAM. */
async function queuedFixSetup() {
  const s = mergeSetup(failOnce());
  await s.board.start();
  await savePools(s.board, [
    { id: "unity", name: "Unity", maxConcurrent: 1, minFreeRamPercent: 20 },
  ]);
  const own = await addOrchestrator(s.board, {
    projectId: "p",
    poolId: "unity",
    maxConcurrent: 2,
  });
  await create(s, "A", "p");
  const agentA = s.agentOf("A");
  s.makeGit("A");
  s.advance(RAM_SETTLE_MS);
  s.memory.reading = { availableBytes: 6 * GiB, totalBytes: 60 * GiB };
  await finish(s, "A");
  await vi.waitFor(() =>
    expect(s.delivery("A")?.queuedFix).toMatchObject({
      reason: "verify-failed",
    }),
  );
  return { ...s, own, agentA };
}
const lastAttempt = (s: Setup, title: string) =>
  s.store.current.assistant.attempts[card(s.board, title).id]?.at(-1);

it("a fix that waits 30 minutes for a slot goes to Needs you and still goes when one frees", async () => {
  const s = await queuedFixSetup();
  try {
    expect(s.delivery("A")?.queuedFix).toMatchObject({
      since: expect.any(String),
      hold: { kind: "ram", poolName: "Unity", freeRamPercent: 10 },
    });
    s.advance(FIX_WAIT_LIMIT_MS - 60_000);
    await s.board.refresh();
    expect(s.delivery("A")?.stage).toBe("fixing");
    s.advance(60_000);
    await s.board.refresh();
    expect(s.delivery("A")).toMatchObject({
      stage: "needs-you",
      reason: "fix-waiting",
      queuedFix: { reason: "verify-failed" },
    });
    expect(s.delivery("A")?.detail).toContain("waited 30 minutes");
    expect(s.delivery("A")?.detail).toContain('pool "Unity" needs 20%');
    // On Needs you the hold stays current and the card keeps its age.
    const since = s.delivery("A")!.updatedAt;
    s.memory.reading = { availableBytes: 9 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(s.delivery("A")?.queuedFix?.hold).toMatchObject({
      kind: "ram",
      freeRamPercent: 15,
    });
    expect(s.delivery("A")?.updatedAt).toBe(since);
    expect(s.sentTo()).not.toContain(s.agentA.id);
    // A's fix still holds its pool slot: a new task waits for the pool, not only for the RAM.
    await create(s, "B", "p");
    expect(s.board.snapshot().orchestratorStatus[s.own]?.hold).toMatchObject({
      kind: "pool",
      running: 1,
    });
    // RAM frees: the fix goes, and the delivery is back in fixing.
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(s.sentTo()).toContain(s.agentA.id);
    expect(s.delivery("A")).toMatchObject({
      stage: "fixing",
      reason: null,
      queuedFix: null,
      detail: null,
    });
    expect(lastAttempt(s, "A")).toMatchObject({
      trigger: "auto-fix",
      finishedAt: null,
    });
    expect(runBy(s.board, "B")).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a queued fix the user overtakes is dropped and its attempt closed", async () => {
  const s = await queuedFixSetup();
  try {
    expect(lastAttempt(s, "A")).toMatchObject({
      trigger: "auto-fix",
      finishedAt: null,
    });
    await s.board.assistantAction({
      type: "dismiss",
      taskId: card(s.board, "A").id,
    });
    await s.board.refresh();
    expect(s.delivery("A")).toMatchObject({
      stage: "dismissed",
      queuedFix: null,
    });
    expect(lastAttempt(s, "A")).toMatchObject({
      trigger: "auto-fix",
      outcome: "dropped",
      finishedAt: expect.any(String),
    });
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(s.sentTo()).not.toContain(s.agentA.id);
  } finally {
    s.board.dispose();
  }
});

it("a queued fix whose agent can't be reached closes its attempt and goes to Needs you", async () => {
  const s = await queuedFixSetup();
  try {
    (s.host.sendAgent as any).mockRejectedValueOnce(new Error("Agent gone"));
    s.memory.reading = { availableBytes: 30 * GiB, totalBytes: 60 * GiB };
    await s.board.refresh();
    expect(s.delivery("A")).toMatchObject({
      stage: "needs-you",
      reason: "verify-failed",
      detail: "Agent gone",
      queuedFix: null,
    });
    expect(lastAttempt(s, "A")).toMatchObject({
      trigger: "auto-fix",
      outcome: "agent-error",
    });
  } finally {
    s.board.dispose();
  }
});

it("moving an orchestrator up makes it the project's first, which takes the unassigned tasks", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    const first = await addOrchestrator(s.board, { projectId: "p" });
    const other = await addOrchestrator(s.board, { projectId: "q" });
    const second = await addOrchestrator(s.board, { projectId: "p" });
    await s.board.mutate({
      action: "orchestrator-enable",
      id: first,
      enabled: false,
    });
    await create(s, "In p", "p");
    expect(runBy(s.board, "In p")).toBeNull();
    const en = strings("en");
    const config = (id: string) =>
      s.board.snapshot().orchestrators.find((o) => o.id === id)!;
    const list = () => s.board.snapshot().orchestrators;
    expect(projectRole(list(), config(first))).toBe("first");
    expect(projectRole(list(), config(second))).toBe("other");
    expect(projectRole(list(), config(other))).toBeNull();
    expect(firstDisabledWarning(s.board.snapshot(), config(first), en)).toBe(
      "Disabled, and tasks of Project p wait for it (1): the project's other orchestrators won't take them. Enable it, or move another orchestrator above it.",
    );
    expect(
      firstDisabledWarning(s.board.snapshot(), config(second), en),
    ).toBeNull();
    // At the top or bottom a move does nothing.
    await s.board.mutate({
      action: "orchestrator-move",
      id: list()[0]!.id,
      direction: "up",
    });
    expect(list().map((o) => o.id)).toEqual([first, other, second]);
    await s.board.mutate({
      action: "orchestrator-move",
      id: second,
      direction: "up",
    });
    expect(list().map((o) => o.id)).toEqual([first, second, other]);
    expect(runBy(s.board, "In p")).toBeNull();
    await s.board.mutate({
      action: "orchestrator-move",
      id: second,
      direction: "up",
    });
    expect(list().map((o) => o.id)).toEqual([second, first, other]);
    expect(projectRole(list(), config(second))).toBe("first");
    expect(runBy(s.board, "In p")).toBe(second);
    await s.board.mutate({
      action: "orchestrator-move",
      id: other,
      direction: "down",
    });
    expect(list().map((o) => o.id)).toEqual([second, first, other]);
  } finally {
    s.board.dispose();
  }
});

it("the waiting fix texts speak English and Brazilian Portuguese", () => {
  const hold = {
    kind: "ram" as const,
    poolId: "u",
    poolName: "Unity",
    running: 1,
    maxConcurrent: 1,
    freeRamPercent: 12,
    minFreeRamPercent: 20,
    until: null,
  };
  expect(fixHoldText(hold, "en")).toBe(
    "Fix waiting for RAM: 12% free, pool “Unity” needs 20%",
  );
  expect(fixHoldText(hold, "pt")).toBe(
    "Correção esperando RAM: 12% livre, o pool “Unity” pede 20%",
  );
  expect(fixHoldText({ ...hold, kind: "pool" }, "pt")).toBe(
    "Correção esperando: o pool “Unity” está cheio (1/1)",
  );
  expect(fixHoldText({ ...hold, kind: "pool" }, "zh")).toBe(
    "Fix waiting: pool “Unity” is full (1/1)",
  );
  expect(fixWaitedText(hold, "pt")).toContain("há mais de 30 minutos");
  expect(fixWaitedText(hold, "pt")).toContain("o pool “Unity” pede 20%");
  expect(fixWaitedText(null, "en")).toContain("over 30 minutes");
});
