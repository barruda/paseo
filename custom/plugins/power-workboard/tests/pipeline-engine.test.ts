// CUSTOM(factory): the pipeline engine (docs/factory.md, ticket 11). Pure transitions, then the
// board in active mode running each transition kind on a fixture factory.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GATE_ARCHIVE_ERROR,
  GATE_OPTION_REQUIRED_ERROR,
  GATE_USER_ONLY_ERROR,
} from "../server/workboard";
import { pipelineTools } from "../server/assistant/chat";
import {
  USER_ONLY_REASONS,
  type AutonomyPresetId,
  type UserOnlyReason,
} from "../shared/autonomy";
import type { CompiledPipeline } from "../shared/factory/compile";
import {
  enterStage,
  reworkStage,
  stageChip,
  stageExit,
  startPipeline,
} from "../shared/factory/engine";
import {
  CHECKOUT,
  LIVE_ID,
  boot,
  disposeBooted,
  startTask,
  type Booted,
} from "./factory-boot";

afterEach(() => {
  disposeBooted();
  vi.useRealTimers();
});

const AT = "2026-09-23T00:00:00.000Z";

const stage = (
  id: string,
  fields: Partial<CompiledPipeline["stages"][number]> = {},
): CompiledPipeline["stages"][number] => ({
  id,
  role: "implement",
  worker: null,
  prompt: `Do ${id}.`,
  session: "continue",
  maxVisits: 3,
  gate: null,
  to: "deliver",
  ...fields,
});

const pipeline: CompiledPipeline = {
  id: "p",
  description: "",
  start: "build",
  autonomy: null,
  stages: [
    stage("build", { to: "check" }),
    stage("check", { role: "verify", maxVisits: 2, to: "build" }),
    stage("review", { role: "pm", to: "deliver" }),
  ],
  layout: {},
};

describe("pipeline engine: transitions", () => {
  it("starts at start with one visit", () => {
    const state = startPipeline(pipeline, AT);
    expect(state).toMatchObject({
      id: "p",
      stage: "build",
      visits: { build: 1 },
      pending: false,
      history: [{ stage: "build", via: "start" }],
    });
    expect(stageChip(pipeline, state)).toBe("build 1/3");
  });

  it("a worker stage is entered pending, a pm stage and a built-in are not", () => {
    const start = startPipeline(pipeline, AT);
    const check = enterStage(pipeline, start, "check", "to", AT);
    expect(check.target).toMatchObject({ kind: "worker" });
    expect(check.state).toMatchObject({
      stage: "check",
      pending: true,
      visits: { build: 1, check: 1 },
    });
    const review = enterStage(pipeline, start, "review", "to", AT);
    expect(review.target).toMatchObject({ kind: "pm" });
    expect(review.state.pending).toBe(false);
    const deliver = enterStage(pipeline, start, "deliver", "to", AT);
    expect(deliver.target).toEqual({ kind: "builtin", stage: "deliver" });
    expect(deliver.state.visits).toEqual({ build: 1 });
    expect(stageChip(pipeline, deliver.state)).toBeNull();
  });

  it("one visit past maxVisits is a loop and keeps the stage", () => {
    let state = startPipeline(pipeline, AT);
    state = enterStage(pipeline, state, "check", "to", AT).state;
    state = enterStage(pipeline, state, "build", "to", AT).state;
    state = enterStage(pipeline, state, "check", "to", AT).state;
    state = enterStage(pipeline, state, "build", "to", AT).state;
    const looped = enterStage(pipeline, state, "check", "to", AT);
    expect(looped.target).toBeNull();
    expect(looped.loop).toEqual({ stage: "check", visits: 3, maxVisits: 2 });
    expect(looped.state.stage).toBe("build");
    expect(looped.state.visits.check).toBe(2);
    expect(looped.state.history.at(-1)).toMatchObject({
      stage: "check",
      via: "loop",
    });
  });

  it("names each exit kind and the worker stage before a pm stage", () => {
    expect(stageExit(stage("a", { to: "b" }))).toEqual({ kind: "go", to: "b" });
    expect(
      stageExit(stage("a", { to: [{ stage: "b", when: "Small." }] })),
    ).toEqual({ kind: "choose", candidates: [{ stage: "b", when: "Small." }] });
    const gate = {
      question: "Ok?",
      options: [{ id: "yes", label: "Yes", to: "b" }],
    };
    expect(stageExit(stage("a", { to: null, gate }))).toEqual({
      kind: "gate",
      ...gate,
    });
    let state = startPipeline(pipeline, AT);
    state = enterStage(pipeline, state, "check", "to", AT).state;
    state = enterStage(pipeline, state, "review", "to", AT).state;
    // Feedback from a pm stage goes to the last implement stage, past later worker stages.
    expect(reworkStage(pipeline, state)).toBe("build");
    expect(
      reworkStage(pipeline, { ...state, history: state.history.slice(1) }),
    ).toBe("check");
    expect(stageChip(pipeline, { ...state, stage: "check" })).toBe("check 1/2");
    expect(
      stageChip(pipeline, {
        ...state,
        gate: { cardId: "pm-1", stage: "review", kind: "gate" },
      }),
    ).toBe("review · gate");
  });
});

// ---------------------------------------------------------------------------------------------

const BUILTIN = path.join(
  import.meta.dirname,
  "..",
  "server",
  "factory",
  "builtin",
);
const builtin = (file: string) =>
  readFileSync(path.join(BUILTIN, file), "utf8");

const done = (summary = "Did it") =>
  `Done.\n<report>${JSON.stringify({ status: "done", summary })}</report>`;

/** Boots on the fixture factory with `pipelineYaml` as the project's pipeline. */
function bootWith(
  pipelineYaml: string,
  files: Record<string, string> = {},
  id = "flow",
  autonomy: AutonomyPresetId | null = null,
): Promise<Booted> {
  return boot({
    files: {
      [`pipelines/${id}.yaml`]: pipelineYaml,
      "projects/proj.yaml": `path: ${CHECKOUT}
pipeline: ${id}${autonomy ? `\nautonomy: ${autonomy}` : ""}
delivery:
  action: review
  baseBranch: custom
`,
      ...files,
    },
  });
}

function helpers(s: Booted, taskId: string) {
  const task = () => s.store.current.tasks.find((t) => t.id === taskId)!;
  const card = () => s.board.snapshot().cards.find((c) => c.id === taskId)!;
  const record = () => s.store.current.orchestrations[taskId]!;
  const delivery = () => s.store.current.assistant.deliveries[taskId];
  const starts = () => (s.host.startAgent as any).mock.calls;
  const sends = () => (s.host.sendAgent as any).mock.calls;
  /** The current agent's turn ends with `reply`, and the board settles it. */
  const finish = async (reply: string) => {
    vi.mocked(s.host.lastReply).mockResolvedValue(reply);
    await s.board.refresh(); // sees it running
    const agent = s.inventory.agents.find((a) => a.id === record().agentId)!;
    agent.activity = "idle";
    s.advance(1000);
    await s.board.refresh(); // sees it idle
    s.advance(20_000);
    await s.board.refresh(); // idle long enough to settle
  };
  const gateCard = () =>
    s.board.pmCards().find((c) => c.id === task().pipeline?.gate?.cardId)!;
  return { task, card, record, delivery, starts, sends, finish, gateCard };
}

describe("pipeline engine: the board", () => {
  it("the default pipeline keeps today's flow", async () => {
    const s = await bootWith(
      builtin("pipelines/default.yaml"),
      {
        "roles/implement.md": builtin("roles/implement.md"),
        "roles/review.md": builtin("roles/review.md"),
      },
      "default",
    );
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    // Started by the project's worker with today's prompt: no stage text for an implement start.
    expect(t.starts()).toHaveLength(1);
    expect(t.record().orchestratorId).toBe(LIVE_ID);
    const prompt: string = t.starts()[0][1].prompt;
    expect(prompt).toContain("Factory task prompt.");
    expect(prompt).not.toContain("Pipeline stage");
    expect(t.task().pipeline).toMatchObject({
      id: "default",
      stage: "implement",
      visits: { implement: 1 },
    });
    expect(t.card().stageChip).toBe("implement 1/3");
    // Done: today's delivery with the project's action, the Project Manager's review.
    await t.finish(done());
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
    });
    expect(t.card().stage).toBe("review");
    expect(t.task().pipeline?.stage).toBe("review");
    // Sent back: the same agent continues with the feedback, as today.
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "continue",
      feedback: "Fix the typo",
    });
    expect(t.starts()).toHaveLength(1);
    expect(t.sends().at(-1)[1]).toContain(
      "The reviewer sent this task back to you",
    );
    expect(t.sends().at(-1)[1]).toContain("Fix the typo");
    expect(t.sends().at(-1)[1]).not.toContain("Pipeline stage");
    expect(t.task().pipeline).toMatchObject({
      stage: "implement",
      visits: { implement: 2 },
    });
    await t.finish(done("Fixed"));
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
    });
    // Today's review has no round limit: a `pm` stage has no loop guard.
    for (let round = 3; round <= 5; round++) {
      await s.board.mutate({
        action: "review",
        taskId,
        outcome: "continue",
        feedback: `Round ${round}`,
      });
      await t.finish(done(`Fixed ${round}`));
      expect(t.delivery()).toMatchObject({
        stage: "needs-you",
        reason: "review",
      });
    }
    expect(t.task().pipeline?.visits.review).toBe(5);
    expect(t.card().stageChip).toBe("review 5");
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "done",
      feedback: "",
    });
    expect(t.card().stage).toBe("done");
    expect(t.card().stageChip).toBeNull();
  });

  it("a single to runs the next stage on its role's worker, continue or fresh", async () => {
    const s = await bootWith(
      `start: build
stages:
  build: { role: implement, prompt: Build it., to: check }
  check: { role: verify, prompt: Check it with evidence., to: polish }
  polish: { role: implement, prompt: Polish it., session: fresh, to: deliver }
`,
      {
        "workers/checker/worker.md": `---
name: Checker
role: verify
project: proj
schedule: automatic
---

Check things.
`,
      },
    );
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    expect(t.starts()).toHaveLength(1);
    expect(t.starts()[0][1].prompt).toContain(
      "## Pipeline stage: build (implement)",
    );
    const first = t.record().agentId;
    // build → check: the verify worker starts its own agent on the task's workspace.
    await t.finish(done("Built"));
    expect(t.starts()).toHaveLength(2);
    expect(t.starts()[1][0]).toBe(t.task().workspaceId);
    expect(t.starts()[1][1].prompt).toContain("Check it with evidence.");
    expect(t.starts()[1][1].systemPrompt).toBe("Check things.");
    expect(t.record().orchestratorId).toBe("checker");
    expect(t.card().stage).toBe("in-progress");
    expect(t.task().pipeline).toMatchObject({
      stage: "check",
      pending: false,
      agents: { implement: first, verify: t.record().agentId },
    });
    expect(t.card().stageChip).toBe("check 1/3");
    // An answer on the board continues the stage on its own worker, even for a task that names
    // another orchestrator.
    await s.store.update((data) => {
      data.tasks.find((task) => task.id === taskId)!.orchestratorId = LIVE_ID;
    });
    const checker = t.record().agentId;
    await t.finish(
      `Q.\n<report>${JSON.stringify({ status: "needs_input", summary: "Which env?", question: "Which env?" })}</report>`,
    );
    expect(t.delivery()).toMatchObject({ reason: "needs-input" });
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "continue",
      feedback: "Staging",
    });
    expect(t.record()).toMatchObject({
      orchestratorId: "checker",
      agentId: checker,
    });
    expect(t.sends().at(-1)).toEqual([
      checker,
      expect.stringContaining("Staging"),
    ]);
    // check → polish: implement again, but `fresh` starts a new agent though the first is alive.
    await t.finish(done("Checked"));
    expect(t.starts()).toHaveLength(3);
    expect(t.starts()[2][1].prompt).toContain("Polish it.");
    expect(t.record().orchestratorId).toBe(LIVE_ID);
    expect(t.record().agentId).not.toBe(first);
    // polish → deliver: today's delivery.
    await t.finish(done("Polished"));
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
    });
    expect(t.task().pipeline?.stage).toBe("deliver");
    expect(t.card().stage).toBe("review");
  });

  it("a gate waits in Needs you on a Decisões proposal and advances with no PM turn", async () => {
    const s = await bootWith(
      `start: spec
stages:
  spec:
    role: spec
    prompt: Write the spec.
    gate:
      question: Approve this spec?
      options:
        - { id: approve, label: Approve, to: build }
        - { id: changes, label: Request changes, to: spec }
  build: { role: implement, prompt: Build it., to: end }
`,
      { "templates/spec.md": "SPEC TEMPLATE\n" },
    );
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    // No spec worker: the implement worker runs it with the stage prompt and the spec template.
    const prompt: string = t.starts()[0][1].prompt;
    expect(prompt).toContain("Write the spec.");
    expect(prompt).toContain("SPEC TEMPLATE");
    await t.finish(done("Spec written"));
    expect(t.delivery()).toMatchObject({ stage: "needs-you", reason: "gate" });
    expect(t.card().stageChip).toBe("spec · gate");
    const card = t.gateCard();
    expect(card).toMatchObject({
      kind: "proposal",
      status: "waiting",
      question: "Approve this spec?",
      links: { taskIds: [taskId] },
    });
    expect(card.options.map((o) => o.id)).toEqual(["approve", "changes"]);
    await expect(
      s.board.pmCardDecide(card.id, { answer: "maybe", by: "user" }),
    ).rejects.toThrow(GATE_OPTION_REQUIRED_ERROR);
    // The gate is the user's: the PM is not told about it and may not answer or archive it.
    expect(s.board.assistantNeedsYouBrief().ids).not.toContain(taskId);
    await expect(
      s.board.pmCardDecide(card.id, { optionId: "approve", by: "pm" }),
    ).rejects.toThrow(GATE_USER_ONLY_ERROR);
    await expect(
      s.board.pmCardUpdate(card.id, {
        status: "decided",
        answer: "Approve",
        answerOptionId: "approve",
      }),
    ).rejects.toThrow(GATE_USER_ONLY_ERROR);
    await expect(s.board.pmCardArchive(card.id)).rejects.toThrow(
      GATE_ARCHIVE_ERROR,
    );
    await expect(
      s.board.pmCardUpdate(card.id, { status: "archived" }),
    ).rejects.toThrow(GATE_ARCHIVE_ERROR);
    expect(t.gateCard().status).toBe("waiting");
    // Request changes: the spec stage runs again, on the same agent, with the user's words.
    await s.board.pmCardDecide(card.id, {
      optionId: "changes",
      answer: "Add a rollback section",
      by: "user",
    });
    await s.board.refresh();
    expect(t.delivery()).toBeUndefined();
    expect(t.card().stage).toBe("in-progress");
    expect(t.starts()).toHaveLength(1);
    expect(t.sends().at(-1)[1]).toContain("Add a rollback section");
    expect(t.task().pipeline).toMatchObject({
      stage: "spec",
      visits: { spec: 2 },
      gate: null,
    });
    // Approve: build has no implement agent yet, so a new one starts; `end` closes the task.
    await t.finish(done("Spec v2"));
    await s.board.pmCardDecide(t.gateCard().id, {
      optionId: "approve",
      by: "user",
    });
    await s.board.refresh();
    expect(t.starts()).toHaveLength(2);
    expect(t.starts()[1][1].prompt).toContain("Build it.");
    await t.finish(done("Built"));
    expect(t.delivery()).toMatchObject({ stage: "delivered" });
    expect(t.card().stage).toBe("done");
    expect(t.task().pipeline?.stage).toBe("end");
  });

  it("maxVisits sends the task to Needs you as loop", async () => {
    const s = await bootWith(
      `start: build
stages:
  build: { role: implement, prompt: Build it., maxVisits: 2, to: build }
`,
    );
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    await t.finish(done("Round 1"));
    expect(t.task().pipeline).toMatchObject({ visits: { build: 2 } });
    expect(t.sends().at(-1)[1]).toContain("Build it.");
    await t.finish(done("Round 2"));
    expect(t.delivery()).toMatchObject({ stage: "needs-you", reason: "loop" });
    expect(t.card().stage).toBe("review");
    expect(t.task().pipeline).toMatchObject({
      stage: "build",
      visits: { build: 2 },
      pending: false,
    });
    expect(t.task().pipeline?.history.at(-1)).toMatchObject({ via: "loop" });
    // Continue gives the looped stage a new budget: the next transition runs it again.
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "continue",
      feedback: "One more",
    });
    await t.finish(done("Round 3"));
    expect(t.delivery()).toBeUndefined();
    expect(t.task().pipeline).toMatchObject({ visits: { build: 1 } });
  });

  // Ticket 12: a list of conditions wakes the PM, who advances or asks.
  const TRIAGE = `start: triage
stages:
  triage:
    role: triage
    prompt: Size it.
    to:
      - { stage: build, when: Small. }
      - { stage: cancel, when: Not worth it. }
  build: { role: implement, prompt: Build it., to: deliver }
`;

  it("a list of when conditions wakes the PM with the report and the candidates; an advance outside them is refused", async () => {
    const s = await bootWith(TRIAGE);
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    await t.finish(done("Tiny change, one file"));
    expect(t.delivery()).toMatchObject({ stage: "needs-you", reason: "gate" });
    expect(t.task().pipeline?.gate).toEqual({
      cardId: null,
      stage: "triage",
      kind: "choose",
    });
    // No card yet: the PM chooses first.
    expect(
      s.board.pmCards().filter((c) => c.links.taskIds.includes(taskId)),
    ).toEqual([]);
    const brief = s.board.assistantNeedsYouBrief();
    expect(brief.ids).toContain(taskId);
    expect(brief.text).toContain("board_pipeline_advance");
    expect(brief.text).toContain("build (when: Small.)");
    expect(brief.text).toContain("cancel (when: Not worth it.)");
    expect(brief.text).toContain("report: Tiny change, one file");
    await expect(
      s.board.pipelineAdvance(taskId, "deliver", "Ship it"),
    ).rejects.toThrow(/not a candidate after "triage"/);
    await expect(
      s.board.pipelineAdvance(taskId, "spec", "Write a spec"),
    ).rejects.toThrow(/Candidates: build/);
    expect(t.task().pipeline?.stage).toBe("triage");
    // A candidate whose condition fits: the build stage runs, with no user turn.
    expect(
      await s.board.pipelineAdvance(taskId, "build", "One file, small"),
    ).toEqual({ from: "triage", to: "build" });
    expect(t.delivery()).toBeUndefined();
    expect(t.card().stage).toBe("in-progress");
    expect(t.task().pipeline).toMatchObject({ stage: "build", gate: null });
    expect(t.task().pipeline?.history.at(-1)).toMatchObject({
      stage: "build",
      via: "choose",
      detail: "One file, small",
    });
    // build has no implement agent yet: a new one starts with the stage's prompt.
    await s.board.refresh();
    expect(t.starts()).toHaveLength(2);
    expect(t.starts()[1][1].prompt).toContain("Build it.");
    // Nothing left to choose.
    await expect(
      s.board.pipelineAdvance(taskId, "cancel", "Changed my mind"),
    ).rejects.toThrow(/no open pipeline choice/);
  });

  it("an advance to cancel closes the task", async () => {
    const s = await bootWith(TRIAGE);
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    await t.finish(done("Not worth it"));
    await s.board.pipelineAdvance(taskId, "cancel", "Already done upstream");
    expect(t.delivery()).toMatchObject({ stage: "dismissed" });
    expect(t.task().pipeline).toMatchObject({ stage: "cancel", gate: null });
  });

  it("board_pipeline_ask puts the choice on a Decisões card only the user answers", async () => {
    const s = await bootWith(TRIAGE);
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    await t.finish(done("Unclear: could be a one-liner or a redesign"));
    await expect(
      s.board.pipelineAsk(taskId, {
        question: "Which way?",
        options: [{ stage: "build" }, { stage: "spec" }],
        reason: "no-fit",
      }),
    ).rejects.toThrow(/not candidates: spec/);
    const card = await s.board.pipelineAsk(taskId, {
      question: "Build it now or drop it?",
      options: [
        { stage: "build", gains: "Ships today" },
        { stage: "cancel", label: "Drop it" },
      ],
      recommend: "build",
      reason: "no-fit",
    });
    expect(card).toMatchObject({
      kind: "proposal",
      status: "waiting",
      recommend: "build",
      userOnlyReason: null,
      links: { taskIds: [taskId] },
      findings: "Unclear: could be a one-liner or a redesign",
    });
    expect(card.options.map((o) => [o.id, o.label])).toEqual([
      ["build", "build: Small."],
      ["cancel", "Drop it"],
    ]);
    expect(t.task().pipeline?.gate).toEqual({
      cardId: card.id,
      stage: "triage",
      kind: "choose",
    });
    // Asked: the PM is not woken for it again, and may not pick on its own.
    expect(s.board.assistantNeedsYouBrief().ids).not.toContain(taskId);
    await expect(
      s.board.pipelineAdvance(taskId, "build", "Fine"),
    ).rejects.toThrow(/already asked the user/);
    await expect(
      s.board.pmCardDecide(card.id, { optionId: "build", by: "pm" }),
    ).rejects.toThrow(GATE_USER_ONLY_ERROR);
    await expect(
      s.board.pmCardUpdate(card.id, { status: "decided", answer: "Drop it" }),
    ).rejects.toThrow(GATE_USER_ONLY_ERROR);
    await expect(s.board.pmCardArchive(card.id)).rejects.toThrow(
      GATE_ARCHIVE_ERROR,
    );
    await expect(
      s.board.pmCardDecide(card.id, { answer: "Drop it", by: "user" }),
    ).rejects.toThrow(GATE_OPTION_REQUIRED_ERROR);
    // The user's answer moves the task with no PM turn.
    await s.board.pmCardDecide(card.id, { optionId: "cancel", by: "user" });
    expect(t.delivery()).toMatchObject({ stage: "dismissed" });
    expect(t.task().pipeline).toMatchObject({ stage: "cancel", gate: null });
  });

  it("a report that arrives late after no-report still moves the task to its next stage", async () => {
    const s = await bootWith(`start: build
stages:
  build: { role: implement, prompt: Build it., to: check }
  check: { role: verify, prompt: Check it., to: deliver }
`);
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    await t.finish("I forgot the report block");
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "no-report",
    });
    expect(t.card().stage).toBe("review");
    // The agent writes its report later; the board reads it once the agent is idle again.
    const agent = s.inventory.agents.find((a) => a.id === t.record().agentId)!;
    agent.updatedAt = new Date(
      Date.parse(t.record().finishedAt!) + 60_000,
    ).toISOString();
    vi.mocked(s.host.lastReply).mockResolvedValue(done("Built late"));
    for (let i = 0; i < 4; i++) {
      s.advance(25_000);
      await s.board.refresh();
    }
    expect(t.delivery()).toBeUndefined();
    expect(t.card().stage).toBe("in-progress");
    expect(t.task().pipeline).toMatchObject({ stage: "check", pending: false });
    expect(t.record().status).toBe("running");
    expect(t.starts()).toHaveLength(2);
    expect(t.starts()[1][1].prompt).toContain("Check it.");
  });

  it("critical: feedback after deliver goes back to implement, on the implement agent", async () => {
    const s = await bootWith(
      builtin("pipelines/critical.yaml"),
      {
        ...Object.fromEntries(
          ["triage", "spec", "implement", "verify", "review"].map((role) => [
            `roles/${role}.md`,
            builtin(`roles/${role}.md`),
          ]),
        ),
        "templates/spec.md": builtin("templates/spec.md"),
      },
      "critical",
    );
    const taskId = await startTask(s);
    const t = helpers(s, taskId);
    const choose = async (stage: string) => {
      await s.board.pipelineAdvance(taskId, stage, "Its condition fits");
      await s.board.refresh();
    };
    await t.finish(done("Small and clear"));
    await choose("implement");
    expect(t.task().pipeline?.stage).toBe("implement");
    const implementer = t.record().agentId!;
    // implement → verify is a single `to`; verify's conditions go to the PM.
    await t.finish(done("Implemented"));
    expect(t.task().pipeline?.stage).toBe("verify");
    await t.finish(done("Every check passed"));
    await choose("review");
    // `review` is `fresh`: a new agent, never the author.
    expect(t.record().agentId).not.toBe(implementer);
    await t.finish(done("No blocking findings"));
    await choose("deliver");
    expect(t.task().pipeline?.stage).toBe("deliver");
    expect(t.delivery()).toMatchObject({
      stage: "needs-you",
      reason: "review",
    });
    // The PM's correction reaches the implement stage and its agent, not the reviewer.
    await s.board.mutate({
      action: "review",
      taskId,
      outcome: "continue",
      feedback: "Rename the flag",
    });
    expect(t.task().pipeline).toMatchObject({
      stage: "implement",
      visits: { implement: 2 },
    });
    expect(t.record()).toMatchObject({
      agentId: implementer,
      orchestratorId: LIVE_ID,
    });
    expect(t.sends().at(-1)).toEqual([
      implementer,
      expect.stringContaining("Rename the flag"),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Ticket 12: the preset of the project decides what pm_card_create and board_pipeline_ask let go
// to the user. A project whose pipeline is `critical` is critical.

const ASK_PIPELINE = `start: triage
stages:
  triage:
    role: triage
    prompt: Size it.
    to:
      - { stage: build, when: Small. }
      - { stage: cancel, when: Not worth it. }
  build: { role: implement, prompt: Build it., to: deliver }
`;

const USER_REASONS: Record<
  AutonomyPresetId,
  { flow: UserOnlyReason[]; critical: UserOnlyReason[] }
> = {
  autonomous: {
    flow: ["product", "irreversible"],
    critical: ["product", "irreversible"],
  },
  standard: {
    flow: ["product", "irreversible"],
    critical: ["fresh-agent", "product", "irreversible"],
  },
  cautious: {
    flow: ["merge", "data-migration", "product", "irreversible"],
    critical: [
      "fresh-agent",
      "merge",
      "data-migration",
      "product",
      "irreversible",
    ],
  },
};

describe("autonomy presets on the board", () => {
  const cases = (["autonomous", "standard", "cautious"] as const).flatMap(
    (preset) => (["flow", "critical"] as const).map((id) => [preset, id]),
  ) as Array<[AutonomyPresetId, "flow" | "critical"]>;

  it.each(cases)(
    "%s on a %s project: what pm_card_create and board_pipeline_ask refuse and accept",
    async (preset, id) => {
      const s = await bootWith(ASK_PIPELINE, {}, id, preset);
      expect(s.board.projectAutonomy("p")).toBe(preset);
      expect(s.board.requiresUserMergeOk("p")).toBe(
        preset === "cautious" || (preset === "standard" && id === "critical"),
      );
      const taskId = await startTask(s);
      const accepted: UserOnlyReason[] = [];
      for (const reason of USER_ONLY_REASONS) {
        const created = s.board.pmCardCreate({
          kind: "proposal",
          title: `Merge? (${reason})`,
          question: "Merge it?",
          options: [{ id: "yes", label: "Yes", gains: null, costs: null }],
          recommend: "yes",
          links: { taskIds: [taskId], reportIds: [], packageIds: [] },
          userOnlyReason: reason,
        });
        const card = await created.catch((error: Error) => {
          expect(error.message).toMatch(/This decision is yours/);
          return null;
        });
        if (card) {
          expect(card.userOnlyReason).toBe(reason);
          accepted.push(reason);
        }
      }
      expect(accepted).toEqual(USER_REASONS[preset][id]);
      // No reason: created as before (the #165 refusal is not here yet).
      await expect(
        s.board.pmCardCreate({ kind: "proposal", title: "Plain" }),
      ).resolves.toMatchObject({ userOnlyReason: null });

      // board_pipeline_ask: the same list, plus no-fit, which the choice rule always allows.
      const t = helpers(s, taskId);
      await t.finish(done("Hard to tell"));
      const ask = (reason: UserOnlyReason | "no-fit") =>
        s.board.pipelineAsk(taskId, {
          question: "Build or drop?",
          options: [{ stage: "build" }, { stage: "cancel" }],
          reason,
        });
      for (const reason of USER_ONLY_REASONS)
        if (!USER_REASONS[preset][id].includes(reason))
          await expect(ask(reason)).rejects.toThrow(/This decision is yours/);
      const allowed = USER_REASONS[preset][id][0]!;
      await expect(ask(allowed)).resolves.toMatchObject({
        userOnlyReason: allowed,
      });
      await expect(ask("no-fit")).rejects.toThrow(/already asked/);
    },
  );

  it("no autonomy in any file is standard: only a critical project's merge is the user's", async () => {
    const s = await bootWith(ASK_PIPELINE);
    expect(s.board.projectAutonomy("p")).toBe("standard");
    expect(s.board.requiresUserMergeOk("p")).toBe(false);
    expect(s.board.autonomyRule("p")).toContain("the merge is yours");
    // The review policy fresh-agent makes it critical until ticket 13 removes it.
    await s.store.update((data) => {
      data.assistant.settings.reviews = { p: "fresh-agent" };
    });
    expect(s.board.requiresUserMergeOk("p")).toBe(true);
    expect(s.board.autonomyRule("p")).toContain("the merge ok is the user's");
  });

  it("the Needs you line names the project's preset and who merges", async () => {
    const s = await bootWith(ASK_PIPELINE, {}, "critical", "standard");
    const taskId = await startTask(s);
    await helpers(s, taskId).finish(done("Small"));
    expect(s.board.assistantNeedsYouBrief().text).toContain(
      "autonomy Padrão (standard, critical): the merge ok is the user's",
    );
  });

  it("board_pipeline_advance records the move as a moved report; a stage outside the candidates is an error", async () => {
    const s = await bootWith(ASK_PIPELINE);
    const taskId = await startTask(s);
    await helpers(s, taskId).finish(done("One file"));
    const appended: any[] = [];
    const [advance] = pipelineTools(() => s.board, {
      append: async (entry: any) => {
        appended.push(entry);
        return entry;
      },
    } as any);
    const task = s.store.current.tasks.find((t) => t.id === taskId)!;
    const refused = await advance!.execute({
      taskId: `#${task.number}`,
      stage: "review",
      reason: "Looks done",
    });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/not a candidate/);
    expect(appended).toEqual([]);
    const moved = await advance!.execute({
      taskId,
      stage: "build",
      reason: "One file,\nsmall",
    });
    expect(moved.isError).toBeUndefined();
    expect(appended).toEqual([
      expect.objectContaining({
        taskId,
        kind: "moved",
        summary: "Pipeline: triage → build. One file, small",
        decisions: ["build: One file, small"],
      }),
    ]);
  });
});
