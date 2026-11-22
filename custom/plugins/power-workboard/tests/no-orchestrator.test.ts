import { afterEach, expect, it, vi } from "vitest";
import { Workboard } from "../server/workboard";
import { chatTools, NO_ORCHESTRATOR } from "../server/assistant/chat";
import { orchestratorConfigSchema } from "../shared/model";
import { noOrchestratorText } from "../client/board-utils";
import { strings } from "../client/strings";
import { fixture } from "./fixtures";
import { boot, disposeBooted, startTask } from "./factory-boot";

// CUSTOM(no-orchestrator-warning): a Ready to start task that no enabled orchestrator takes.

const projects = ["p", "q"].map((id) => ({
  id,
  name: `Project ${id}`,
  directory: `/fixture/${id}`,
  isGit: false,
}));

function setup() {
  // No seeded Default: the board starts with no orchestrator at all.
  const base = fixture({ defaultOrchestratorSeeded: true });
  base.inventory.projects.push(...projects);
  let now = Date.parse("2026-11-22T12:00:00.000Z");
  const board = new Workboard(base.host, base.store, () => now, 60_000);
  return { ...base, board, advance: (ms: number) => (now += ms) };
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
      // Manual: it takes the task only on Run now, so the card stays in Ready to start.
      schedule: { kind: "manual" },
      ...overrides,
    }),
  });
  return board.snapshot().orchestrators.find((o) => !before.has(o.id))!.id;
}
async function create(
  s: Setup,
  title: string,
  projectId: string,
  extra: Record<string, unknown> = {},
) {
  s.advance(1000);
  await s.board.mutate({
    action: "create",
    title,
    description: `Do ${title}`,
    projectId,
    stage: "ready",
    ...extra,
  } as never);
  return card(s.board, title).id;
}
const card = (board: Workboard, title: string) =>
  board.snapshot().cards.find((c) => c.title === title)!;
const flagged = (board: Workboard, title: string) =>
  card(board, title).noOrchestrator;

afterEach(() => disposeBooted());

it("a Ready to start task of a project without an orchestrator carries the warning", async () => {
  const s = setup();
  await s.board.start();
  try {
    await create(s, "Stuck", "p");
    await create(s, "Later", "p", { stage: "backlog" });
    expect(card(s.board, "Stuck").stage).toBe("ready");
    expect(flagged(s.board, "Stuck")).toBe(true);
    // Only Ready to start warns.
    expect(flagged(s.board, "Later")).toBe(false);
  } finally {
    s.board.dispose();
  }
});

it("an enabled orchestrator of the project, or a general one, clears the warning without a reload", async () => {
  const s = setup();
  await s.board.start();
  try {
    await create(s, "Stuck", "p");
    expect(flagged(s.board, "Stuck")).toBe(true);
    await addOrchestrator(s.board, { name: "P", projectId: "p" });
    expect(flagged(s.board, "Stuck")).toBe(false);

    const t = setup();
    await t.board.start();
    try {
      await create(t, "Stuck", "q");
      await addOrchestrator(t.board, { name: "All", projectId: null });
      expect(flagged(t.board, "Stuck")).toBe(false);
    } finally {
      t.board.dispose();
    }
  } finally {
    s.board.dispose();
  }
});

it("a disabled orchestrator, or one whose scope leaves the project, warns", async () => {
  const s = setup();
  await s.board.start();
  try {
    await create(s, "Stuck", "p");
    const id = await addOrchestrator(s.board, { name: "P", projectId: "p" });
    expect(flagged(s.board, "Stuck")).toBe(false);

    await s.board.mutate({
      action: "orchestrator-enable",
      id,
      enabled: false,
    } as never);
    expect(flagged(s.board, "Stuck")).toBe(true);
    // A general orchestrator doesn't take tasks of a project that has its own, even when that
    // one is off: the task still waits.
    await addOrchestrator(s.board, { name: "All", projectId: null });
    expect(flagged(s.board, "Stuck")).toBe(true);

    await s.board.mutate({
      action: "orchestrator-enable",
      id,
      enabled: true,
    } as never);
    expect(flagged(s.board, "Stuck")).toBe(false);

    const saved = s.board.snapshot().orchestrators.find((o) => o.id === id)!;
    await s.board.mutate({
      action: "orchestrator-save",
      orchestrator: { ...saved, projectId: "q" },
    });
    // The general one takes p now that p has no orchestrator of its own.
    expect(flagged(s.board, "Stuck")).toBe(false);
    const general = s.board
      .snapshot()
      .orchestrators.find((o) => o.projectId === null)!;
    await s.board.mutate({
      action: "orchestrator-enable",
      id: general.id,
      enabled: false,
    } as never);
    expect(flagged(s.board, "Stuck")).toBe(true);
  } finally {
    s.board.dispose();
  }
});

it("a task chosen for an enabled orchestrator has no warning, even outside its scope", async () => {
  const s = setup();
  await s.board.start();
  try {
    const q = await addOrchestrator(s.board, { name: "Q", projectId: "q" });
    await create(s, "Pinned", "p", { orchestratorId: q });
    expect(flagged(s.board, "Pinned")).toBe(false);
    await s.board.mutate({
      action: "orchestrator-enable",
      id: q,
      enabled: false,
    } as never);
    expect(flagged(s.board, "Pinned")).toBe(true);
  } finally {
    s.board.dispose();
  }
});

it("in factory active mode the check reads the factory's workers, not the JSON's", async () => {
  // The JSON has the project's orchestrator on; the factory's worker for it is off.
  const s = await boot({
    files: {
      "workers/night/worker.md": `---
name: Night
project: proj
enabled: false
---

Work at night.
`,
    },
  });
  expect(s.board.snapshot().orchestrators[0]).toMatchObject({
    projectId: "p",
    enabled: false,
  });
  const taskId = await startTask(s);
  const stuck = s.board.snapshot().cards.find((c) => c.id === taskId)!;
  expect(stuck.stage).toBe("ready");
  expect(stuck.noOrchestrator).toBe(true);
});

it("board_overview, board_get_task and board_list_tasks show the warning to the PM", async () => {
  const s = setup();
  await s.board.start();
  try {
    await create(s, "Stuck", "p");
    await create(s, "Later", "p", { stage: "backlog" });
    const tools = chatTools(() => s.board, { list: vi.fn() } as never);
    const run = (name: string, input: Record<string, unknown> = {}) =>
      tools.find((t) => t.name === name)!.execute(input);
    const { number } = card(s.board, "Stuck");

    const overview = (await run("board_overview")).text ?? "";
    const section = overview
      .split("\n\n")
      .find((part) => part.startsWith("Waiting with no orchestrator:"));
    expect(section).toContain(`#${number} |`);
    expect(section).toContain("Stuck");
    expect(section).not.toContain("Later");
    expect(
      (await run("board_get_task", { taskId: `#${number}` })).text,
    ).toContain(NO_ORCHESTRATOR);
    const list = (await run("board_list_tasks")).text ?? "";
    expect(list.split("\n").find((l) => l.includes("Later"))).not.toContain(
      NO_ORCHESTRATOR,
    );

    await addOrchestrator(s.board, { name: "P", projectId: "p" });
    expect((await run("board_overview")).text).toContain(
      "Waiting with no orchestrator:\n- none",
    );
    expect(
      (await run("board_get_task", { taskId: `#${number}` })).text,
    ).not.toContain(NO_ORCHESTRATOR);
  } finally {
    s.board.dispose();
  }
});

it("the card's alert names the project, or says the task has none", () => {
  const t = strings("en");
  expect(noOrchestratorText({ projectName: "Paseo" }, t)).toBe(
    "No orchestrator is set up for project Paseo. Set one up in the Orchestrators tab.",
  );
  expect(noOrchestratorText({ projectName: "" }, t)).toBe(
    "No orchestrator takes tasks without a project. Set one up in the Orchestrators tab.",
  );
  expect(noOrchestratorText({ projectName: "Paseo" }, strings("zh"))).toContain(
    "Paseo",
  );
});
