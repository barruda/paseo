import { expect, it, vi } from "vitest";
import { Workboard, type AssistantOptions } from "../server/workboard";
import {
  CHAT_HISTORY_TASK_ID, // CUSTOM(assistant-compact)
  DEFAULT_COMPACT_AT_TOKENS, // CUSTOM(assistant-compact)
  SEEDED_REVIEW_POLICIES,
  assistantDataSchema,
  assistantSettingsSchema,
  reviewPolicyFor,
  type HistoryEvent,
} from "../shared/assistant";
import {
  BOARD_AGENT_LABEL,
  orchestratorConfigSchema,
  type Data,
} from "../shared/model";
import { fixture } from "./fixtures";
import { buildOverview } from "../server/assistant/views"; // CUSTOM(task-checkpoints)
import { COMPACT_QUESTION } from "../server/assistant/compact"; // CUSTOM(assistant-compact)
import { CHAT_LABEL, CHAT_RULES } from "../server/assistant/chat"; // CUSTOM(assistant-compact)
import { AGENT_REPLACES_LABEL } from "../shared/reply-protocol"; // CUSTOM(assistant-compact-follow)

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
  /** CUSTOM(unattended-automation): board settings, distinct from the assistant's. */
  boardSettings?: Record<string, unknown>;
  git?: boolean;
  assistant?: AssistantOptions;
}

/** A task started by an orchestrator whose agent is running. */
async function scenario(options: Options = {}) {
  const history = memoryHistory();
  const setup = fixture({
    defaultOrchestratorSeeded: true,
    ...(options.boardSettings
      ? { settings: options.boardSettings as Data["settings"] }
      : {}),
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

/** A new chat the user started, as "Restart chat" does; its board state is set by the caller. */
async function anotherChat(s: { host: any; inventory: any }) {
  const id = await s.host.startAgentIn("/chat", {
    provider: "opencode/deepseek",
    modeId: null,
    thinkingOptionId: null,
    title: "Projects Assistant",
    prompt: "hi",
  });
  s.inventory.agents.find((a: { id: string }) => a.id === id)!.activity =
    "idle";
  return id as string;
}

it("a usage-limit wait stored for an archived chat does not hold a Needs you in the current chat", async () => {
  const s = await wake();
  try {
    const old = s.chatId!;
    await s.host.archiveAgent(old);
    const next = await anotherChat(s);
    await s.store.update((data) => {
      data.assistant.chatAgentId = next;
      data.assistant.wakeAt = LIMIT_RESUME;
      data.assistant.wakeAgentId = old;
    });
    await s.blocked();
    await vi.waitFor(() =>
      expect(s.host.sendAgent).toHaveBeenCalledWith(
        next,
        expect.stringContaining(s.taskId),
      ),
    );
    expect(s.store.current.assistant.wakeAt).toBeNull();
    expect(s.store.current.assistant.wakeAgentId).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("restarting the chat drops the old chat's usage-limit wait and tells the new one", async () => {
  const s = await wake();
  try {
    await s.blocked();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeTruthy());
    // The old chat's wake ended on the limit: its tasks are untold and the next wake is reset+2m.
    s.inventory.agents.find((a) => a.id === s.chatId)!.activity = "idle";
    s.reply(LIMIT);
    s.advance(30_000);
    await s.board.refresh();
    await vi.waitFor(() => expect(s.delivery()?.toldAt).toBeNull());
    expect(s.store.current.assistant).toMatchObject({
      wakeAt: LIMIT_RESUME,
      wakeAgentId: s.chatId,
    });
    // The user restarts the chat; the new chat is idle and has plenty of quota.
    const { agentId: next } = await s.board.openChat(true, true);
    expect(next).not.toBe(s.chatId);
    expect(s.store.current.assistant.wakeAt).toBeNull();
    expect(s.store.current.assistant.wakeAgentId).toBeNull();
    s.inventory.agents.find((a) => a.id === next)!.activity = "idle";
    s.reply("On it.");
    await vi.waitFor(() =>
      expect(s.host.sendAgent).toHaveBeenCalledWith(
        next,
        expect.stringContaining(s.taskId),
      ),
    );
  } finally {
    s.board.dispose();
  }
});

it("checkWakeTurn does not read an archived chat's turn as the current chat's reply", async () => {
  const s = await wake();
  try {
    const old = s.chatId!;
    await s.host.archiveAgent(old);
    const next = await anotherChat(s);
    await s.store.update((data) => {
      data.assistant.chatAgentId = next;
      data.assistant.wakeAt = LIMIT_RESUME;
      data.assistant.wakeAgentId = old;
      data.assistant.wakeTurn = {
        agentId: old,
        toldAt: "2026-09-23T00:00:00.000Z",
        taskIds: [s.taskId],
      };
    });
    // The current chat's last reply is a limit notice; the archived chat's is not read.
    s.reply(LIMIT);
    s.advance(30_000);
    await s.board.refresh();
    await vi.waitFor(() =>
      expect(s.store.current.assistant.wakeTurn).toBeNull(),
    );
    expect(s.store.current.assistant.wakeAt).toBeNull();
    expect(s.store.current.assistant.wakeAgentId).toBeNull();
    expect(s.history.kinds()).not.toContain("usage-limit");
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

// CUSTOM(assistant-compact): a full chat restarts with a summary once its turn ends.
async function compaction(
  options: { limit?: number; wakeDelayMs?: number } = {},
) {
  const queued = new Set<string>();
  const s = await scenario({
    settings: {
      chat: {
        wakeOnNeedsYou: true,
        ...(options.limit === undefined
          ? {}
          : { compactAtTokens: options.limit }),
      },
    },
    assistant: {
      wakeDelayMs: options.wakeDelayMs ?? 5,
      compactSettleMs: 5,
      chatQueued: (id) => queued.has(id),
    },
  });
  const { agentId: chatId } = await s.board.openChat(false);
  const chat = (id = s.store.current.assistant.chatAgentId!) =>
    s.inventory.agents.find((a) => a.id === id) as any;
  chat().activity = "idle";
  (s.host.askAgent as any).mockResolvedValue("- Open: ship X (task t-1)");
  /** The chat ends a turn with `tokens` of context; its `agent_update` arms the check. */
  const turn = (tokens: number, id?: string) => {
    const agent = chat(id);
    agent.activity = "idle";
    agent.contextUsedTokens = tokens;
    s.board.agentUpdated(agent.id);
  };
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 40));
  const compacted = () =>
    vi.waitFor(() =>
      expect(s.store.current.assistant.chatAgentId).not.toBe(chatId),
    );
  const chatStarts = () =>
    (s.host.startAgentIn as any).mock.calls.map(
      ([, start]: [string, { prompt: string }]) => start.prompt,
    ) as string[];
  return { ...s, chatId, chat, turn, quiet, queued, compacted, chatStarts };
}

it("compaction: the default limit is 180k tokens", () => {
  expect(assistantSettingsSchema.parse({}).chat.compactAtTokens).toBe(
    DEFAULT_COMPACT_AT_TOKENS,
  );
  expect(DEFAULT_COMPACT_AT_TOKENS).toBe(180_000);
});

it("compaction: a turn that ends above the limit restarts the chat with the summary as its first message, archives the old one and records it", async () => {
  const s = await compaction();
  try {
    s.turn(185_000);
    await s.compacted();
    const next = s.store.current.assistant.chatAgentId!;
    expect(s.host.askAgent).toHaveBeenCalledWith(s.chatId, COMPACT_QUESTION);
    const prompt = s.chatStarts().at(-1)!;
    expect(prompt.startsWith(CHAT_RULES)).toBe(true);
    expect(prompt).not.toContain("Call board_overview, then reply");
    expect(prompt).toContain("[Inherited context]");
    expect(prompt).toContain("not a new request");
    expect(prompt).toContain("Reply with only `ok`");
    expect(prompt).toContain(
      "<inherited-context>\n- Open: ship X (task t-1)\n</inherited-context>",
    );
    expect(s.host.archiveAgent).toHaveBeenCalledWith(s.chatId);
    expect(await s.host.agentAlive(s.chatId)).toBe(false);
    // CUSTOM(assistant-compact-follow): the new chat names the one it replaces, so the app moves
    // the open tab and its draft over.
    expect((s.host.startAgentIn as any).mock.calls.at(-1)[1].labels).toEqual({
      [CHAT_LABEL]: "true",
      [AGENT_REPLACES_LABEL]: s.chatId,
    });
    // The chat the board first opened replaces nothing.
    expect((s.host.startAgentIn as any).mock.calls[0][1].labels).toEqual({
      [CHAT_LABEL]: "true",
    });
    expect(s.store.current.assistant.compact).toMatchObject({
      agentId: next,
      fromAgentId: s.chatId,
      fromTokens: 185_000,
      bornTokens: null,
    });
    await vi.waitFor(() =>
      expect(s.history.kinds()).toContain("chat-compacted"),
    );
    expect(
      s.history.events.find((e) => e.kind === "chat-compacted"),
    ).toMatchObject({
      taskId: CHAT_HISTORY_TASK_ID,
      agentId: next,
      text: "Chat compacted: 185000 tokens → new chat",
      detail: "- Open: ship X (task t-1)",
    });
    // Nothing is said in the chat itself.
    expect(s.host.sendAgent).not.toHaveBeenCalledWith(
      s.chatId,
      expect.anything(),
    );
  } finally {
    s.board.dispose();
  }
});

it("compaction: below the limit nothing happens", async () => {
  const s = await compaction();
  try {
    s.turn(179_999);
    await s.quiet();
    expect(s.host.askAgent).not.toHaveBeenCalled();
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
  } finally {
    s.board.dispose();
  }
});

it("compaction: never during a turn or a permission; it waits for the next idle", async () => {
  const s = await compaction();
  try {
    s.chat().contextUsedTokens = 190_000;
    for (const activity of ["running", "waiting", "error"]) {
      s.chat().activity = activity;
      s.board.agentUpdated(s.chatId);
      await s.quiet();
    }
    expect(s.host.askAgent).not.toHaveBeenCalled();
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
    s.turn(190_000);
    await s.compacted();
  } finally {
    s.board.dispose();
  }
});

it("compaction: a pending board wake or quick message waits for the next idle", async () => {
  const s = await compaction({ wakeDelayMs: 60_000 });
  try {
    // A task needs the user: its wake waits on the timer.
    s.reply(
      `x\n<report>${JSON.stringify({ status: "blocked", summary: "Stuck" })}</report>`,
    );
    await s.finishTurn();
    await s.settled("needs-you");
    s.turn(190_000);
    await s.quiet();
    expect(s.host.askAgent).not.toHaveBeenCalled();
    s.board.dispose();

    const q = await compaction();
    try {
      q.queued.add(q.chatId);
      q.turn(190_000);
      await q.quiet();
      expect(q.host.askAgent).not.toHaveBeenCalled();
      q.queued.clear();
      q.turn(190_000);
      await q.compacted();
    } finally {
      q.board.dispose();
    }
  } finally {
    s.board.dispose();
  }
});

it("compaction: a message that reaches the chat while it summarizes cancels the round", async () => {
  const s = await compaction();
  try {
    (s.host.askAgent as any).mockImplementation(async () => {
      s.chat().lastUserMessageAt = "2026-09-23T00:05:00.000Z";
      return "Summary";
    });
    s.turn(190_000);
    await vi.waitFor(() => expect(s.host.askAgent).toHaveBeenCalled());
    await s.quiet();
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
    expect(s.host.archiveAgent).not.toHaveBeenCalled();
  } finally {
    s.board.dispose();
  }
});

it("compaction: a new chat born above the limit is not compacted again; one born below it is, once it grows", async () => {
  const s = await compaction();
  try {
    s.turn(185_000);
    await s.compacted();
    const born = s.store.current.assistant.chatAgentId!;
    s.turn(200_000, born);
    await vi.waitFor(() =>
      expect(s.store.current.assistant.compact?.bornTokens).toBe(200_000),
    );
    s.turn(260_000, born);
    await s.quiet();
    expect(s.store.current.assistant.chatAgentId).toBe(born);
    expect(s.host.askAgent).toHaveBeenCalledTimes(1);
  } finally {
    s.board.dispose();
  }
  const t = await compaction();
  try {
    t.turn(185_000);
    await t.compacted();
    const born = t.store.current.assistant.chatAgentId!;
    t.turn(30_000, born);
    await vi.waitFor(() =>
      expect(t.store.current.assistant.compact?.bornTokens).toBe(30_000),
    );
    t.turn(181_000, born);
    await vi.waitFor(() =>
      expect(t.store.current.assistant.chatAgentId).not.toBe(born),
    );
  } finally {
    t.board.dispose();
  }
});

it("compaction: the limit comes from the setting, and 0 turns it off", async () => {
  const s = await compaction({ limit: 100_000 });
  try {
    s.turn(120_000);
    await s.compacted();
  } finally {
    s.board.dispose();
  }
  const off = await compaction({ limit: 0 });
  try {
    off.turn(900_000);
    await off.quiet();
    expect(off.host.askAgent).not.toHaveBeenCalled();
  } finally {
    off.board.dispose();
  }
});

it("compaction: without a summary from the chat, its last replies and the user's messages go instead", async () => {
  const s = await compaction();
  try {
    (s.host.askAgent as any).mockRejectedValue(new Error("no side questions"));
    const row = (type: string, text: string) => ({
      timestamp: "t",
      item: { type, text },
    });
    (s.host.timeline as any).mockReturnValue(async () => ({
      entries: [
        row("user_message", "old question"),
        row("assistant_message", "old answer"),
        row("user_message", "ship X"),
        row("assistant_message", "Started "),
        row("tool_call", ""),
        row("assistant_message", "X."),
        row("user_message", "and Y?"),
        row("assistant_message", "Y waits for you."),
        row("user_message", "ok"),
        row("assistant_message", "Done."),
      ],
    }));
    s.turn(190_000);
    await s.compacted();
    const prompt = s.chatStarts().at(-1)!;
    expect(prompt).toContain(
      "User: ship X\n\nAssistant: Started X.\n\nUser: and Y?\n\nAssistant: Y waits for you.\n\nUser: ok\n\nAssistant: Done.",
    );
    expect(prompt).not.toContain("old answer");
  } finally {
    s.board.dispose();
  }
});

it("compaction: the board wakes the new chat, and nothing goes to the archived one", async () => {
  const s = await compaction();
  try {
    s.turn(185_000);
    await s.compacted();
    const next = s.store.current.assistant.chatAgentId!;
    s.chat(next).activity = "idle";
    s.reply(
      `x\n<report>${JSON.stringify({ status: "blocked", summary: "Stuck" })}</report>`,
    );
    await s.finishTurn();
    await s.settled("needs-you");
    const sentTo = () =>
      (s.host.sendAgent as any).mock.calls.map(([id]: [string]) => id);
    await vi.waitFor(() => expect(sentTo()).toContain(next));
    expect(sentTo()).not.toContain(s.chatId);
    expect(s.store.current.assistant.wakeTurn?.agentId).toBe(next);
  } finally {
    s.board.dispose();
  }
});

it("compaction: a round that fails holds the next one 30 minutes and records it; a manual restart clears the hold", async () => {
  const s = await compaction();
  try {
    (s.host.startAgentIn as any).mockRejectedValueOnce(
      new Error("spawn failed"),
    );
    s.turn(190_000);
    await vi.waitFor(() =>
      expect(s.history.kinds()).toContain("chat-compact-failed"),
    );
    expect(
      s.history.events.find((e) => e.kind === "chat-compact-failed"),
    ).toMatchObject({
      taskId: CHAT_HISTORY_TASK_ID,
      agentId: s.chatId,
      detail: "spawn failed",
    });
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
    expect(s.store.current.assistant.compactRetryAt).toBe(
      "2026-09-23T00:30:00.000Z",
    );
    expect(s.host.askAgent).toHaveBeenCalledTimes(1);
    // Neither the chat's updates nor the periodic pass summarize it again before the hold ends.
    s.turn(195_000);
    await s.quiet();
    await s.board.refresh();
    await s.quiet();
    expect(s.host.askAgent).toHaveBeenCalledTimes(1);
    s.advance(30 * 60_000);
    s.turn(195_000);
    await s.compacted();
    expect(s.host.askAgent).toHaveBeenCalledTimes(2);
    expect(s.store.current.assistant.compactRetryAt).toBeNull();
  } finally {
    s.board.dispose();
  }
  const m = await compaction();
  try {
    (m.host.askAgent as any).mockRejectedValue(new Error("no side questions"));
    m.turn(190_000); // no summary and no timeline: the round fails
    await vi.waitFor(() =>
      expect(m.store.current.assistant.compactRetryAt).not.toBeNull(),
    );
    await m.board.openChat(true, true);
    expect(m.store.current.assistant.compactRetryAt).toBeNull();
  } finally {
    m.board.dispose();
  }
});

it("compaction: a message that reaches the old chat while the new one starts keeps the old one and archives the new", async () => {
  const s = await compaction();
  try {
    const start = (s.host.startAgentIn as any).getMockImplementation();
    let started = "";
    (s.host.startAgentIn as any).mockImplementationOnce(
      async (cwd: string, input: unknown) => {
        started = await start(cwd, input);
        s.chat(s.chatId).lastUserMessageAt = "2026-09-23T00:05:00.000Z";
        return started;
      },
    );
    s.turn(190_000);
    await vi.waitFor(() =>
      expect(s.host.archiveAgent).toHaveBeenCalledWith(started),
    );
    await s.quiet();
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
    expect(await s.host.agentAlive(s.chatId)).toBe(true);
    expect(s.host.archiveAgent).not.toHaveBeenCalledWith(s.chatId);
    expect(s.history.kinds()).not.toContain("chat-compacted");
    // Not a failure: the next idle tries again.
    expect(s.store.current.assistant.compactRetryAt).toBeNull();
    s.turn(195_000);
    await s.compacted();
  } finally {
    s.board.dispose();
  }
});

it("compaction: a message that arrives before the new chat starts cancels it", async () => {
  const s = await compaction();
  try {
    const calls = (s.host.startAgentIn as any).mock.calls.length;
    (s.host.askAgent as any).mockImplementation(async () => {
      s.chat().activity = "running";
      return "Summary";
    });
    s.turn(190_000);
    await vi.waitFor(() => expect(s.host.askAgent).toHaveBeenCalled());
    await s.quiet();
    expect((s.host.startAgentIn as any).mock.calls).toHaveLength(calls);
    expect(s.store.current.assistant.chatAgentId).toBe(s.chatId);
    expect(s.store.current.assistant.compactRetryAt).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("compaction: a chat born just under the limit compacts again only after growing 10% of the limit", async () => {
  const s = await compaction();
  try {
    s.turn(185_000);
    await s.compacted();
    const born = s.store.current.assistant.chatAgentId!;
    s.turn(170_000, born);
    await vi.waitFor(() =>
      expect(s.store.current.assistant.compact?.bornTokens).toBe(170_000),
    );
    s.turn(187_999, born); // grew 17 999 < 18 000
    await s.quiet();
    expect(s.store.current.assistant.chatAgentId).toBe(born);
    expect(s.host.askAgent).toHaveBeenCalledTimes(1);
    s.turn(188_000, born);
    await vi.waitFor(() =>
      expect(s.store.current.assistant.chatAgentId).not.toBe(born),
    );
  } finally {
    s.board.dispose();
  }
});

// CUSTOM(assistant-cards)
it("the history says who did it: the user, the assistant or the board's engine", async () => {
  const s = await scenario();
  try {
    const byKind = (kind: string) =>
      s.history.events.filter((e) => e.kind === kind).map((e) => e.by);
    expect(byKind("task-created")).toEqual(["user"]);
    expect(byKind("task-moved")).toEqual(["user"]);
    expect(byKind("task-started")).toEqual(["orchestrator"]);
    s.reply(report({ status: "needs_input", question: "Which database?" }));
    await s.finishTurn();
    expect(byKind("report")).toEqual(["orchestrator"]);
    await s.board.assistantAction(
      { type: "continue", taskId: s.taskId, feedback: "Postgres" },
      "assistant",
    );
    expect(byKind("task-continued")).toEqual(["assistant"]);
    await s.board.mutate(
      { action: "create", title: "Other", description: "", projectId: "p" },
      "assistant",
    );
    expect(byKind("task-created")).toEqual(["user", "assistant"]);
  } finally {
    s.board.dispose();
  }
});

it("a report's options become one-tap answers that continue the task once", async () => {
  const s = await scenario();
  try {
    const options = [
      { id: "a", label: "Postgres", gains: "joins", costs: "a server" },
      { id: "b", label: "SQLite" },
    ];
    s.reply(
      report({
        status: "needs_input",
        question: "Which database?",
        options,
        recommend: "b",
        why: "No server to run",
      }),
    );
    await s.finishTurn();
    const record = () => s.store.current.orchestrations[s.taskId];
    expect(record().ask).toEqual({
      question: "Which database?",
      options: [options[0], { ...options[1], gains: null, costs: null }],
      recommend: "b",
      why: "No server to run",
    });
    await expect(
      s.board.assistantAction({
        type: "answer",
        agentId: s.agent.id,
        text: "Escolho a",
        question: "Which cache?",
      }),
    ).rejects.toThrow("This question was already answered or replaced");
    await s.board.assistantAction({
      type: "answer",
      agentId: s.agent.id,
      text: 'Resposta a "Which database?": escolho b (SQLite).',
      question: "Which database?",
    });
    const sent = (s.host.sendAgent as any).mock.calls.at(-1);
    expect(sent[0]).toBe(s.agent.id);
    expect(sent[1]).toContain("escolho b (SQLite)");
    expect(s.attempts().at(-1)).toMatchObject({
      trigger: "feedback",
      feedback: 'Resposta a "Which database?": escolho b (SQLite).',
    });
    expect(record().ask).toBeNull();
    expect(s.history.events.at(-1)).toMatchObject({
      kind: "task-continued",
      by: "user",
    });
    // The agent works on it again: a second tap is refused.
    await expect(
      s.board.assistantAction({
        type: "answer",
        agentId: s.agent.id,
        text: "Feedback",
        question: null,
      }),
    ).rejects.toThrow("The task's agent is not waiting for an answer");
  } finally {
    s.board.dispose();
  }
});

it("an answer to an agent outside the board is sent to it as a message", async () => {
  const s = await scenario();
  try {
    await s.board.assistantAction({
      type: "answer",
      agentId: "stranger",
      text: 'Sobre "x": y',
      question: null,
    });
    expect(s.host.sendAgent).toHaveBeenCalledWith("stranger", 'Sobre "x": y');
  } finally {
    s.board.dispose();
  }
});

it("answer refuses a card from an older agent, during a delivery step, and on a closed task", async () => {
  const question = "Which database?";
  const asking = () =>
    report({
      status: "needs_input",
      question,
      options: [{ id: "a", label: "Postgres" }],
    });
  const answer = (s: { agent: { id: string } }, agentId?: string) => ({
    type: "answer" as const,
    agentId: agentId ?? s.agent.id,
    text: "More tests",
    question: null,
  });

  // An agent from an earlier run of the task.
  const s = await scenario();
  try {
    s.reply(asking());
    await s.finishTurn();
    await s.store.update((data) => {
      data.assistant.attempts[s.taskId][0].agentId = "old-agent";
    });
    await expect(
      s.board.assistantAction(answer(s, "old-agent")),
    ).rejects.toThrow("This card is from an earlier run of the task");
    expect(s.host.sendAgent).not.toHaveBeenCalledWith(
      "old-agent",
      expect.anything(),
    );
    // A delivery step running for the task.
    (s.board as unknown as { delivering: Set<string> }).delivering.add(
      s.taskId,
    );
    await expect(s.board.assistantAction(answer(s))).rejects.toThrow(
      "A delivery step is already running for this task",
    );
    expect(s.stage()).toBe("review");
  } finally {
    s.board.dispose();
  }

  // Marked Done: neither a comment nor the old question's option reopens it.
  const done = await scenario();
  try {
    done.reply(asking());
    await done.finishTurn();
    await done.board.assistantAction({
      type: "mark-done",
      taskId: done.taskId,
    });
    for (const input of [
      answer(done),
      { ...answer(done), text: "Escolho a", question },
    ])
      await expect(done.board.assistantAction(input)).rejects.toThrow(
        "This task is already closed",
      );
    expect(done.stage()).toBe("done");
    expect(done.delivery()).toMatchObject({ stage: "delivered" });
    expect(done.attempts()).toHaveLength(1);
  } finally {
    done.board.dispose();
  }

  // Dismissed: the task stays in review and the delivery stays dismissed.
  const dismissed = await scenario();
  try {
    dismissed.reply(asking());
    await dismissed.finishTurn();
    await dismissed.board.assistantAction({
      type: "dismiss",
      taskId: dismissed.taskId,
    });
    await expect(
      dismissed.board.assistantAction(answer(dismissed)),
    ).rejects.toThrow("This task is already closed");
    expect(dismissed.stage()).toBe("review");
    expect(dismissed.delivery()).toMatchObject({ stage: "dismissed" });
  } finally {
    dismissed.board.dispose();
  }
});

it("with the assistant off, the report's question is kept for the answer check and replaces an old one", async () => {
  const s = await scenario({ settings: { enabled: false } });
  try {
    await s.store.update((data) => {
      data.orchestrations[s.taskId].ask = {
        question: "Stale?",
        options: [{ id: "x", label: "Old", gains: null, costs: null }],
        recommend: null,
        why: null,
      };
    });
    s.reply(
      report({
        status: "needs_input",
        question: "Which database?",
        options: [{ id: "a", label: "Postgres" }],
      }),
    );
    await s.finishTurn();
    const record = () => s.store.current.orchestrations[s.taskId];
    expect(record().ask?.question).toBe("Which database?");
    await expect(
      s.board.assistantAction({
        type: "answer",
        agentId: s.agent.id,
        text: "Escolho x",
        question: "Stale?",
      }),
    ).rejects.toThrow("This question was already answered or replaced");
    await s.board.assistantAction({
      type: "answer",
      agentId: s.agent.id,
      text: "Escolho a",
      question: "Which database?",
    });
    expect(record().ask).toBeNull();
    expect((s.host.sendAgent as any).mock.calls.at(-1)[1]).toContain(
      "Escolho a",
    );
  } finally {
    s.board.dispose();
  }
});

it("a finish without a question clears the old one with the assistant off", async () => {
  const s = await scenario({ settings: { enabled: false } });
  try {
    await s.store.update((data) => {
      data.orchestrations[s.taskId].ask = {
        question: "Stale?",
        options: [{ id: "x", label: "Old", gains: null, costs: null }],
        recommend: null,
        why: null,
      };
    });
    s.reply(report());
    await s.finishTurn();
    expect(s.store.current.orchestrations[s.taskId].ask).toBeNull();
  } finally {
    s.board.dispose();
  }
});

it("an automatic agent waiting on a permission reaches Needs you within about two minutes", async () => {
  const s = await scenario();
  try {
    (s.agent as any).activity = "waiting";
    (s.agent as any).waitingPermission = true;
    await s.board.refresh(); // starts the wait clock
    s.advance(89_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
    s.advance(2_000);
    await s.board.refresh();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "permission",
    });
    expect(s.board.snapshot().orchestrations[s.taskId].permissionNeedsYou).toBe(
      true,
    );
    expect(s.history.events.at(-1)).toMatchObject({
      kind: "needs-you",
      reason: "permission",
    });
    // The permission clears and the agent runs again: the board drops its Needs you.
    (s.agent as any).activity = "running";
    (s.agent as any).waitingPermission = false;
    s.advance(1_000);
    await s.board.refresh();
    expect(s.delivery()).toBeUndefined();
    expect(s.board.snapshot().orchestrations[s.taskId].permissionNeedsYou).toBe(
      false,
    );
  } finally {
    s.board.dispose();
  }
});

it("the automatic-permission setting reaches the agent the board starts", async () => {
  const on = await scenario();
  try {
    expect((on.host.startAgent as any).mock.calls[0][1].unattended).toBe(true);
  } finally {
    on.board.dispose();
  }
  const off = await scenario({
    boardSettings: { autoPermission: { enabled: false } },
  });
  try {
    expect((off.host.startAgent as any).mock.calls[0][1].unattended).toBe(
      false,
    );
  } finally {
    off.board.dispose();
  }
});

it("a hidden board subagent waiting on a permission brings the task to Needs you", async () => {
  const s = await scenario();
  try {
    s.inventory.agents.push({
      id: "board-child",
      workspaceId: s.agent.workspaceId,
      title: "Review subagent",
      updatedAt: new Date().toISOString(),
      lastUserMessageAt: null,
      archivedAt: null,
      activity: "waiting",
      waitingPermission: true,
      parentAgentId: s.agent.id,
      labels: { [BOARD_AGENT_LABEL]: "true" },
    });
    await s.board.refresh();
    s.advance(91_000);
    await s.board.refresh();
    expect(s.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "permission",
    });
  } finally {
    s.board.dispose();
  }
});
