// CUSTOM(archive-task): the user archives a Done or Canceled card by hand.
import { expect, it, vi } from "vitest";
import { dataSchema, newTask, settingsSchema } from "../shared/model";
import { agentEvidence, fixture, workspace } from "./fixtures";

function doneTask(
  kind: "worktree" | "directory",
  { label = "pwb:done", inPlace = false } = {},
) {
  const orchestrations = inPlace
    ? dataSchema.parse({
        orchestrations: {
          t: {
            status: "finished",
            startedAt: "2026-08-01T00:00:00Z",
            finishedAt: "2026-08-01T00:00:00Z",
            workspaceId: "w",
            inPlace: true,
          },
        },
      }).orchestrations
    : {};
  const test = fixture({
    // Off, so only the manual action can archive a task worktree here.
    settings: settingsSchema.parse({ autoArchive: false }),
    orchestrations,
    tasks: [
      {
        ...newTask("t", "Task", "2026-08-01T00:00:00Z", "done"),
        workspaceId: "w",
        projectId: "p",
        conversationGateAt: "2026-08-01T00:00:00.000Z",
        conversationGateEvidence: "exact",
        lastConversationAt: "2026-08-01T00:00:00.000Z",
        conversationStatus: "known",
        conversationDisplayEvidence: "exact",
      },
    ],
  });
  test.inventory.projects.push({
    id: "p",
    name: "Project",
    directory: "/fixture",
    isGit: true,
  });
  test.inventory.workspaces.push({
    ...workspace("w", undefined, [label]),
    workspaceKind: kind,
  });
  test.inventory.agents.push({
    id: "a",
    workspaceId: "w",
    title: null,
    updatedAt: "2026-08-01T00:00:00Z",
    lastUserMessageAt: "2026-08-01T00:00:00Z",
    archivedAt: null,
    activity: "idle",
  });
  test.host.conversation = agentEvidence("2026-08-01T00:00:00Z");
  return test;
}

it("archives a Done task of a local checkout without touching its workspace or agents", async () => {
  const test = doneTask("directory");
  try {
    await test.board.start();
    expect(test.board.snapshot().cards[0].dueAt).toBeNull();
    await test.board.mutate({ action: "archive-task", taskId: "t" });
    expect(test.board.snapshot().cards[0].archived).toMatchObject({
      kind: "manual",
      status: "archived",
      stage: "done",
    });
    expect(test.host.archive).not.toHaveBeenCalled();
    expect(test.host.archiveAgent).not.toHaveBeenCalled();
    expect(test.host.safety).not.toHaveBeenCalled();
    expect(test.inventory.workspaces.map((w) => w.id)).toEqual(["w"]);
    expect(test.inventory.agents[0].archivedAt).toBeNull();
    // It stays archived across a refresh, and Archive can put it back on the board.
    await test.board.refresh();
    const card = test.board.snapshot().cards[0];
    expect(card.archived?.status).toBe("archived");
    await test.board.mutate({
      action: "resolve-archive",
      taskId: "t",
      operationId: card.archived!.operationId,
      updatedAt: card.updatedAt,
      outcome: "restore",
    });
    expect(test.board.snapshot().cards[0]).toMatchObject({
      archived: null,
      issue: null,
      stage: "done",
    });
  } finally {
    test.board.dispose();
  }
});

it("an in-place task in a worktree workspace shows no due date and keeps its workspace", async () => {
  const test = doneTask("worktree", { inPlace: true });
  try {
    await test.board.start();
    expect(test.board.snapshot().cards[0].dueAt).toBeNull();
    await test.board.mutate({ action: "archive-task", taskId: "t" });
    expect(test.board.snapshot().cards[0].archived?.kind).toBe("manual");
    expect(test.host.archive).not.toHaveBeenCalled();
  } finally {
    test.board.dispose();
  }
});

it("refuses to archive a task outside Done or Canceled", async () => {
  const test = doneTask("directory", { label: "pwb:in-progress" });
  try {
    await test.board.start();
    await expect(
      test.board.mutate({ action: "archive-task", taskId: "t" }),
    ).rejects.toThrow("archive-task-not-finished");
    expect(test.board.snapshot().cards[0].archived).toBeNull();
  } finally {
    test.board.dispose();
  }
});

it("archives a Done task worktree natively, after the git check", async () => {
  const test = doneTask("worktree");
  try {
    await test.board.start();
    expect(test.board.snapshot().cards[0].dueAt).not.toBeNull();
    expect(test.host.archive).not.toHaveBeenCalled();
    vi.mocked(test.host.safety).mockResolvedValueOnce("git-unmerged");
    await expect(
      test.board.mutate({ action: "archive-task", taskId: "t" }),
    ).rejects.toThrow("git-unmerged");
    expect(test.host.archive).not.toHaveBeenCalled();
    await test.board.mutate({ action: "archive-task", taskId: "t" });
    expect(test.host.archive).toHaveBeenCalledExactlyOnceWith("w");
    const card = test.board.snapshot().cards[0];
    expect(card.archived).toMatchObject({ kind: "manual", status: "archived" });
    // Its workspace is gone: it comes back flagged, like any restored native archive.
    const restored = await test.board.mutate({
      action: "resolve-archive",
      taskId: "t",
      operationId: card.archived!.operationId,
      updatedAt: card.updatedAt,
      outcome: "restore",
    });
    expect(restored.cards[0]).toMatchObject({
      archived: null,
      issue: "archive-restored-workspace-unavailable",
    });
  } finally {
    test.board.dispose();
  }
});

it("refuses a task worktree whose agent is still running", async () => {
  const test = doneTask("worktree");
  test.inventory.agents[0].activity = "running";
  try {
    await test.board.start();
    await expect(
      test.board.mutate({ action: "archive-task", taskId: "t" }),
    ).rejects.toThrow("archive-task-busy");
    expect(test.host.archive).not.toHaveBeenCalled();
  } finally {
    test.board.dispose();
  }
});
