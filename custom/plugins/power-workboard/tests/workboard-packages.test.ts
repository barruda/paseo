// CUSTOM(packages): the board's package mutations, the test-tier override and the gate failure
// card on the Project Manager board.
import { expect, it, vi } from "vitest";
import { fixture } from "./fixtures";
import { Workboard } from "../server/workboard";
import {
  orchestratorConfigSchema,
  packageRunSchema,
  packageSchema,
  type PackageRun,
} from "../shared/model";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: false,
};

async function setup() {
  const f = fixture({ defaultOrchestratorSeeded: true });
  f.inventory.projects.push(project);
  await f.board.start();
  const create = async (title: string) => {
    const board = await f.board.mutate({
      action: "create",
      title,
      description: "",
      projectId: "p",
    });
    return board.cards.find((card) => card.title === title)!;
  };
  const a = await create("A");
  const b = await create("B");
  const c = await create("C");
  return { ...f, tasks: [a, b, c] };
}

it("creates a package with a name and assigns the selected tickets", async () => {
  const f = await setup();
  const board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: f.tasks.map((task) => task.id),
  });
  const pkg = board.packages.find((item) => item.name === "Auth")!;
  expect(pkg).toMatchObject({ status: "open", total: 3, merged: 0 });
  expect(pkg.projectName).toBe("Project");
  expect(
    board.cards
      .filter((card) => card.packageId === pkg.id)
      .map((card) => card.title),
  ).toEqual(["A", "B", "C"]);
  expect(
    board.cards
      .filter((card) => card.packageId === pkg.id)
      .every((card) => card.testTier === null),
  ).toBe(true);
});

it("adds to an existing package, removes, and deletes an empty package", async () => {
  const f = await setup();
  let board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [f.tasks[0]!.id],
  });
  const pkg = board.packages[0]!;
  board = await f.board.mutate({
    action: "package-assign",
    packageId: pkg.id,
    taskIds: [f.tasks[1]!.id, f.tasks[2]!.id],
  });
  expect(board.packages[0]!.total).toBe(3);
  board = await f.board.mutate({
    action: "package-remove",
    taskIds: [f.tasks[0]!.id],
  });
  expect(board.packages[0]!.total).toBe(2);
  expect(board.cards.find((card) => card.title === "A")!.packageId).toBeNull();
  await f.board.mutate({
    action: "package-remove",
    taskIds: [f.tasks[1]!.id, f.tasks[2]!.id],
  });
  board = await f.board.mutate({
    action: "package-delete",
    packageId: pkg.id,
  });
  expect(board.packages).toEqual([]);
});

it("refuses a package delete that still has tickets, and a ticket from another project", async () => {
  const f = await setup();
  const board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [f.tasks[0]!.id],
  });
  await expect(
    f.board.mutate({
      action: "package-delete",
      packageId: board.packages[0]!.id,
    }),
  ).rejects.toThrow("package-not-empty");
  await expect(
    f.board.mutate({
      action: "package-create",
      name: "Other",
      projectId: "p",
      taskIds: ["missing"],
    }),
  ).rejects.toThrow("package-tasks-missing");
});

it("changes a ticket's test level with a reason and clears it when it leaves the package", async () => {
  const f = await setup();
  const board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [f.tasks[0]!.id],
  });
  const pkg = board.packages[0]!;
  let next = await f.board.mutate({
    action: "set-test-tier",
    taskId: f.tasks[0]!.id,
    tier: "gate",
    reason: "migration",
  });
  expect(next.cards.find((card) => card.title === "A")!.testTier).toMatchObject(
    { tier: "gate", reason: "migration", by: "user" },
  );
  await expect(
    f.board.mutate({
      action: "set-test-tier",
      taskId: f.tasks[0]!.id,
      tier: "full",
      reason: "full inside a package",
    }),
  ).rejects.toThrow("package-tier-full-package");
  next = await f.board.mutate({
    action: "package-remove",
    taskIds: [f.tasks[0]!.id],
  });
  expect(next.cards.find((card) => card.title === "A")!.testTier).toBeNull();
  await expect(
    f.board.mutate({
      action: "set-test-tier",
      taskId: f.tasks[1]!.id,
      tier: "gate",
      reason: "no package",
    }),
  ).rejects.toThrow("package-tier-needs-package");
  expect(pkg.total).toBe(1);
});

it("closes a package and keeps its tickets", async () => {
  const f = await setup();
  let board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [f.tasks[0]!.id],
  });
  const pkg = board.packages[0]!;
  board = await f.board.mutate({
    action: "package-close",
    packageId: pkg.id,
    runGate: false,
  });
  expect(board.packages[0]).toMatchObject({ status: "closed" });
  expect(board.cards.find((card) => card.title === "A")!.packageId).toBe(
    pkg.id,
  );
});

it("a failed gate points at the suspect and opens exactly one investigation card", async () => {
  const f = await setup();
  const board = await f.board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: f.tasks.map((task) => task.id),
  });
  const pkg = board.packages[0]!;
  const run = (suspectTaskId: string): PackageRun => ({
    id: "run",
    packageId: pkg.id,
    trigger: "manual",
    status: "failed",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    durationMs: 1000,
    commit: "abc",
    output: "boom",
    suspectTaskId,
    suspectCommit: "abc",
  });
  const gated = new Workboard(
    f.host,
    f.store,
    () => Date.parse("2026-09-23T00:00:00Z"),
    60_000,
    { packageGate: async () => run(f.tasks[1]!.id) },
  );
  await gated.start();
  await gated.mutate({
    action: "package-run-gate",
    packageId: pkg.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const runs = gated.packageRuns(pkg.id);
  expect(runs[0]?.status).toBe("failed");
  expect(runs[0]?.suspectTaskId).toBe(f.tasks[1]!.id);
  const cards = gated.pmCards().filter((card) => card.kind === "investigation");
  expect(cards).toHaveLength(1);
  expect(cards[0]!.links.packageIds).toEqual([pkg.id]);
  expect(cards[0]!.links.taskIds).toEqual([f.tasks[1]!.id]);

  // A second failure updates the same card instead of creating another one.
  await gated.mutate({
    action: "package-run-gate",
    packageId: pkg.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    gated.pmCards().filter((card) => card.kind === "investigation"),
  ).toHaveLength(1);
});

it("a package ticket's prompt carries the restricted level and a plain ticket's does not", async () => {
  const f = fixture({ defaultOrchestratorSeeded: true });
  f.inventory.projects.push(project);
  const board = new Workboard(
    f.host,
    f.store,
    () => Date.parse("2026-09-23T00:00:00Z"),
    60_000,
  );
  await board.start();
  const created = await board.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  const taskId = created.cards.find((card) => card.title === "Task")!.id;
  await board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [taskId],
  });
  await board.mutate({
    action: "stage",
    taskId,
    stage: "ready",
    expectedLabels: [],
  });
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Always",
      projectId: "p",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    }),
  });
  const starts = (f.host.startAgent as any).mock.calls;
  const taskStart = starts.find(
    ([, start]: [string, { title: string }]) => start.title === "Task",
  );
  expect(taskStart?.[1].prompt).toContain("## Tests — restricted");
  expect(taskStart?.[1].prompt).toContain("Do not run the full suite");
  board.dispose();

  // The same board without a package keeps the prompt free of the section.
  const g = fixture({ defaultOrchestratorSeeded: true });
  g.inventory.projects.push(project);
  const plain = new Workboard(
    g.host,
    g.store,
    () => Date.parse("2026-09-23T00:00:00Z"),
    60_000,
  );
  await plain.start();
  const draft = await plain.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  const plainId = draft.cards.find((card) => card.title === "Task")!.id;
  await plain.mutate({
    action: "stage",
    taskId: plainId,
    stage: "ready",
    expectedLabels: [],
  });
  await plain.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Always",
      projectId: "p",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    }),
  });
  const plainStart = (g.host.startAgent as any).mock.calls.find(
    ([, start]: [string, { title: string }]) => start.title === "Task",
  );
  expect(plainStart?.[1].prompt).not.toContain("## Tests");
  plain.dispose();
});

it("the nightly trigger runs the gate once per night window", async () => {
  const f = fixture({ defaultOrchestratorSeeded: true });
  f.inventory.projects.push(project);
  const run = (packageId: string): PackageRun => ({
    id: "run",
    packageId,
    trigger: "night",
    status: "passed",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:01Z",
    durationMs: 1000,
    commit: null,
    output: "ok",
    suspectTaskId: null,
    suspectCommit: null,
  });
  let gatePackageId = "";
  const board = new Workboard(
    f.host,
    f.store,
    () => Date.parse("2026-09-23T12:00:00Z"),
    60_000,
    {
      packageGate: async (input) => {
        gatePackageId = input.pkg.id;
        return run(input.pkg.id);
      },
    },
  );
  await board.start();
  const created = await board.mutate({
    action: "create",
    title: "A",
    description: "",
    projectId: "p",
  });
  const taskId = created.cards.find((card) => card.title === "A")!.id;
  const packaged = await board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [taskId],
  });
  const pkg = packaged.packages[0]!;
  // A 24h window (start equals end) is always open.
  await board.mutate({
    action: "night-settings",
    night: {
      start: "00:00",
      end: "00:00",
      shutdownWhenDone: false,
      shutdownCommand: "",
    },
  });
  await board.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(gatePackageId).toBe(pkg.id);
  const runs = board.packageRuns(pkg.id);
  expect(runs[0]?.trigger).toBe("night");
  expect(runs[0]?.status).toBe("passed");
  // A second pass in the same window does not run it again.
  await board.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(board.packageRuns(pkg.id)).toHaveLength(1);
  board.dispose();
});

it("marks a gate interrupted by a restart as an error on load", async () => {
  const f = fixture({
    defaultOrchestratorSeeded: true,
    packages: [
      packageSchema.parse({
        id: "pkg-1",
        name: "Auth",
        projectId: "p",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ],
    packageRuns: [
      packageRunSchema.parse({
        id: "run-1",
        packageId: "pkg-1",
        trigger: "manual",
        status: "running",
        startedAt: "2026-01-01T00:00:00Z",
      }),
    ],
  });
  f.inventory.projects.push(project);
  await f.board.start();
  expect(f.store.current.packageRuns[0]).toMatchObject({
    status: "error",
    output: expect.stringContaining("Interrupted by a restart"),
  });
  f.board.dispose();
});

// CUSTOM(packages): the optional integration branch.
async function gitPackageBoard() {
  const f = fixture({ defaultOrchestratorSeeded: true });
  f.inventory.projects.push({ ...project, isGit: true });
  vi.mocked(f.host.currentBranch).mockResolvedValue("main");
  const packageGit = {
    ensureBranch: vi.fn(async () => "created" as const),
    refCommit: vi.fn(async () => "package-commit"),
    addWorktree: vi.fn(async () => {}),
    removeWorktree: vi.fn(async () => {}),
    mergeIntoBranch: vi.fn(async () => {}),
  };
  const board = new Workboard(f.host, f.store, undefined, undefined, {
    packageGit,
    changedPaths: async () => [],
  });
  await board.start();
  const created = await board.mutate({
    action: "create",
    title: "A",
    description: "",
    projectId: "p",
  });
  const taskId = created.cards[0]!.id;
  const withPackage = await board.mutate({
    action: "package-create",
    name: "Auth",
    projectId: "p",
    taskIds: [taskId],
  });
  return {
    ...f,
    board,
    packageGit,
    taskId,
    packageId: withPackage.packages[0]!.id,
  };
}

it("creates a package's branch from the base and keeps it while it has no merges", async () => {
  const f = await gitPackageBoard();
  try {
    let board = await f.board.mutate({
      action: "package-update",
      packageId: f.packageId,
      branch: "pkg/auth",
    });
    expect(board.packages[0]!.branch).toBe("pkg/auth");
    expect(f.packageGit.ensureBranch).toHaveBeenCalledWith(
      "/fixture",
      "pkg/auth",
      "main",
    );
    board = await f.board.mutate({
      action: "package-update",
      packageId: f.packageId,
      branch: null,
    });
    expect(board.packages[0]!.branch).toBeNull();
  } finally {
    f.board.dispose();
  }
});

it("refuses a branch on a project that is not git, and changing a branch that has merges", async () => {
  const plain = await setup();
  const plainPkg = (
    await plain.board.mutate({
      action: "package-create",
      name: "Auth",
      projectId: "p",
      taskIds: [plain.tasks[0]!.id],
    })
  ).packages[0]!;
  await expect(
    plain.board.mutate({
      action: "package-update",
      packageId: plainPkg.id,
      branch: "pkg/auth",
    }),
  ).rejects.toThrow("package-branch-needs-git");
  plain.board.dispose();

  const f = await gitPackageBoard();
  try {
    await f.board.mutate({
      action: "package-update",
      packageId: f.packageId,
      branch: "pkg/auth",
    });
    await f.store.update((data) => {
      data.finishes[f.taskId] = {
        running: null,
        committedAt: null,
        mergedAt: "2026-01-02T00:00:00Z",
        mergeCommit: "abc",
        mergeTarget: "pkg/auth",
        prTitle: null,
        prBody: null,
        error: null,
      };
    });
    await expect(
      f.board.mutate({
        action: "package-update",
        packageId: f.packageId,
        branch: null,
      }),
    ).rejects.toThrow("package-branch-has-merges");
  } finally {
    f.board.dispose();
  }
});

it("merges the package branch into the base when the package closes", async () => {
  const f = await gitPackageBoard();
  try {
    await f.board.mutate({
      action: "package-update",
      packageId: f.packageId,
      branch: "pkg/auth",
    });
    const board = await f.board.mutate({
      action: "package-close",
      packageId: f.packageId,
      runGate: false,
    });
    expect(board.packages[0]!.status).toBe("closed");
    expect(f.packageGit.addWorktree).toHaveBeenCalledWith(
      "/fixture",
      expect.stringContaining(f.packageId),
      "pkg/auth",
    );
    expect(f.host.mergeToBase).toHaveBeenCalledWith(
      expect.stringContaining(f.packageId),
      expect.objectContaining({ baseRef: "main" }),
    );
    expect(f.packageGit.removeWorktree).toHaveBeenCalled();
  } finally {
    f.board.dispose();
  }
});

it("keeps the package open when integrating its branch fails", async () => {
  const f = await gitPackageBoard();
  try {
    await f.board.mutate({
      action: "package-update",
      packageId: f.packageId,
      branch: "pkg/auth",
    });
    vi.mocked(f.host.mergeToBase).mockRejectedValueOnce(
      new Error("CONFLICT (content): Merge conflict"),
    );
    await expect(
      f.board.mutate({
        action: "package-close",
        packageId: f.packageId,
        runGate: false,
      }),
    ).rejects.toThrow("package-branch-merge-failed");
    expect(f.board.snapshot().packages[0]!.status).toBe("open");
    expect(f.packageGit.removeWorktree).toHaveBeenCalled();
  } finally {
    f.board.dispose();
  }
});
