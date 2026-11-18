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
