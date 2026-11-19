import { expect, it, vi } from "vitest";
import { Workboard, type AssistantOptions } from "../server/workboard";
import {
  SEEDED_REVIEW_POLICIES,
  assistantDataSchema,
  reviewPolicyFor,
  type HistoryEvent,
} from "../shared/assistant";
import { orchestratorConfigSchema } from "../shared/model";
import { fixture } from "./fixtures";
import { buildOverview } from "../server/assistant/views"; // CUSTOM(task-checkpoints)

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: true,
};

const report = (extra: Record<string, unknown> = {}) =>
  `Did it.\n<report>${JSON.stringify({ status: "done", summary: "Added X", ...extra })}</report>`;

/** An in-memory stand-in for the HistoryStore. */
function memoryHistory() {
  const events: HistoryEvent[] = [];
  return {
    events,
    kinds: () => events.map((e) => e.kind),
    append: async (input: any) => {
      const event = {
        reason: null,
        detail: null,
        id: String(events.length),
        at: "t",
        ...input,
      };
      events.push(event);
      return event as HistoryEvent;
    },
  };
}

interface Options {
  policy?: Record<string, unknown>;
  /** CUSTOM(worktree-base): the project checkout's current branch. */
  currentBranch?: string | null;
  settings?: Record<string, unknown>;
  git?: boolean;
  assistant?: AssistantOptions;
}

/** A task started by an orchestrator whose agent is running. */
async function scenario(options: Options = {}) {
  const history = memoryHistory();
  const setup = fixture({
    defaultOrchestratorSeeded: true,
    assistant: assistantDataSchema.parse({
      settings: {
        ...options.settings,
        projects: options.policy ? { p: options.policy } : {},
      },
    }),
  });
  setup.inventory.projects.push(project);
  if (options.currentBranch !== undefined)
    vi.mocked(setup.host.currentBranch).mockResolvedValue(
      options.currentBranch,
    );
  let now = Date.parse("2026-09-23T00:00:00Z");
  const board = new Workboard(setup.host, setup.store, () => now, 60000, {
    history,
    ...options.assistant,
  });
  await board.start();
  await board.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  const id = () => board.snapshot().cards.find((c) => c.title === "Task")!.id;
  await board.mutate({
    action: "stage",
    taskId: id(),
    stage: "ready",
    expectedLabels: [],
  });
  await board.mutate({
    action: "orchestrator-save",
    orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
      name: "Always",
      schedule: { kind: "window", start: "00:00", end: "00:00" },
    }),
  });
  const card = board.snapshot().cards.find((c) => c.title === "Task")!;
  const workspace = setup.inventory.workspaces.find(
    (w) => w.id === card.workspaceId,
  )!;
  if (options.git ?? true) workspace.projectKind = "git";
  const agent = setup.inventory.agents.find(
    (a) => a.workspaceId === card.workspaceId,
  )!;
  await board.refresh();
  const advance = (ms: number) => (now += ms);
  const finishTurn = async () => {
    await board.refresh(); // sees it running
    agent.activity = "idle";
    advance(1000);
    await board.refresh(); // sees it idle
    advance(20_000);
    await board.refresh(); // idle long enough to settle
  };
  return {
    ...setup,
    board,
    history,
    agent,
    taskId: card.id,
    advance,
    finishTurn,
    delivery: () => setup.store.current.assistant.deliveries[card.id],
    attempts: () => setup.store.current.assistant.attempts[card.id] ?? [],
    stage: () => board.snapshot().cards.find((c) => c.id === card.id)!.stage,
    reply: (text: string) =>
      (setup.host.lastReply as any).mockResolvedValue(text),
    settled: (stage: string) =>
      vi.waitFor(() =>
        expect(setup.store.current.assistant.deliveries[card.id]?.stage).toBe(
          stage,
        ),
      ),
  };
}

it("with the assistant disabled nothing changes: the reply is the summary and there is no delivery", async () => {
  const s = await scenario({
    settings: { enabled: false },
    policy: { action: "merge" },
  });
  try {
    s.reply(report());
    expect((s.host.startAgent as any).mock.calls[0][1].prompt).not.toContain(
      "<report>",
    );
    await s.finishTurn();
    expect(s.stage()).toBe("review");
    expect(s.board.snapshot().orchestrations[s.taskId].summary).toBe(report());
    expect(s.delivery()).toBeUndefined();
    expect(s.attempts()).toEqual([]);
    expect(s.history.events).toEqual([]);
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("enabled: the prompt carries the delivery section and the first attempt is recorded", async () => {
  const s = await scenario();
  try {
    const prompt = (s.host.startAgent as any).mock.calls[0][1].prompt as string;
    expect(prompt).toContain(
      "Do not merge, push, rebase onto the base branch or open pull requests",
    );
    expect(prompt).toContain("<report>");
    expect(s.attempts()).toMatchObject([
      { index: 1, trigger: "start", outcome: "running", agentId: s.agent.id },
    ]);
    expect(s.history.kinds()).toEqual([
      "task-created",
      "task-moved",
      "task-started",
    ]);
    // CUSTOM(assistant-reports): creating and moving a task are automatic items of the Reports page.
    expect(s.history.events.slice(0, 2)).toMatchObject([
      {
        kind: "task-created",
        text: 'Created "Task" in Backlog',
        agentId: null,
      },
      { kind: "task-moved", text: "Moved to Ready to start" },
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a reply without a report needs you (no-report) and the task goes to review", async () => {
  const s = await scenario();
  try {
    s.reply("I changed things.");
    await s.finishTurn();
    expect(s.stage()).toBe("review");
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "no-report",
      action: "review",
    });
    expect(s.attempts()[0]).toMatchObject({ outcome: "no-report" });
    expect(s.board.snapshot().orchestrations[s.taskId].summary).toBe(
      "I changed things.",
    );
    expect(s.history.kinds()).toEqual([
      "task-created",
      "task-moved",
      "task-started",
      "report",
      "needs-you",
    ]);
  } finally {
    s.board.dispose();
  }
});

it("an agent awaiting background work is not finished, and idle must settle for 20 s", async () => {
  const s = await scenario();
  try {
    s.reply(report());
    await s.board.refresh(); // sees it running
    (s.agent as any).activity = "running"; // awaitingBackgroundWork maps to running
    s.advance(60_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
    s.agent.activity = "idle";
    s.advance(1000);
    await s.board.refresh(); // idle starts
    s.advance(19_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
    s.advance(1500);
    await s.board.refresh();
    expect(s.delivery()).toBeDefined();
  } finally {
    s.board.dispose();
  }
});

it("a turn that resumes within the settle window resets it", async () => {
  const s = await scenario();
  try {
    s.reply(report());
    await s.board.refresh();
    s.agent.activity = "idle";
    s.advance(1000);
    await s.board.refresh();
    s.advance(15_000);
    s.agent.activity = "running";
    await s.board.refresh();
    s.agent.activity = "idle";
    s.advance(1000);
    await s.board.refresh();
    s.advance(15_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
  } finally {
    s.board.dispose();
  }
});

it("a report that arrives in a later turn is picked up after a no-report finish", async () => {
  const s = await scenario();
  try {
    s.reply("Waiting for the subagent.");
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({ reason: "no-report" });
    const reads = (s.host.lastReply as any).mock.calls.length;
    // The subagent returns and the agent runs another turn.
    s.agent.activity = "running";
    await s.board.refresh();
    s.reply(report());
    s.agent.activity = "idle";
    s.agent.updatedAt = "2026-09-23T00:05:00Z";
    s.advance(10_000);
    await s.board.refresh();
    s.advance(21_000);
    await s.board.refresh();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
    });
    expect((s.host.lastReply as any).mock.calls.length).toBeGreaterThan(reads);
    expect(s.attempts()).toMatchObject([{ index: 1, outcome: "done" }]);
    expect(s.history.events.at(-1)).toMatchObject({
      kind: "report",
      text: "The report arrived late",
    });
  } finally {
    s.board.dispose();
  }
});

it("a later turn still without a report stays no-report and is read once", async () => {
  const s = await scenario();
  try {
    s.reply("Waiting for the subagent.");
    await s.finishTurn();
    s.agent.activity = "running";
    await s.board.refresh();
    s.agent.activity = "idle";
    s.agent.updatedAt = "2026-09-23T00:05:00Z";
    s.advance(10_000);
    await s.board.refresh();
    s.advance(21_000);
    await s.board.refresh();
    const reads = (s.host.lastReply as any).mock.calls.length;
    s.advance(30_000);
    await s.board.refresh();
    await s.board.refresh();
    expect((s.host.lastReply as any).mock.calls.length).toBe(reads);
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "no-report",
    });
  } finally {
    s.board.dispose();
  }
});

it.each([
  ["blocked", "blocked"],
  ["needs_input", "needs-input"],
  ["failed", "failed"],
] as const)(
  "a %s report needs you (%s) with the question as detail",
  async (status, reason) => {
    const s = await scenario({ policy: { action: "merge" } });
    try {
      s.reply(report({ status, question: "Which database?" }));
      await s.finishTurn();
      expect(s.stage()).toBe("review");
      expect(s.delivery()).toMatchObject({
        stage: "needs-you",
        reason,
        detail: "Which database?",
      });
      expect(s.attempts()[0].outcome).toBe(status);
      expect(s.host.mergeToBase).not.toHaveBeenCalled();
    } finally {
      s.board.dispose();
    }
  },
);

it("the summary is the reply without the report block, or the report's summary when nothing else is left", async () => {
  const s = await scenario();
  try {
    s.reply(
      `<report>${JSON.stringify({ status: "done", summary: "Only the report" })}</report>`,
    );
    await s.finishTurn();
    expect(s.board.snapshot().orchestrations[s.taskId].summary).toBe(
      "Only the report",
    );
  } finally {
    s.board.dispose();
  }
  const t = await scenario();
  try {
    t.reply(report());
    await t.finishTurn();
    expect(t.board.snapshot().orchestrations[t.taskId].summary).toBe("Did it.");
  } finally {
    t.board.dispose();
  }
});

it("done + nothing is delivered; done + notify needs you", async () => {
  const s = await scenario({ policy: { action: "nothing" } });
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.stage()).toBe("review");
    expect(s.delivery()).toMatchObject({ stage: "delivered", reason: null });
  } finally {
    s.board.dispose();
  }
  const t = await scenario({ policy: { action: "notify" } });
  try {
    t.reply(report());
    await t.finishTurn();
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "notify",
    });
  } finally {
    t.board.dispose();
  }
});

it("observe records what would happen and does nothing", async () => {
  const s = await scenario({ policy: { action: "merge", observe: true } });
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "observed",
      detail: "Would merge",
    });
    expect(s.history.kinds()).toContain("observed");
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(s.host.commit).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
  const t = await scenario({ policy: { action: "prepare-pr", observe: true } });
  try {
    t.reply(report());
    await t.finishTurn();
    expect(t.delivery()).toMatchObject({
      reason: "observed",
      detail: "Would prepare a PR",
    });
    expect(t.host.askAgent).not.toHaveBeenCalled();
  } finally {
    t.board.dispose();
  }
});

it("merge: commits what is dirty, merges into the base and moves the task to Done", async () => {
  const s = await scenario({
    policy: { action: "merge", baseBranch: "develop" },
  });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.commit).toHaveBeenCalledTimes(1);
    expect(s.host.mergeToBase).toHaveBeenCalledWith("/fixture", {
      baseRef: "develop",
      requireCleanTarget: true,
      strategy: "merge",
    });
    await vi.waitFor(() => expect(s.stage()).toBe("done"));
    expect(s.store.current.finishes[s.taskId]).toMatchObject({
      committedAt: expect.any(String),
      mergedAt: expect.any(String),
    });
    expect(s.history.kinds()).toEqual([
      "task-created",
      "task-moved",
      "task-started",
      "report",
      "committed",
      "merged",
      "done",
    ]);
  } finally {
    s.board.dispose();
  }
});

it("merge in a project that is not git needs you (merge-error)", async () => {
  const s = await scenario({ policy: { action: "merge" }, git: false });
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "merge-error",
    });
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it.each([["boom", "merge-error"]] as const)(
  "a merge error %j needs you as %s and the task stays in review",
  async (error, reason) => {
    const s = await scenario({ policy: { action: "merge" } });
    try {
      (s.host.mergeToBase as any).mockRejectedValueOnce(new Error(error));
      s.reply(report());
      await s.finishTurn();
      await s.settled("needs-you");
      expect(s.delivery()).toMatchObject({ reason, detail: error });
      expect(s.stage()).toBe("review");
      expect(s.history.kinds()).toContain("needs-you");
      expect(s.store.current.finishes[s.taskId]?.mergedAt ?? null).toBeNull();
    } finally {
      s.board.dispose();
    }
  },
);

it("a merge that is already up to date counts as merged", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    (s.host.mergeToBase as any).mockRejectedValueOnce(
      new Error("Already up to date."),
    );
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    await vi.waitFor(() => expect(s.stage()).toBe("done"));
  } finally {
    s.board.dispose();
  }
});

it("a failed check goes back to the agent once, then the merge goes ahead when it passes", async () => {
  const verify = vi
    .fn()
    .mockResolvedValueOnce({ passed: false, output: "1 test failed: foo" })
    .mockResolvedValueOnce({ passed: true, output: "ok" });
  const s = await scenario({
    policy: { action: "merge", verifyCommand: "npm test", autoFixes: 1 },
    assistant: { verify },
  });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("fixing");
    expect(verify).toHaveBeenCalledWith("npm test", "/fixture");
    expect(s.delivery()).toMatchObject({
      fixesUsed: 1,
      verifyOutput: "1 test failed: foo",
    });
    const sent = (s.host.sendAgent as any).mock.calls[0];
    expect(sent[0]).toBe(s.agent.id);
    expect(sent[1]).toContain("1 test failed: foo");
    expect(s.attempts()).toMatchObject([
      { index: 1, outcome: "done" },
      { index: 2, trigger: "auto-fix", outcome: "running" },
    ]);
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "running",
      sawRunning: false,
    });
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    // The agent fixes it and ends its turn again.
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(1);
    expect(s.delivery()).toMatchObject({ fixesUsed: 1 });
    expect(s.history.kinds()).toEqual([
      "task-created",
      "task-moved",
      "task-started",
      "report",
      "verify-failed",
      "fix-requested",
      "report",
      "verify-passed",
      "committed",
      "merged",
      "done",
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a failed check with no fixes left needs you (verify-failed)", async () => {
  const verify = vi.fn().mockResolvedValue({ passed: false, output: "red" });
  const s = await scenario({
    policy: { action: "merge", verifyCommand: "npm test", autoFixes: 0 },
    assistant: { verify },
  });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.delivery()).toMatchObject({
      reason: "verify-failed",
      verifyOutput: "red",
    });
    expect(s.host.sendAgent).not.toHaveBeenCalled();
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("prepare-pr commits, asks the agent for the text and tells the user", async () => {
  const s = await scenario({ policy: { action: "prepare-pr" } });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.host.commit).toHaveBeenCalledTimes(1);
    expect((s.host.askAgent as any).mock.calls[0][0]).toBe(s.agent.id);
    expect(s.store.current.finishes[s.taskId]).toMatchObject({
      prTitle: "Add X",
      prBody: "What changed.",
    });
    expect(s.delivery()).toMatchObject({
      reason: "notify",
      detail: "PR description ready",
    });
    expect(s.history.kinds()).toContain("pr-prepared");
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("prepare-pr errors need you (pr-error)", async () => {
  const s = await scenario({ policy: { action: "prepare-pr" } });
  try {
    (s.host.askAgent as any).mockRejectedValueOnce(new Error("no answer"));
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.delivery()).toMatchObject({
      reason: "pr-error",
      detail: "no answer",
    });
  } finally {
    s.board.dispose();
  }
});

it("an untracked node_modules symlink is not committed: the delivery needs you (dependency-files)", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    (s.host.gitStatusLines as any).mockResolvedValue([
      " M src/a.ts",
      "?? node_modules",
      "?? packages/app/.venv/",
    ]);
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.host.commit).not.toHaveBeenCalled();
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(s.delivery()).toMatchObject({ reason: "dependency-files" });
    expect(s.delivery()?.detail).toContain("node_modules, packages/app/.venv");
    expect(s.history.kinds()).not.toContain("committed");
  } finally {
    s.board.dispose();
  }
});

it("prepare-pr refuses to commit an untracked dependency folder too", async () => {
  const s = await scenario({ policy: { action: "prepare-pr" } });
  try {
    (s.host.gitStatusLines as any).mockResolvedValue(["?? node_modules"]);
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.host.commit).not.toHaveBeenCalled();
    expect(s.host.askAgent).not.toHaveBeenCalled();
    expect(s.delivery()).toMatchObject({ reason: "dependency-files" });
  } finally {
    s.board.dispose();
  }
});

it("an agent that stops with an error is nudged to continue, then needs you", async () => {
  const s = await scenario({ assistant: { retryDelaysMs: [30_000, 60_000] } });
  try {
    s.agent.activity = "error";
    await s.board.refresh();
    expect(s.host.sendAgent).not.toHaveBeenCalled();
    s.advance(30_000);
    await s.board.refresh();
    expect(s.host.sendAgent).toHaveBeenCalledWith(
      s.agent.id,
      "Continue the task where you stopped.",
    );
    expect(s.attempts()[0].retries).toBe(1);
    s.agent.activity = "error";
    await s.board.refresh();
    s.advance(60_000);
    await s.board.refresh();
    expect(s.attempts()[0].retries).toBe(2);
    s.agent.activity = "error";
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("failed");
    expect(s.attempts()[0].outcome).toBe("agent-error");
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "agent-error",
    });
    expect(s.history.kinds()).toContain("failed");
  } finally {
    s.board.dispose();
  }
});

it("merge-now merges a task in review whatever the policy says, skipping the check", async () => {
  const verify = vi.fn();
  const s = await scenario({
    policy: { action: "notify", verifyCommand: "npm test" },
    assistant: { verify },
  });
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({ reason: "notify" });
    await s.board.assistantAction({ type: "merge-now", taskId: s.taskId });
    await s.settled("delivered");
    expect(verify).not.toHaveBeenCalled();
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(s.stage()).toBe("done"));
  } finally {
    s.board.dispose();
  }
});

it("merge-now refuses a task that is not in review or done, or not in a git project", async () => {
  const s = await scenario({ git: false });
  try {
    await expect(
      s.board.assistantAction({ type: "merge-now", taskId: s.taskId }),
    ).rejects.toThrow("review or done");
    s.reply(report());
    await s.finishTurn();
    await expect(
      s.board.assistantAction({ type: "merge-now", taskId: s.taskId }),
    ).rejects.toThrow("not a git repository");
  } finally {
    s.board.dispose();
  }
});

it("dismiss takes the task off Needs you and keeps it on the board", async () => {
  const s = await scenario();
  try {
    s.reply("no report");
    await s.finishTurn();
    await s.board.assistantAction({ type: "dismiss", taskId: s.taskId });
    expect(s.delivery()).toMatchObject({ stage: "dismissed" });
    expect(s.stage()).toBe("review");
    expect(s.history.kinds()).toContain("dismissed");
  } finally {
    s.board.dispose();
  }
});

it("mark-done and Done on the board close the delivery; continue clears it", async () => {
  const s = await scenario();
  try {
    s.reply("no report");
    await s.finishTurn();
    await s.board.assistantAction({ type: "mark-done", taskId: s.taskId });
    expect(s.stage()).toBe("done");
    expect(s.delivery()).toMatchObject({ stage: "delivered" });
    expect(s.history.kinds()).toContain("done");
  } finally {
    s.board.dispose();
  }
  const t = await scenario();
  try {
    t.reply("no report");
    await t.finishTurn();
    await t.board.assistantAction({
      type: "continue",
      taskId: t.taskId,
      feedback: "More tests",
    });
    expect(t.delivery()).toBeUndefined();
    const sent = (t.host.sendAgent as any).mock.calls.at(-1);
    expect(sent[1]).toContain("More tests");
    expect(sent[1]).toContain("<report>");
    expect(t.attempts()).toMatchObject([
      { outcome: "no-report" },
      { index: 2, trigger: "feedback", feedback: "More tests" },
    ]);
    expect(t.history.kinds()).toContain("task-continued");
  } finally {
    t.board.dispose();
  }
});

it("send reaches only agents of this board", async () => {
  const s = await scenario();
  try {
    await expect(
      s.board.assistantAction({
        type: "send",
        agentId: "stranger",
        text: "hi",
      }),
    ).rejects.toThrow("not managed");
    expect(s.host.sendAgent).not.toHaveBeenCalled();
    await s.board.assistantAction({
      type: "send",
      agentId: s.agent.id,
      text: "hi",
    });
    expect(s.host.sendAgent).toHaveBeenCalledWith(s.agent.id, "hi");
  } finally {
    s.board.dispose();
  }
});

it("a delivery interrupted at merging resumes on start", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    await s.store.update((data) => {
      data.assistant.deliveries[s.taskId].stage = "merging";
    });
    (s.host.mergeToBase as any).mockClear();
    await s.board.start();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(1);
  } finally {
    s.board.dispose();
  }
});

// CUSTOM(assistant-wake): tasks that need the user are told to the chat agent in one batch.
async function wake(options: { chat?: boolean; setting?: boolean } = {}) {
  const s = await scenario({
    settings: { chat: { wakeOnNeedsYou: options.setting ?? true } },
    assistant: { wakeDelayMs: 5 },
  });
  let chatId: string | null = null;
  if (options.chat ?? true) {
    chatId = await s.host.startAgentIn("/chat", {
      provider: "claude/x",
      modeId: null,
      thinkingOptionId: null,
      title: "Projects Assistant",
      prompt: "hi",
    });
    s.inventory.agents.find((a) => a.id === chatId)!.activity = "idle";
    await s.store.update((data) => {
      data.assistant.chatAgentId = chatId;
    });
  }
  const sent = () =>
    (s.host.sendAgent as any).mock.calls.filter(
      ([id]: [string]) => id === chatId,
    ) as [string, string][];
  /** A second task whose delivery needs the user. */
  const another = async () => {
    await s.board.mutate({
      action: "create",
      title: "Second",
      description: "x",
      projectId: "p",
    });
    const id = s.board.snapshot().cards.find((c) => c.title === "Second")!.id;
    await s.store.update((data) => {
      data.assistant.deliveries[id] = {
        ...data.assistant.deliveries[s.taskId]!,
      };
    });
    await (s.board as any).markNeedsYou(id, "failed", "It broke\nbadly");
    return id;
  };
  const blocked = async () => {
    s.reply(
      `x\n<report>${JSON.stringify({ status: "blocked", summary: "Stuck" })}</report>`,
    );
    await s.finishTurn();
    await s.settled("needs-you");
  };
  return { ...s, chatId, sent, another, blocked };
}

it("two tasks that need the user are told in one prompt, and the batch is recorded", async () => {
  const s = await wake();
  try {
    await s.blocked();
    const second = await s.another();
    await vi.waitFor(() => expect(s.sent()).toHaveLength(1));
    const text = s.sent()[0]![1];
    expect(
      text.startsWith(
        "[Board] These tasks finished or stopped and wait for you, the Projects Assistant, first:",
      ),
    ).toBe(true);
    expect(text).toContain(
      `${s.taskId} | Task | Project | blocked | review: self`,
    );
    expect(text).toContain(`${second} | Second | `);
    expect(text).toContain("failed: It broke badly | review: self");
    expect(text).toContain("Handle each one as your instructions say");
    expect(text).toContain("(or that nothing is).");
    expect(text).not.toContain("Do not merge or mark done.");
    await vi.waitFor(() =>
      expect(s.history.kinds()).toContain("told-assistant"),
    );
    expect(
      s.history.events.filter((e) => e.kind === "told-assistant"),
    ).toHaveLength(1);
  } finally {
    s.board.dispose();
  }
});

it("a busy chat agent is not interrupted; the batch goes when it is idle", async () => {
  const s = await wake();
  try {
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "running";
    await s.blocked();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(0);
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    await vi.waitFor(() => expect(s.sent()).toHaveLength(1));
  } finally {
    s.board.dispose();
  }
});

it("with no chat agent nothing is sent", async () => {
  const s = await wake({ chat: false });
  try {
    await s.blocked();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.host.sendAgent).not.toHaveBeenCalled();
    expect(s.history.kinds()).not.toContain("told-assistant");
  } finally {
    s.board.dispose();
  }
});

it("with the setting off nothing is sent", async () => {
  const s = await wake({ setting: false });
  try {
    await s.blocked();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(0);
  } finally {
    s.board.dispose();
  }
});

it("a task that left needs-you before the timer fired is skipped", async () => {
  const s = await wake();
  try {
    await s.blocked();
    await s.store.update((data) => {
      data.assistant.deliveries[s.taskId]!.stage = "dismissed";
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(0);
    expect(s.history.kinds()).not.toContain("told-assistant");
  } finally {
    s.board.dispose();
  }
});

/** A new Workboard on the same store and host, as a plugin reload or daemon restart makes. */
async function reload(s: Awaited<ReturnType<typeof wake>>) {
  s.board.dispose();
  const board = new Workboard(
    s.host,
    s.store,
    () => Date.parse("2026-09-23T01:00:00Z"),
    60000,
    { history: s.history, wakeDelayMs: 5 },
  );
  await board.start();
  return board;
}

it("a needs-you task the chat was not told about is told after the Workboard is recreated", async () => {
  const s = await wake();
  let board = s.board;
  try {
    // Busy chat: the batch waits, then the reload drops the in-memory queue.
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "running";
    await s.blocked();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(0);
    expect(s.delivery()?.toldAt).toBeNull();
    board = await reload(s);
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    await board.refresh();
    await vi.waitFor(() => expect(s.sent()).toHaveLength(1));
    expect(s.sent()[0]![1]).toContain(`${s.taskId} | Task | Project | blocked`);
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeTruthy());
  } finally {
    board.dispose();
  }
});

it("a needs-you task already told is not told again after the Workboard is recreated", async () => {
  const s = await wake();
  let board = s.board;
  try {
    await s.blocked();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeTruthy());
    expect(s.sent()).toHaveLength(1);
    board = await reload(s);
    await board.refresh();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(1);
    expect(
      s.history.events.filter((e) => e.kind === "told-assistant"),
    ).toHaveLength(1);
    // Entering needs-you again clears the mark, so the chat hears about it once more.
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    await (board as any).markNeedsYou(s.taskId, "failed", "Again");
    expect(s.delivery()?.toldAt).toBeNull();
    await vi.waitFor(() => expect(s.sent()).toHaveLength(2));
  } finally {
    board.dispose();
  }
});

it("assistant settings stored without the field wake the chat", () => {
  expect(
    assistantDataSchema.parse({ settings: { chat: {} } }).settings.chat,
  ).toMatchObject({ wakeOnNeedsYou: true });
});

// CUSTOM(assistant-review-policy)
it("assistant settings stored without reviews get DreamMMO and DreamMMO-android as fresh-agent", () => {
  const settings = assistantDataSchema.parse({ settings: {} }).settings;
  expect(settings.reviews).toEqual({
    prj_1b497e9066c32377: "fresh-agent",
    prj_dc85fecbbf8a290e: "fresh-agent",
  });
  expect(SEEDED_REVIEW_POLICIES).toEqual(settings.reviews);
  expect(reviewPolicyFor(settings, "prj_1b497e9066c32377")).toBe("fresh-agent");
  expect(reviewPolicyFor(settings, "prj_dc85fecbbf8a290e")).toBe("fresh-agent");
  // Any other project, and a task without one, defaults to self.
  expect(reviewPolicyFor(settings, "prj_other")).toBe("self");
  expect(reviewPolicyFor(settings, null)).toBe("self");
});

it("saved review policies are kept as they are, without the seed coming back", () => {
  const settings = assistantDataSchema.parse({
    settings: { reviews: { prj_1b497e9066c32377: "self" } },
  }).settings;
  expect(settings.reviews).toEqual({ prj_1b497e9066c32377: "self" });
  expect(reviewPolicyFor(settings, "prj_dc85fecbbf8a290e")).toBe("self");
  expect(() =>
    assistantDataSchema.parse({ settings: { reviews: { p: "someone" } } }),
  ).toThrow();
});

// CUSTOM(worktree-base)
it("starts the task worktree from the policy's base branch, so the merge into it needs no fix", async () => {
  const s = await scenario({
    policy: { action: "merge", baseBranch: "custom" },
    currentBranch: "feature",
  });
  try {
    expect(vi.mocked(s.host.create).mock.calls[0]).toEqual([
      { kind: "worktree", projectId: "p" },
      "Task",
      expect.any(String),
      "custom",
    ]);
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledWith(
      "/fixture",
      expect.objectContaining({ baseRef: "custom" }),
    );
  } finally {
    s.board.dispose();
  }
});

// CUSTOM(worktree-base)
it.each([
  ["the checkout's current branch", "master", "master"],
  ["the daemon's default when the checkout is detached", null, undefined],
])(
  "without a policy base branch, starts the task worktree from %s",
  async (_case, currentBranch, base) => {
    const s = await scenario({ currentBranch });
    try {
      expect(s.host.currentBranch).toHaveBeenCalledWith("/fixture");
      expect(vi.mocked(s.host.create).mock.calls[0]).toEqual([
        { kind: "worktree", projectId: "p" },
        "Task",
        expect.any(String),
        base,
      ]);
    } finally {
      s.board.dispose();
    }
  },
);

// CUSTOM(assistant-autonomy): review, merge conflicts and a dirty base checkout.
it("the review action settles a done report as needs-you review and does not merge", async () => {
  const s = await scenario({ policy: { action: "review", observe: true } });
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
      action: "review",
    });
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(s.history.kinds()).toEqual([
      "task-created",
      "task-moved",
      "task-started",
      "report",
      "needs-you",
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a task in a project with no rule follows the default action, which is review", async () => {
  const s = await scenario();
  try {
    expect(s.store.current.assistant.settings.defaultAction).toBe("review");
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({ reason: "review", action: "review" });
  } finally {
    s.board.dispose();
  }
});

it("a review task wakes the assistant with the review policy of its project", async () => {
  const s = await wake();
  try {
    await s.store.update((data) => {
      data.assistant.settings.reviews.p = "fresh-agent";
    });
    s.reply(report());
    await s.finishTurn();
    await vi.waitFor(() => expect(s.sent()).toHaveLength(1));
    const text = s.sent()[0]![1];
    expect(text).toContain(
      `${s.taskId} | Task | Project | review | review: fresh-agent`,
    );
    expect(text).toContain("review and merge-now (reason review)");
    expect(text).toContain("the ok before merging a fresh-agent project");
    await vi.waitFor(() =>
      expect(
        s.history.events.find((e) => e.kind === "told-assistant")?.text,
      ).toBe("Told the assistant: 1 task wait for it"),
    );
  } finally {
    s.board.dispose();
  }
});

it("merge-now stores the merge action, so an approved merge survives a conflict fix", async () => {
  const s = await scenario();
  try {
    s.reply(report());
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({ reason: "review" });
    (s.host.mergeToBase as any).mockRejectedValueOnce(
      new Error("CONFLICT (content): Merge conflict in a.ts"),
    );
    await s.board.assistantAction({ type: "merge-now", taskId: s.taskId });
    expect(s.delivery()).toMatchObject({ action: "merge" });
    await s.settled("fixing");
    expect(s.delivery()).toMatchObject({ conflictFixes: 1 });
    const sent = (s.host.sendAgent as any).mock.calls.at(-1);
    expect(sent[0]).toBe(s.agent.id);
    expect(sent[1]).toContain("git merge <base branch>");
    expect(sent[1]).toContain("merge, not a rebase");
    expect(sent[1]).toContain("keep every entry");
    expect(sent[1]).toContain("<report>");
    expect(s.attempts().at(-1)).toMatchObject({
      trigger: "auto-fix",
      outcome: "running",
    });
    expect(s.history.events.find((e) => e.kind === "fix-requested")?.text).toBe(
      "Sent the merge conflict back to the agent",
    );
    // The agent resolves it and reports done: it goes back to merging, not to the review policy.
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(2);
    expect(s.delivery()).toMatchObject({ action: "merge", conflictFixes: 1 });
  } finally {
    s.board.dispose();
  }
});

it("the conflict prompt names the policy's base branch", async () => {
  const s = await scenario({
    policy: { action: "merge", baseBranch: "develop" },
  });
  try {
    (s.host.mergeToBase as any).mockRejectedValueOnce(
      new Error("Merge conflict"),
    );
    s.reply(report());
    await s.finishTurn();
    await s.settled("fixing");
    expect((s.host.sendAgent as any).mock.calls.at(-1)[1]).toContain(
      "git merge develop",
    );
  } finally {
    s.board.dispose();
  }
});

it("a conflict goes back to the agent twice, then needs you (merge-conflict)", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    (s.host.mergeToBase as any).mockRejectedValue(
      new Error("CONFLICT in a.ts"),
    );
    s.reply(report());
    await s.finishTurn();
    await s.settled("fixing");
    await s.finishTurn();
    await vi.waitFor(() =>
      expect(s.delivery()).toMatchObject({ stage: "fixing", conflictFixes: 2 }),
    );
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.delivery()).toMatchObject({
      reason: "merge-conflict",
      detail: "CONFLICT in a.ts",
      conflictFixes: 2,
    });
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(3);
    expect(s.stage()).toBe("review");
  } finally {
    s.board.dispose();
  }
});

it("a conflict with no agent to send it to needs you right away", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    (s.host.mergeToBase as any).mockRejectedValue(
      new Error("CONFLICT in a.ts"),
    );
    (s.host.sendAgent as any).mockRejectedValueOnce(new Error("agent is gone"));
    s.reply(report());
    await s.finishTurn();
    await s.settled("needs-you");
    expect(s.delivery()).toMatchObject({
      reason: "merge-conflict",
      detail: "agent is gone",
    });
  } finally {
    s.board.dispose();
  }
});

it("a dirty base checkout is waited for, then the merge goes through", async () => {
  const s = await scenario({
    policy: { action: "merge" },
    assistant: { dirtyRetryMs: 5 },
  });
  try {
    const seen: (string | null | undefined)[] = [];
    const dirty = async () => {
      seen.push(s.delivery()?.detail);
      throw new Error("Target checkout has uncommitted changes");
    };
    (s.host.mergeToBase as any)
      .mockImplementationOnce(dirty)
      .mockImplementationOnce(dirty);
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(3);
    // The second try ran while the delivery said it was waiting.
    expect(seen[1]).toBe("Waiting for a clean checkout (1/12)");
    expect(s.delivery()).toMatchObject({ dirtyRetries: 0, detail: null });
    expect(s.history.kinds().filter((k) => k === "waiting-clean")).toHaveLength(
      1,
    );
  } finally {
    s.board.dispose();
  }
});

it("a checkout that stays dirty needs you after 12 tries, listing its dirty paths", async () => {
  const s = await scenario({
    policy: { action: "merge" },
    assistant: { dirtyRetryMs: 2 },
  });
  try {
    (s.host.mergeToBase as any).mockRejectedValue(
      new Error("Target checkout has uncommitted changes"),
    );
    (s.host.gitStatusLines as any).mockResolvedValue([
      " M src/a.ts",
      "?? notes.md",
    ]);
    s.reply(report());
    await s.finishTurn();
    await vi.waitFor(() => expect(s.delivery()?.stage).toBe("needs-you"), {
      timeout: 4000,
    });
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(13);
    expect(s.delivery()).toMatchObject({
      reason: "dirty-checkout",
      dirtyRetries: 12,
    });
    expect(s.delivery()?.detail).toContain(" M src/a.ts");
    expect(s.delivery()?.detail).toContain("?? notes.md");
  } finally {
    s.board.dispose();
  }
});

it("a pending dirty-checkout retry is cleared when the board stops", async () => {
  const s = await scenario({
    policy: { action: "merge" },
    assistant: { dirtyRetryMs: 200 },
  });
  try {
    (s.host.mergeToBase as any).mockRejectedValue(
      new Error("Target checkout has uncommitted changes"),
    );
    s.reply(report());
    await s.finishTurn();
    await vi.waitFor(() => expect(s.delivery()?.dirtyRetries).toBe(1), {
      interval: 2,
    });
  } finally {
    s.board.dispose();
  }
  const calls = (s.host.mergeToBase as any).mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((s.host.mergeToBase as any).mock.calls.length).toBe(calls);
});

// CUSTOM(task-checkpoints) ---------------------------------------------------------------------
const checkpoint = (
  done: string[],
  next: string[],
  extra: Record<string, unknown> = {},
) =>
  `Halfway.\n<report>${JSON.stringify({
    status: "checkpoint",
    summary: `Done: ${done.join(", ") || "nothing"}`,
    progress: { done, next },
    ...extra,
  })}</report>`;

const lastSent = (s: { host: any }) =>
  (s.host.sendAgent as any).mock.calls.at(-1) as [string, string];

/** The task's workspace is its own worktree, where a checkpoint may commit. */
const inWorktree = (s: {
  inventory: any;
  taskId: string;
  board: Workboard;
}) => {
  const card = s.board.snapshot().cards.find((c) => c.id === s.taskId)!;
  s.inventory.workspaces.find(
    (w: any) => w.id === card.workspaceId,
  )!.workspaceKind = "worktree";
};

it("a checkpoint commits in the worktree, keeps the task in progress and resumes it on the same pass", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    inWorktree(s);
    s.reply(checkpoint(["Schema"], ["Engine", "UI"]));
    await s.finishTurn();
    expect(s.stage()).toBe("in-progress");
    expect(s.host.commit).toHaveBeenCalledTimes(1);
    expect(s.host.mergeToBase).not.toHaveBeenCalled();
    expect(s.delivery()).toBeUndefined();
    const progress = s.store.current.assistant.progress[s.taskId];
    expect(progress).toMatchObject({
      done: ["Schema"],
      next: ["Engine", "UI"],
      checkpoints: 1,
      stalls: 0,
    });
    expect(progress.log).toMatchObject([{ checkpoint: 1 }]);
    // The same agent got the resume prompt with its checklist.
    const [agentId, prompt] = lastSent(s);
    expect(agentId).toBe(s.agent.id);
    expect(prompt).toContain("resumes this task from checkpoint 1");
    expect(prompt).toContain("- [x] Schema");
    expect(prompt).toContain("- [ ] Engine");
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "running",
      checkpoint: false,
    });
    expect(s.attempts()).toMatchObject([
      { index: 1, outcome: "checkpoint" },
      { index: 2, trigger: "checkpoint", outcome: "running" },
    ]);
    expect(s.history.kinds()).toContain("checkpoint");
    // Finishing after the checkpoint delivers as usual.
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.host.mergeToBase).toHaveBeenCalledTimes(1);
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint with resumeAfter waits without holding a slot and resumes at that time", async () => {
  const s = await scenario();
  try {
    const orchestrator = s.board.snapshot().orchestrators[0];
    await s.board.mutate({
      action: "orchestrator-save",
      orchestrator: { ...orchestrator, maxConcurrent: 1 },
    });
    const resumeAfter = new Date(
      Date.parse("2026-09-23T00:00:00Z") + 3_600_000,
    ).toISOString();
    s.reply(
      checkpoint(["Push"], ["Read CI"], { resumeAfter, waitingFor: "CI" }),
    );
    const sent = (s.host.sendAgent as any).mock.calls.length;
    await s.finishTurn();
    expect(s.stage()).toBe("in-progress");
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "waiting",
      checkpoint: true,
      resumeAt: resumeAfter,
      waitingFor: "CI",
    });
    expect(
      s.board.snapshot().orchestratorStatus[orchestrator.id],
    ).toMatchObject({ running: 0, paused: 1 });
    // The only slot is free: a second task starts while the first one waits.
    await s.board.mutate({
      action: "create",
      title: "Second",
      description: "",
      projectId: "p",
    });
    const second = s.board
      .snapshot()
      .cards.find((c) => c.title === "Second")!.id;
    await s.board.mutate({
      action: "stage",
      taskId: second,
      stage: "ready",
      expectedLabels: [],
    });
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[second]?.status).toBe("running");
    // Not before its time, and not while the slot is taken.
    s.advance(3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("waiting");
    expect((s.host.sendAgent as any).mock.calls.length).toBe(sent);
    // Once the slot frees up, the due task resumes.
    await s.store.update((data) => {
      data.orchestrations[second].status = "finished";
    });
    s.inventory.agents.find(
      (a) => a.id === s.store.current.orchestrations[second].agentId,
    )!.activity = "idle";
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("running");
    expect(lastSent(s)[1]).toContain("You were waiting for: CI");
  } finally {
    s.board.dispose();
  }
});

it("a waiting checkpoint resumes at its time on the periodic pass", async () => {
  const s = await scenario();
  try {
    s.reply(
      checkpoint(["Push"], ["Read CI"], {
        resumeAfter: "2026-09-23T02:00:00Z",
      }),
    );
    await s.finishTurn();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("waiting");
    s.advance(60_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("waiting");
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("running");
  } finally {
    s.board.dispose();
  }
});

it("with its agent gone, a new agent resumes the checkpoint with the handoff", async () => {
  const s = await scenario();
  try {
    vi.mocked(s.host.currentBranch).mockResolvedValue("task-branch");
    s.reply(
      checkpoint(["Schema"], ["UI"], { resumeAfter: "2026-09-23T01:00:00Z" }),
    );
    await s.finishTurn();
    s.agent.archivedAt = "2026-09-23T00:30:00Z";
    const starts = (s.host.startAgent as any).mock.calls.length;
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect((s.host.startAgent as any).mock.calls.length).toBe(starts + 1);
    const prompt = (s.host.startAgent as any).mock.calls.at(-1)[1]
      .prompt as string;
    expect(prompt).toContain("# Task"); // the ticket
    expect(prompt).toContain("Do it");
    expect(prompt).toContain("## Handoff");
    expect(prompt).toContain("on branch `task-branch`");
    expect(prompt).toContain("- [x] Schema");
    expect(prompt).toContain("- [ ] UI");
    expect(prompt).toContain("Its last summary:\n\nDone: Schema");
    const run = s.board.snapshot().orchestrations[s.taskId];
    expect(run.status).toBe("running");
    expect(run.agentId).not.toBe(s.agent.id);
  } finally {
    s.board.dispose();
  }
});

it("the 6th checkpoint goes to Needs you as stalled", async () => {
  const s = await scenario();
  try {
    inWorktree(s);
    for (let i = 1; i <= 6; i++) {
      s.reply(checkpoint([`Step ${i}`], ["More"]));
      await s.finishTurn();
      s.advance(1000);
      if (i < 6) {
        expect(s.stage()).toBe("in-progress");
        expect(s.delivery()).toBeUndefined();
      }
    }
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "stalled",
    });
    expect(s.delivery()!.detail).toContain("limit of 5");
    expect(s.stage()).toBe("review");
    expect(s.host.commit).toHaveBeenCalledTimes(6);
    // Sending it back gives it a new budget.
    await s.board.mutate({
      action: "review",
      taskId: s.taskId,
      outcome: "continue",
      feedback: "Keep going",
    });
    expect(s.store.current.assistant.progress[s.taskId]).toMatchObject({
      checkpoints: 0,
      stalls: 0,
    });
    expect(lastSent(s)[1]).toContain("Keep going");
  } finally {
    s.board.dispose();
  }
});

it("checkpoints in a row that complete no new item go to Needs you as stalled", async () => {
  const s = await scenario();
  try {
    s.reply(checkpoint(["Schema"], ["UI"]));
    await s.finishTurn();
    s.reply(checkpoint(["Schema"], ["UI"]));
    await s.finishTurn();
    expect(s.delivery()).toBeUndefined();
    expect(s.store.current.assistant.progress[s.taskId].stalls).toBe(1);
    s.reply(checkpoint(["schema "], ["UI"]));
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "stalled",
    });
    expect(s.delivery()!.detail).toContain("2 checkpoints in a row");
  } finally {
    s.board.dispose();
  }
});

it("the overview lists a task between checkpoints as waiting, with its progress", async () => {
  const s = await scenario();
  try {
    s.reply(
      checkpoint(["A", "B"], ["C"], {
        resumeAfter: "2026-09-23T05:00:00Z",
        waitingFor: "CI",
      }),
    );
    await s.finishTurn();
    const overview = buildOverview(s.board.assistantSource());
    expect(overview.running).toMatchObject([
      {
        taskId: s.taskId,
        stage: "waiting",
        resumeAt: "2026-09-23T05:00:00.000Z",
        waitingFor: "CI",
        progress: { done: 2, total: 3, checkpoints: 1 },
      },
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint that arrives late leaves Needs you and resumes from In progress", async () => {
  const s = await scenario();
  try {
    s.reply("Waiting for the subagent.");
    await s.finishTurn();
    expect(s.delivery()).toMatchObject({ reason: "no-report" });
    expect(s.stage()).toBe("review");
    s.agent.activity = "running";
    await s.board.refresh();
    s.reply(checkpoint(["Schema"], ["UI"]));
    s.agent.activity = "idle";
    s.agent.updatedAt = "2026-09-23T00:05:00Z";
    s.advance(10_000);
    await s.board.refresh();
    s.advance(21_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
    expect(s.stage()).toBe("in-progress");
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("running");
    expect(lastSent(s)[1]).toContain("resumes this task from checkpoint 1");
  } finally {
    s.board.dispose();
  }
});

it("a waiting checkpoint moved out of In progress by hand does not resume", async () => {
  const s = await scenario();
  try {
    s.reply(
      checkpoint(["Push"], ["Read CI"], {
        resumeAfter: "2026-09-23T01:00:00Z",
      }),
    );
    await s.finishTurn();
    const card = s.board.snapshot().cards.find((c) => c.id === s.taskId)!;
    await s.board.mutate({
      action: "stage",
      taskId: s.taskId,
      stage: "done",
      expectedLabels: card.managedLabels,
    });
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "finished",
      checkpoint: false,
    });
    expect(buildOverview(s.board.assistantSource()).running).toEqual([]);
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint outside a worktree does not commit and says so in the log", async () => {
  const s = await scenario();
  try {
    s.reply(checkpoint(["Schema"], ["UI"]));
    await s.finishTurn();
    expect(s.host.commit).not.toHaveBeenCalled();
    expect(s.store.current.assistant.progress[s.taskId].log[0].text).toContain(
      "not committed: the task does not run in a worktree",
    );
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("running");
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint resume that cannot reach an agent needs you (agent-error)", async () => {
  const s = await scenario();
  try {
    s.reply(
      checkpoint(["Schema"], ["UI"], { resumeAfter: "2026-09-23T01:00:00Z" }),
    );
    await s.finishTurn();
    vi.mocked(s.host.sendAgent).mockRejectedValueOnce(
      new Error("socket closed"),
    );
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "failed",
      checkpoint: false,
    });
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "agent-error",
    });
    expect(s.delivery()!.detail).toContain(
      "Could not resume from the checkpoint: socket closed",
    );
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint during an auto-fix ends the fix and resumes from In progress", async () => {
  const verify = vi
    .fn()
    .mockResolvedValue({ passed: false, output: "1 test failed: foo" });
  const s = await scenario({
    policy: { action: "merge", verifyCommand: "npm test", autoFixes: 1 },
    assistant: { verify },
  });
  try {
    s.reply(report());
    await s.finishTurn();
    await s.settled("fixing");
    expect(s.stage()).toBe("review");
    s.reply(
      checkpoint(["Fix A"], ["Fix B"], {
        resumeAfter: "2026-09-23T03:00:00Z",
        waitingFor: "CI",
      }),
    );
    await s.finishTurn();
    expect(s.delivery()).toBeUndefined();
    expect(s.stage()).toBe("in-progress");
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "waiting",
      checkpoint: true,
    });
    expect(buildOverview(s.board.assistantSource()).running).toMatchObject([
      { taskId: s.taskId, stage: "waiting" },
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a queued or waiting task whose agent runs a turn anyway uses its slot", async () => {
  const s = await scenario();
  try {
    s.reply(
      checkpoint(["Push"], ["Read CI"], {
        resumeAfter: "2026-09-23T05:00:00Z",
      }),
    );
    await s.finishTurn();
    const id = s.board.snapshot().orchestrators[0].id;
    expect(s.board.snapshot().orchestratorStatus[id].running).toBe(0);
    s.agent.activity = "running";
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("waiting");
    expect(s.board.snapshot().orchestratorStatus[id].running).toBe(1);
  } finally {
    s.board.dispose();
  }
});

it("a checkpoint that waits for something does not count as a stall", async () => {
  const s = await scenario();
  try {
    for (let i = 0; i < 3; i++) {
      s.reply(checkpoint(["Push"], ["Read CI"], { waitingFor: "CI" }));
      await s.finishTurn();
    }
    expect(s.delivery()).toBeUndefined();
    expect(s.store.current.assistant.progress[s.taskId]).toMatchObject({
      checkpoints: 3,
      stalls: 0,
    });
  } finally {
    s.board.dispose();
  }
});

it("a night task waiting at a checkpoint holds the power-off and stays a night task", async () => {
  const s = await scenario();
  try {
    await s.store.update((data) => {
      data.orchestrations[s.taskId].night = true;
    });
    s.reply(
      checkpoint(["Push"], ["Read CI"], {
        resumeAfter: "2026-09-23T01:00:00Z",
      }),
    );
    await s.finishTurn();
    expect(
      await (s.board as any).nightBlocker("2026-09-22T22:00:00.000Z"),
    ).toBe("night tasks are still running");
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "running",
      night: true,
    });
  } finally {
    s.board.dispose();
  }
});

// CUSTOM(usage-limit) --------------------------------------------------------------------------
const LIMIT =
  "You've hit your 5-hour limit · resets 11:30pm (America/Sao_Paulo)";
/** 23:30 São Paulo on the scenario's first day (2026-09-22, UTC-3), plus the 2-minute margin. */
const LIMIT_RESUME = "2026-09-23T02:32:00.000Z";

/** A new Workboard on the same store and host whose clock reads `at`. */
async function reopenAt(
  s: { host: any; store: any; history: any; board: Workboard },
  at: string,
) {
  s.board.dispose();
  const board = new Workboard(s.host, s.store, () => Date.parse(at), 60000, {
    history: s.history,
    wakeDelayMs: 5,
  });
  await board.start();
  return board;
}

it("a turn cut by the usage limit waits in progress until the reset, then resumes the same agent", async () => {
  const s = await scenario({ policy: { action: "merge" } });
  try {
    s.reply(LIMIT);
    const sent = (s.host.sendAgent as any).mock.calls.length;
    await s.finishTurn();
    expect(s.stage()).toBe("in-progress");
    expect(s.delivery()).toBeUndefined();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "waiting",
      checkpoint: true,
      limited: true,
      limitPauses: 1,
      resumeAt: LIMIT_RESUME,
    });
    expect(s.attempts()).toMatchObject([{ outcome: "usage-limit" }]);
    expect(s.history.kinds()).toContain("usage-limit");
    expect(s.history.kinds()).not.toContain("needs-you");
    // Not before the reset.
    s.advance(3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("waiting");
    expect((s.host.sendAgent as any).mock.calls.length).toBe(sent);
    // After it, on the next pass.
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "running",
      limited: false,
      checkpoint: false,
    });
    const [agentId, prompt] = lastSent(s);
    expect(agentId).toBe(s.agent.id);
    expect(prompt).toContain("usage limit was reached");
    expect(s.attempts()).toMatchObject([
      { index: 1, outcome: "usage-limit" },
      { index: 2, trigger: "usage-limit", outcome: "running" },
    ]);
    // A normal end delivers and resets the count.
    s.reply(report());
    await s.finishTurn();
    await s.settled("delivered");
    expect(s.board.snapshot().orchestrations[s.taskId].limitPauses).toBe(0);
  } finally {
    s.board.dispose();
  }
});

it("a usage-limit pause already due resumes when the Workboard starts", async () => {
  const s = await scenario();
  let board = s.board;
  try {
    s.reply(LIMIT);
    await s.finishTurn();
    expect(s.store.current.orchestrations[s.taskId].status).toBe("waiting");
    // The daemon was off at the reset and comes back after it.
    board = await reopenAt(s, "2026-09-23T08:00:00Z");
    expect(s.store.current.orchestrations[s.taskId].status).toBe("running");
    expect(lastSent(s)[1]).toContain("usage limit was reached");
  } finally {
    board.dispose();
  }
});

it("an agent stopped with the usage limit as its error waits for the reset instead of being nudged", async () => {
  const s = await scenario();
  try {
    s.agent.activity = "error";
    (s.agent as any).lastError = LIMIT;
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "waiting",
      limited: true,
      resumeAt: LIMIT_RESUME,
    });
    expect(
      (s.host.sendAgent as any).mock.calls.some(
        ([, text]: [string, string]) =>
          text === "Continue the task where you stopped.",
      ),
    ).toBe(false);
    expect(s.delivery()).toBeUndefined();
  } finally {
    s.board.dispose();
  }
});

it("hitting the limit again pauses again, and past the limit of pauses the task needs you", async () => {
  const s = await scenario();
  try {
    // No readable reset: each pause waits an hour.
    s.reply("You've hit your limit");
    await s.finishTurn();
    for (let pause = 2; pause <= 3; pause++) {
      s.advance(2 * 3_600_000);
      await s.board.refresh();
      expect(s.board.snapshot().orchestrations[s.taskId].status).toBe(
        "running",
      );
      await s.finishTurn();
      expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
        status: "waiting",
        limitPauses: pause,
      });
    }
    s.advance(2 * 3_600_000);
    await s.board.refresh();
    await s.finishTurn();
    expect(s.stage()).toBe("review");
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "usage-limit",
    });
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "finished",
      limited: false,
      limitPauses: 0,
    });
    expect(s.attempts().map((a) => a.outcome)).toEqual([
      "usage-limit",
      "usage-limit",
      "usage-limit",
      "usage-limit",
    ]);
  } finally {
    s.board.dispose();
  }
});

it("a wake the chat answered with the usage limit is told again after the reset, also after a restart", async () => {
  const s = await wake();
  let board = s.board;
  try {
    await s.blocked();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeTruthy());
    expect(s.store.current.assistant.wakeTurn).toMatchObject({
      agentId: s.chatId,
      taskIds: [s.taskId],
    });
    // The chat's turn ends on the usage limit.
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    s.reply(LIMIT);
    s.advance(30_000);
    await s.board.refresh();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeNull());
    expect(s.store.current.assistant).toMatchObject({
      wakeAt: LIMIT_RESUME,
      wakeTurn: null,
    });
    expect(
      s.history.events.filter((e) => e.kind === "usage-limit"),
    ).toHaveLength(1);
    // Not before the reset.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(1);
    // The plugin comes back after the reset: the chat hears about the task again.
    s.reply("On it.");
    board = await reopenAt(s, "2026-09-23T03:00:00Z");
    await vi.waitFor(() => expect(s.sent()).toHaveLength(2));
    expect(s.sent()[1]![1]).toContain(`${s.taskId} | Task | Project | blocked`);
    await vi.waitFor(() => expect(s.store.current.assistant.wakeAt).toBeNull());
  } finally {
    board.dispose();
  }
});

it("a wake turn that ends normally is forgotten and the task stays told", async () => {
  const s = await wake();
  try {
    await s.blocked();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeTurn).toBeTruthy(),
    );
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    s.reply("Merged it.");
    s.advance(30_000);
    await s.board.refresh();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeTurn).toBeNull(),
    );
    expect(s.delivery()?.toldAt).toBeTruthy();
    expect(s.store.current.assistant.wakeAt).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a wake answered with a reply that quotes a limit notice keeps the task told", async () => {
  const s = await wake();
  try {
    await s.blocked();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeTurn).toBeTruthy(),
    );
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    s.reply(`"Task" stopped again: ${LIMIT}. It needs you.`);
    s.advance(30_000);
    await s.board.refresh();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeTurn).toBeNull(),
    );
    expect(s.delivery()?.toldAt).toBeTruthy();
    expect(s.store.current.assistant.wakeAt).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("a new wake reads the last wake's turn first instead of replacing it", async () => {
  const s = await wake();
  try {
    await s.blocked();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeTruthy());
    // The chat's turn ended on the limit; before any refresh, another task needs the user.
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    s.reply(LIMIT);
    const second = await s.another();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeAt).toBe(LIMIT_RESUME),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(s.sent()).toHaveLength(1);
    expect(s.delivery()?.toldAt).toBeNull();
    expect(s.store.current.assistant.deliveries[second]?.toldAt).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("Ready to start waits while a task of the orchestrator is paused by the usage limit", async () => {
  const s = await scenario();
  try {
    s.reply(LIMIT);
    await s.finishTurn();
    s.advance(1000);
    await s.board.mutate({
      action: "create",
      title: "Second",
      description: "",
      projectId: "p",
    });
    const second = s.board
      .snapshot()
      .cards.find((c) => c.title === "Second")!.id;
    await s.board.mutate({
      action: "stage",
      taskId: second,
      stage: "ready",
      expectedLabels: [],
    });
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[second]).toBeUndefined();
    const owner = s.store.current.orchestrations[s.taskId].orchestratorId!;
    expect(
      s.store.current.orchestratorLogs[owner]?.map((entry) => entry.text),
    ).toContain("Ready to start waits: a task is paused by the usage limit");
    // After the reset the paused task resumes first, then the new one starts.
    s.advance(3 * 3_600_000);
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId].status).toBe("running");
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[second]?.status).toBe("running");
  } finally {
    s.board.dispose();
  }
});

it("a usage-limit pause moved out of In progress by hand stops and forgets its pauses", async () => {
  const s = await scenario();
  try {
    s.reply(LIMIT);
    await s.finishTurn();
    const card = s.board.snapshot().cards.find((c) => c.id === s.taskId)!;
    await s.board.mutate({
      action: "stage",
      taskId: s.taskId,
      stage: "done",
      expectedLabels: card.managedLabels,
    });
    await s.board.refresh();
    expect(s.board.snapshot().orchestrations[s.taskId]).toMatchObject({
      status: "finished",
      limited: false,
      limitPauses: 0,
    });
  } finally {
    s.board.dispose();
  }
});
