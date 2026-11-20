import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { Workboard, type AssistantOptions } from "../server/workboard";
import {
  describeGitState,
  taskDiff,
  taskGitState,
} from "../server/assistant/task-git";
import { assistantDataSchema } from "../shared/assistant";
import { orchestratorConfigSchema } from "../shared/model";
import { fixture } from "./fixtures";

// CUSTOM(orchestrator-in-place): folder-mode orchestrators run one task per project folder,
// commit on the branch the folder is on, and diff from the HEAD they started at.

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture/p",
  isGit: true,
};
const always = { kind: "window", start: "00:00", end: "00:00" } as const;

function setup(
  initial: Parameters<typeof fixture>[0] = {},
  options: AssistantOptions = {},
) {
  const base = fixture(initial);
  base.inventory.projects.push(project);
  let now = Date.parse("2026-11-20T12:00:00.000Z");
  const board = new Workboard(
    base.host,
    base.store,
    () => now,
    60_000,
    options,
  );
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
      projectId: "p",
      schedule: always,
      ...overrides,
    }),
  });
  return board.snapshot().orchestrators.find((o) => !before.has(o.id))!.id;
}
async function create(s: Setup, title: string, orchestratorId?: string) {
  s.advance(1000);
  await s.board.mutate({
    action: "create",
    title,
    description: `Do ${title}`,
    projectId: "p",
    stage: "ready",
    ...(orchestratorId ? { orchestratorId } : {}),
  } as never);
}
const card = (board: Workboard, title: string) =>
  board.snapshot().cards.find((c) => c.title === title)!;
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
/** A task started by hand in the project folder, with an agent that keeps running. */
async function manualRunner(s: Setup, title = "Manual") {
  await s.board.mutate({
    action: "create",
    title,
    description: "",
    projectId: "p",
  } as never);
  const taskId = card(s.board, title).id;
  await s.board.mutate({
    action: "start",
    taskId,
    target: {
      kind: "new",
      source: { kind: "directory", path: "/fixture/p", projectId: "p" },
    },
  } as never);
  const agentId = `manual-${title}`;
  s.inventory.agents.push({
    id: agentId,
    workspaceId: card(s.board, title).workspaceId!,
    title,
    updatedAt: new Date(s.now()).toISOString(),
    lastUserMessageAt: null,
    archivedAt: null,
    activity: "running",
  });
  return { taskId, agentId };
}

it("runs one folder-mode task at a time per project folder, across orchestrators", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    const first = await addOrchestrator(s.board, {
      name: "First",
      useWorktree: false,
      maxConcurrent: 2,
    });
    const second = await addOrchestrator(s.board, {
      name: "Second",
      useWorktree: false,
    });
    await create(s, "A", first);
    expect(card(s.board, "A").stage).toBe("in-progress");
    await create(s, "B", second);
    expect(card(s.board, "B").stage).toBe("ready");
    expect(logOf(s.board, second)).toContain(
      'Waiting: "A" is not delivered yet in /fixture/p',
    );
    expect(s.board.snapshot().orchestratorStatus[second]?.hold).toMatchObject({
      kind: "folder",
      directory: "/fixture/p",
    });
    // A's agent is idle in review, but its delivery is not delivered yet: the folder stays busy.
    await finish(s, "A");
    expect(card(s.board, "A").stage).toBe("review");
    expect(card(s.board, "B").stage).toBe("ready");
    // Approving A delivers it; only then does B start.
    await s.board.mutate({
      action: "review",
      taskId: card(s.board, "A").id,
      outcome: "done",
      feedback: "",
    });
    await s.board.refresh();
    await vi.waitFor(() =>
      expect(card(s.board, "B").stage).toBe("in-progress"),
    );
  } finally {
    s.board.dispose();
  }
});

it("does not start B before A's folder commit finishes", async () => {
  const s = setup({
    defaultOrchestratorSeeded: true,
    assistant: assistantDataSchema.parse({
      settings: {
        projects: { p: { action: "merge", verifyCommand: "" } },
      },
    }),
  });
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  (s.host.commit as any).mockImplementation(async () => {
    await gate;
  });
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    await create(s, "B", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    await vi.waitFor(() => expect(s.host.commit).toHaveBeenCalled());
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
      "committing",
    );
    expect(card(s.board, "B").stage).toBe("ready");
    release();
    await vi.waitFor(() => expect(card(s.board, "A").stage).toBe("done"));
    await vi.waitFor(() =>
      expect(card(s.board, "B").stage).toBe("in-progress"),
    );
    const commitOrder = (s.host.commit as any).mock.invocationCallOrder[0];
    const bStart = (s.host.startAgent as any).mock.calls.findIndex(
      ([, start]: [string, { title: string }]) => start.title === "B",
    );
    expect(bStart).toBeGreaterThanOrEqual(0);
    expect(commitOrder).toBeLessThan(
      (s.host.startAgent as any).mock.invocationCallOrder[bStart],
    );
  } finally {
    s.board.dispose();
  }
});

it("waits before committing while another task's agent runs in the folder", async () => {
  const s = setup(
    {
      defaultOrchestratorSeeded: true,
      assistant: assistantDataSchema.parse({
        settings: {
          projects: { p: { action: "merge", verifyCommand: "" } },
        },
      }),
    },
    { folderRetryMs: 20 },
  );
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    // A manual task starts in the same folder while A runs, bypassing the folder queue.
    const manual = await manualRunner(s, "B");
    await finish(s, "A");
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskA]?.detail).toContain(
        'Waiting: "B" is still running in /fixture/p',
      ),
    );
    expect(s.host.commit).not.toHaveBeenCalled();
    s.inventory.agents.find((a) => a.id === manual.agentId)!.activity = "idle";
    await vi.waitFor(() => expect(s.host.commit).toHaveBeenCalled());
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("waits before a prepare-pr commit while another task's agent runs in the folder", async () => {
  const s = setup(
    {
      defaultOrchestratorSeeded: true,
      assistant: assistantDataSchema.parse({
        settings: { projects: { p: { action: "prepare-pr" } } },
      }),
    },
    { folderRetryMs: 20 },
  );
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    const manual = await manualRunner(s, "B");
    await finish(s, "A");
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskA]?.detail).toContain(
        'Waiting: "B" is still running in /fixture/p',
      ),
    );
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
      "preparing-pr",
    );
    expect(s.host.commit).not.toHaveBeenCalled();
    s.inventory.agents.find((a) => a.id === manual.agentId)!.activity = "idle";
    await vi.waitFor(() => expect(s.host.commit).toHaveBeenCalled());
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("waits before the approval commit while another task's agent runs in the folder", async () => {
  const s = setup({ defaultOrchestratorSeeded: true }, { folderRetryMs: 20 });
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    expect(card(s.board, "A").stage).toBe("review");
    const manual = await manualRunner(s, "B");
    await s.board.refresh();
    await s.board.mutate({
      action: "review",
      taskId: taskA,
      outcome: "done",
      feedback: "",
    });
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskA]?.detail).toContain(
        'Waiting: "B" is still running in /fixture/p',
      ),
    );
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
      "committing",
    );
    expect(s.host.commit).not.toHaveBeenCalled();
    s.inventory.agents.find((a) => a.id === manual.agentId)!.activity = "idle";
    await vi.waitFor(() => expect(s.host.commit).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
        "delivered",
      ),
    );
    expect(s.store.current.assistant.deliveries[taskA]?.reason ?? null).toBe(
      null,
    );
  } finally {
    s.board.dispose();
  }
});

it("sends a failed approval commit to Needs you", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  (s.host.commit as any).mockRejectedValue(new Error("commit failed"));
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    await s.board.mutate({
      action: "review",
      taskId: taskA,
      outcome: "done",
      feedback: "",
    });
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
        "needs-you",
      ),
    );
    expect(s.store.current.assistant.deliveries[taskA]?.reason).toBe(
      "merge-error",
    );
    expect(s.store.current.assistant.deliveries[taskA]?.detail).toContain(
      "commit failed",
    );
  } finally {
    s.board.dispose();
  }
});

it("keeps the folder for a nothing-policy task until it is approved", async () => {
  const s = setup({
    defaultOrchestratorSeeded: true,
    assistant: assistantDataSchema.parse({
      settings: { projects: { p: { action: "nothing" } } },
    }),
  });
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    await create(s, "B", id);
    const taskA = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    expect(card(s.board, "A").stage).toBe("review");
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe("reported");
    expect(card(s.board, "B").stage).toBe("ready");
    await s.board.mutate({
      action: "review",
      taskId: taskA,
      outcome: "done",
      feedback: "",
    });
    await s.board.refresh();
    await vi.waitFor(() =>
      expect(card(s.board, "B").stage).toBe("in-progress"),
    );
  } finally {
    s.board.dispose();
  }
});

it("keeps the folder while A waits on Needs you, and dismiss releases B", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  (s.host.lastReply as any).mockResolvedValue(report);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    await create(s, "B", id);
    const taskA = card(s.board, "A").id;
    await finish(s, "A");
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
      "needs-you",
    );
    expect(card(s.board, "B").stage).toBe("ready");
    await s.board.assistantAction({ type: "dismiss", taskId: taskA });
    await s.board.refresh();
    expect(card(s.board, "B").stage).toBe("in-progress");
  } finally {
    s.board.dispose();
  }
});

it("keeps the folder while A waits on Needs you, and mark-done releases B", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  (s.host.lastReply as any).mockResolvedValue(report);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    await create(s, "B", id);
    const taskA = card(s.board, "A").id;
    await finish(s, "A");
    expect(s.store.current.assistant.deliveries[taskA]?.stage).toBe(
      "needs-you",
    );
    expect(card(s.board, "B").stage).toBe("ready");
    await s.board.assistantAction({ type: "mark-done", taskId: taskA });
    await s.board.refresh();
    expect(card(s.board, "A").stage).toBe("done");
    expect(card(s.board, "B").stage).toBe("in-progress");
  } finally {
    s.board.dispose();
  }
});

it("starts in a folder that already has uncommitted changes and records them", async () => {
  const history = { append: vi.fn(async () => {}) };
  const s = setup(
    { defaultOrchestratorSeeded: true },
    { history: history as unknown as AssistantOptions["history"] },
  );
  (s.host.gitStatusLines as any).mockResolvedValue([
    " M notes.txt",
    "?? draft.txt",
  ]);
  (s.host.gitHead as any).mockResolvedValue("abc123");
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskId = card(s.board, "A").id;
    expect(s.board.snapshot().orchestrations[taskId]).toMatchObject({
      inPlace: true,
      baseHead: "abc123",
      initialDirty: [" M notes.txt", "?? draft.txt"],
    });
    expect(card(s.board, "A").inPlace).toBe(true);
    expect(history.append).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "folder-dirty", taskId }),
    );
    expect(logOf(s.board, id).join("\n")).toContain(
      "already had uncommitted changes",
    );
  } finally {
    s.board.dispose();
  }
});

const report = `Done.\n<report>${JSON.stringify({ status: "done", summary: "Added X" })}</report>`;

it("delivers a folder-mode task with a commit on the current branch, without merging", async () => {
  const s = setup({
    defaultOrchestratorSeeded: true,
    assistant: assistantDataSchema.parse({
      settings: {
        projects: { p: { action: "merge", verifyCommand: "" } },
      },
    }),
  });
  (s.host.lastReply as any).mockResolvedValue(report);
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskId = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    await vi.waitFor(() =>
      expect(s.store.current.assistant.deliveries[taskId]?.stage).toBe(
        "delivered",
      ),
    );
    expect(s.host.commit).toHaveBeenCalledWith("/fixture/p");
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(s.store.current.finishes[taskId]?.committedAt).toBeTruthy();
    expect(s.store.current.finishes[taskId]?.mergedAt ?? null).toBeNull();
    expect(card(s.board, "A").stage).toBe("done");
  } finally {
    s.board.dispose();
  }
});

it("commits when the user approves a folder task from review", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  (s.host.gitDirty as any).mockResolvedValue(true);
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Folder",
      useWorktree: false,
    });
    await create(s, "A", id);
    const taskId = card(s.board, "A").id;
    s.inventory.workspaces.find(
      (w) => w.id === card(s.board, "A").workspaceId,
    )!.projectKind = "git";
    await finish(s, "A");
    expect(card(s.board, "A").stage).toBe("review");
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "done",
      feedback: "",
    });
    await vi.waitFor(() =>
      expect(s.host.commit).toHaveBeenCalledWith("/fixture/p"),
    );
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(card(s.board, "A").stage).toBe("done");
  } finally {
    s.board.dispose();
  }
});

it("diffs a folder task from the HEAD it started at", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pwb-in-place-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(path.join(directory, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const baseHead = git("rev-parse", "HEAD").trim();
    writeFileSync(path.join(directory, "a.txt"), "one\ntwo\n");
    git("add", ".");
    git("commit", "-q", "-m", "task change");
    writeFileSync(path.join(directory, "notes.txt"), "dirty\n");
    const checkout = {
      directory,
      policyBase: null,
      inPlace: true,
      baseHead,
      initialDirty: ["?? notes.txt"],
    };
    const state = await taskGitState(checkout);
    expect(state.base).toEqual({ ref: baseHead, source: "task start" });
    expect(state.mergeBase).toBe(baseHead);
    expect(state.ahead).toBe(1);
    expect(state.commits[0]).toContain("task change");
    expect(state.inPlace).toBe(true);
    const header = describeGitState(state);
    expect(header).toContain("Mode: project folder");
    expect(header).toContain("Already uncommitted when the task started");
    const diff = await taskDiff(checkout);
    expect(diff.diff).toContain("+two");
    expect(diff.diff).toContain("notes.txt");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps worktree orchestrators unchanged", async () => {
  const s = setup({ defaultOrchestratorSeeded: true });
  await s.board.start();
  try {
    const id = await addOrchestrator(s.board, {
      name: "Worktrees",
      useWorktree: true,
      maxConcurrent: 2,
    });
    await create(s, "A", id);
    await create(s, "B", id);
    expect(card(s.board, "A").stage).toBe("in-progress");
    expect(card(s.board, "B").stage).toBe("in-progress");
    expect(
      (s.host.create as any).mock.calls.some(
        ([source]: [{ kind: string }]) => source.kind === "worktree",
      ),
    ).toBe(true);
    const taskId = card(s.board, "A").id;
    expect(s.board.snapshot().orchestrations[taskId]?.inPlace).toBe(false);
  } finally {
    s.board.dispose();
  }
});
