// CUSTOM(factory): the pipeline editor's edit model (docs/factory.md, ticket 14).
import { describe, expect, it } from "vitest";
import {
  keepManualLayout,
  layoutIsManual,
  layoutPipeline,
  layoutPositions,
  nodeAt,
} from "../client/pipeline-layout";
import { BUILTIN_PIPELINES } from "../shared/factory/builtin-pipelines";
import {
  addStage,
  connectStages,
  disconnectStages,
  draftDirty,
  moveNode,
  pipelineIssues,
  removeStage,
  renameStage,
  renameStageKeys,
  setGate,
  setStart,
  stageIssues,
  startDraft,
  updateStage,
  type PipelineDraft,
} from "../shared/factory/pipeline-edit";

const critical = () => startDraft(structuredClone(BUILTIN_PIPELINES.critical));
const simple = () =>
  startDraft({
    start: "implement",
    stages: { implement: { role: "implement", to: "deliver" } },
  });
const ok = (result: PipelineDraft | { error: string }): PipelineDraft => {
  if ("error" in result) throw new Error(result.error);
  return result;
};

describe("pipeline edit model", () => {
  it("starts clean and leaves the base alone", () => {
    const draft = critical();
    expect(draftDirty(draft)).toBe(false);
    expect(pipelineIssues(draft.pipeline)).toEqual([]);
    const next = updateStage(draft, "implement", { session: "fresh" });
    expect(draftDirty(next)).toBe(true);
    expect(draft.pipeline.stages.implement.session).toBeUndefined();
    expect(next.base).toBe(draft.base);
  });

  it("adds a stage with a free id that validation asks to connect", () => {
    const { draft, id } = addStage(critical(), "implement");
    expect(id).toBe("implement-2");
    expect(draft.pipeline.stages[id]).toEqual({ role: "implement" });
    const issues = stageIssues(pipelineIssues(draft.pipeline), id).map(
      (issue) => issue.message,
    );
    expect(issues).toContain(
      "Needs to or gate: where the task goes after this stage",
    );
    expect(issues.some((message) => message.startsWith("Unreachable"))).toBe(
      true,
    );
    const connected = connectStages(draft, id, "deliver");
    const linked = connectStages(connected, "verify", id);
    expect(linked.pipeline.stages.verify.to).toEqual([
      { stage: "review", when: "Every check passed, with evidence." },
      { stage: "implement", when: "A check failed." },
      { stage: id, when: "" },
    ]);
    // The new condition has no `when` yet: the only issue left.
    expect(pipelineIssues(linked.pipeline).map((i) => i.path)).toEqual([
      ["stages", "verify", "to", 2, "when"],
    ]);
  });

  it("removes a stage with the transitions to it; a gate option loses its to", () => {
    const draft = removeStage(critical(), "implement");
    expect(draft.pipeline.stages.implement).toBeUndefined();
    expect(draft.pipeline.stages.triage.to).toEqual([
      {
        stage: "spec",
        when: "The ticket is large, ambiguous, or changes visible behavior.",
      },
    ]);
    expect(draft.pipeline.stages.spec.gate!.options[0]).toEqual({
      id: "approve",
      label: "Approve",
    });
    expect(
      pipelineIssues(draft.pipeline).some(
        (issue) => issue.path.join(".") === "stages.spec.gate.options.0",
      ),
    ).toBe(true);
    // Removing the start moves it to the first stage left.
    expect(removeStage(critical(), "triage").pipeline.start).toBe("spec");
  });

  it("renames a stage everywhere and records the base id once", () => {
    let draft = ok(renameStage(critical(), "implement", "build"));
    expect(Object.keys(draft.pipeline.stages)).toEqual([
      "triage",
      "spec",
      "build",
      "verify",
      "review",
    ]);
    expect(draft.pipeline.stages.spec.gate!.options[0].to).toBe("build");
    expect(draft.pipeline.stages.review.to).toContainEqual({
      stage: "build",
      when: "Blocking findings remain.",
    });
    expect(draft.renames).toEqual({ implement: "build" });
    draft = ok(renameStage(draft, "build", "code"));
    expect(draft.renames).toEqual({ implement: "code" });
    draft = ok(renameStage(draft, "code", "implement"));
    expect(draft.renames).toEqual({});
    expect(draftDirty(draft)).toBe(false);
    expect(pipelineIssues(draft.pipeline)).toEqual([]);
  });

  it("renames the start and refuses bad ids", () => {
    const draft = ok(renameStage(critical(), "triage", "sort"));
    expect(draft.pipeline.start).toBe("sort");
    expect(renameStage(critical(), "triage", "Bad Id")).toEqual({
      error: "invalid",
    });
    expect(renameStage(critical(), "triage", "deliver")).toEqual({
      error: "builtin",
    });
    expect(renameStage(critical(), "triage", "spec")).toEqual({
      error: "taken",
    });
  });

  it("keeps a removed base stage's id taken, but lets a swap through", () => {
    const removed = removeStage(critical(), "verify");
    expect(renameStage(removed, "implement", "verify")).toEqual({
      error: "taken",
    });
    // A new stage may reuse the id: no rename, so Save writes it over the old key.
    const added = addStage(removed, "verify");
    expect(added.id).toBe("verify");
    expect(added.draft.renames).toEqual({});
    // A renamed-away base id is free again: the swap spec ↔ verify through a temporary id.
    let draft = ok(renameStage(critical(), "spec", "tmp"));
    draft = ok(renameStage(draft, "verify", "spec"));
    draft = ok(renameStage(draft, "tmp", "verify"));
    expect(draft.renames).toEqual({ spec: "verify", verify: "spec" });
    expect(draft.pipeline.stages.verify.role).toBe("spec");
    expect(draft.pipeline.stages.spec.role).toBe("verify");
    expect(pipelineIssues(draft.pipeline)).toEqual([]);
  });

  it("does not record a rename for a new stage, and drops one for a removed stage", () => {
    const added = addStage(critical(), "verify");
    const renamed = ok(renameStage(added.draft, added.id, "check"));
    expect(renamed.renames).toEqual({});
    const base = ok(renameStage(critical(), "verify", "check"));
    expect(removeStage(base, "check").renames).toEqual({});
  });

  it("renames only the keys for the writer, all at once", () => {
    const base = BUILTIN_PIPELINES.critical;
    const swapped = renameStageKeys(
      { ...base, layout: { spec: { x: 0, y: 0 } } },
      { spec: "verify", verify: "spec" },
    );
    expect(Object.keys(swapped.stages)).toEqual([
      "triage",
      "verify",
      "implement",
      "spec",
      "review",
    ]);
    expect(swapped.stages.verify).toEqual(base.stages.spec);
    expect(swapped.layout).toEqual({ verify: { x: 0, y: 0 } });
    expect(swapped.start).toBe("triage");
  });

  it("updates fields, removing a key set to undefined", () => {
    let draft = updateStage(critical(), "review", {
      worker: "night",
      maxVisits: 5,
      session: undefined,
    });
    expect(draft.pipeline.stages.review).toMatchObject({
      worker: "night",
      maxVisits: 5,
    });
    expect(draft.pipeline.stages.review.session).toBeUndefined();
    draft = updateStage(draft, "review", { prompt: "Review it.", file: "x" });
    expect(stageIssues(pipelineIssues(draft.pipeline), "review")).toEqual([
      {
        path: ["stages", "review", "file"],
        message: "Use prompt or file, not both",
      },
    ]);
    expect(setStart(draft, "spec").pipeline.start).toBe("spec");
    expect(setStart(draft, "deliver").pipeline.start).toBe("triage");
  });

  it("connects: single to, conditions, gate options; never twice", () => {
    const single = connectStages(simple(), "implement", "end");
    expect(single.pipeline.stages.implement.to).toEqual([
      { stage: "deliver", when: "" },
      { stage: "end", when: "" },
    ]);
    expect(connectStages(single, "implement", "end")).toBe(single);
    const gated = connectStages(critical(), "spec", "cancel");
    expect(gated.pipeline.stages.spec.gate!.options.at(-1)).toEqual({
      id: "cancel",
      label: "cancel",
      to: "cancel",
    });
    expect(gated.pipeline.stages.spec.to).toBeUndefined();
    const added = addStage(simple(), "review");
    expect(
      connectStages(added.draft, added.id, "end").pipeline.stages[added.id],
    ).toEqual({ role: "review", to: "end" });
    expect(connectStages(simple(), "implement", "nowhere")).toEqual(simple());
  });

  it("disconnects every transition to a target, gate options included", () => {
    const draft = disconnectStages(critical(), "review", "implement");
    expect(draft.pipeline.stages.review.to).toEqual([
      { stage: "deliver", when: "No blocking findings." },
    ]);
    const gate = disconnectStages(critical(), "spec", "spec");
    expect(gate.pipeline.stages.spec.gate!.options).toEqual([
      { id: "approve", label: "Approve", to: "implement" },
    ]);
    expect(
      disconnectStages(simple(), "implement", "deliver").pipeline.stages
        .implement.to,
    ).toBeUndefined();
  });

  it("turns a gate on and off keeping the targets", () => {
    const on = setGate(critical(), "verify", true);
    expect(on.pipeline.stages.verify).toEqual({
      role: "verify",
      gate: {
        question: "",
        options: [
          { id: "review", label: "review", to: "review" },
          { id: "implement", label: "implement", to: "implement" },
        ],
      },
    });
    const off = setGate(critical(), "spec", false);
    expect(off.pipeline.stages.spec).toEqual({
      role: "spec",
      to: [
        { stage: "implement", when: "" },
        { stage: "spec", when: "" },
      ],
    });
    const single = setGate(
      setGate(simple(), "implement", true),
      "implement",
      false,
    );
    expect(single.pipeline.stages.implement).toEqual({
      role: "implement",
      to: "deliver",
    });
  });

  it("moves a node: the first move saves every node's place", () => {
    const draft = critical();
    const graph = layoutPipeline(draft.pipeline);
    const placed = layoutPositions(graph);
    expect(layoutIsManual(draft.pipeline)).toBe(false);
    const moved = moveNode(
      draft,
      "verify",
      { x: placed.verify.x + 300.4, y: placed.verify.y },
      placed,
    );
    expect(layoutIsManual(moved.pipeline)).toBe(true);
    expect(moved.pipeline.layout!.verify).toEqual({
      x: Math.round(placed.verify.x + 300.4),
      y: placed.verify.y,
    });
    expect(moved.pipeline.layout!.triage).toEqual(placed.triage);
    expect(pipelineIssues(moved.pipeline)).toEqual([]);
    // The drawing follows the layout: the node is where it was dropped.
    const after = layoutPipeline(moved.pipeline);
    const node = after.nodes.find((n) => n.id === "verify")!;
    expect(node.x - after.offset.x).toBe(moved.pipeline.layout!.verify.x);
    expect(nodeAt(after, { x: node.x + 5, y: node.y + 5 })?.id).toBe("verify");
    expect(nodeAt(after, { x: -10, y: -10 })).toBeNull();
  });

  it("keeps a manual layout when an edit draws a new node", () => {
    const draft = critical();
    const placed = layoutPositions(layoutPipeline(draft.pipeline));
    const manual = moveNode(draft, "triage", placed.triage, placed);
    const added = addStage(manual, "implement");
    const next = keepManualLayout(manual.pipeline, added.draft.pipeline);
    expect(layoutIsManual(next)).toBe(true);
    const lowest = Math.max(...Object.values(placed).map((at) => at.y));
    expect(next.layout![added.id].y).toBeGreaterThan(lowest);
    // A pipeline the rows lay out stays that way.
    const auto = addStage(critical(), "implement");
    expect(keepManualLayout(critical().pipeline, auto.draft.pipeline)).toBe(
      auto.draft.pipeline,
    );
  });
});
