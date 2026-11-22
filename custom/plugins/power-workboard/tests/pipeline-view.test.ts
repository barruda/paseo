// CUSTOM(factory): the Pipelines tab's pure helpers.
import { describe, expect, it } from "vitest";
import {
  pipelineForProject,
  pipelineOverlay,
  stageRunnerLabel,
} from "../client/pipeline-view";
import { pipelineStrings } from "../client/pipeline-strings";
import {
  BUILTIN_PIPELINES,
  builtinPipelinesView,
} from "../shared/factory/builtin-pipelines";
import { taskPipelineSchema } from "../shared/factory/engine";
import { DEFAULT_GROUPS } from "../shared/model";

const s = pipelineStrings("en");
const orchestrators = [
  { id: "o-global", name: "Global", projectId: null },
  { id: "o-a", name: "Alpha worker", projectId: "a" },
];
const implement = BUILTIN_PIPELINES.default.stages.implement;
const review = BUILTIN_PIPELINES.default.stages.review;
const triage = BUILTIN_PIPELINES.critical.stages.triage;

describe("stageRunnerLabel", () => {
  it("names the Project Manager for a pm stage", () => {
    expect(stageRunnerLabel(review, "a", orchestrators, s)).toBe(
      s.projectManager,
    );
  });
  it("uses the project's own orchestrator, marking the implement fallback", () => {
    expect(stageRunnerLabel(triage, "a", orchestrators, s)).toBe(
      `Alpha worker ${s.implementFallback}`,
    );
    expect(stageRunnerLabel(implement, "a", orchestrators, s)).toBe(
      "Alpha worker",
    );
  });
  it("falls to the projectId-null orchestrators when the project has none", () => {
    expect(stageRunnerLabel(implement, "b", orchestrators, s)).toBe("Global");
    expect(stageRunnerLabel(implement, null, orchestrators, s)).toBe("Global");
  });
  it("says no worker when none fits", () => {
    expect(stageRunnerLabel(implement, "b", [], s)).toBe(s.noWorker);
    expect(stageRunnerLabel(implement, null, [orchestrators[1]], s)).toBe(
      s.noWorker,
    );
  });
});

describe("builtinPipelinesView", () => {
  const view = builtinPipelinesView({ a: "fresh-agent", b: "self" });
  it("maps the legacy review map to pipelines (COMPAT(factory-pipelines))", () => {
    expect(view.source).toBe("builtin");
    expect(view.projects).toEqual({ a: "critical", b: "default" });
    expect(view.defaultPipeline).toBe("default");
    expect(Object.keys(view.pipelines).sort()).toEqual(["critical", "default"]);
  });
  it("picks the default pipeline for a project with no entry", () => {
    expect(pipelineForProject(view, "a")).toBe("critical");
    expect(pipelineForProject(view, "zzz")).toBe("default");
  });
});

describe("pipelineOverlay", () => {
  let next = 0;
  const card = (
    fields: {
      stage?: string;
      projectId?: string | null;
      pipeline?: Record<string, unknown> | null;
      stageChip?: string | null;
      archived?: "archived" | "external" | "pending" | null;
      number?: number;
    } = {},
  ) => {
    next += 1;
    return {
      id: `t${next}`,
      number: fields.number ?? next,
      title: `Task ${next}`,
      projectId: fields.projectId === undefined ? "a" : fields.projectId,
      stage: fields.stage ?? "in-progress",
      archived: fields.archived ? { status: fields.archived } : null,
      pipeline:
        fields.pipeline === null
          ? null
          : taskPipelineSchema.parse({
              id: "critical",
              stage: "implement",
              ...fields.pipeline,
            }),
      stageChip: fields.stageChip === undefined ? "chip" : fields.stageChip,
    } as Parameters<typeof pipelineOverlay>[0][number];
  };
  const gate = (stage: string, kind: "gate" | "choose" = "gate") => ({
    stage,
    gate: { cardId: "pm-card", stage, kind },
  });
  const counts = (overlay: ReturnType<typeof pipelineOverlay>) =>
    Object.fromEntries(
      Object.entries(overlay).map(([stage, tasks]) => [
        stage,
        [tasks.running.length, tasks.waiting.length],
      ]),
    );

  it("counts tasks per stage and the ones waiting on a gate or a stage choice", () => {
    const cards = [
      card({ pipeline: { stage: "implement" } }),
      card({ pipeline: { stage: "implement" }, stage: "review" }),
      card({ pipeline: gate("spec") }),
      card({ pipeline: gate("spec") }),
      card({ pipeline: { stage: "spec" } }),
      card({ pipeline: gate("verify", "choose") }),
      card({ pipeline: { stage: "deliver" }, stage: "review" }),
    ];
    expect(
      counts(pipelineOverlay(cards, DEFAULT_GROUPS, "a", "critical")),
    ).toEqual({
      implement: [2, 0],
      spec: [1, 2],
      verify: [0, 1],
      deliver: [1, 0],
    });
  });

  it("leaves out other projects, other pipelines and tasks the engine does not run", () => {
    const cards = [
      card({ projectId: "b" }),
      card({ projectId: null }),
      card({ pipeline: { id: "default" } }),
      card({ pipeline: null }),
      // No chip: Done or Canceled, the factory not active, or a pipeline gone from it.
      card({ stageChip: null }),
      // A draft column: a run from Ready starts over at `start`.
      card({ stage: "ready" }),
      card({ stage: "backlog" }),
      card({ archived: "archived" }),
      card({ archived: "external" }),
    ];
    expect(pipelineOverlay(cards, DEFAULT_GROUPS, "a", "critical")).toEqual({});
    expect(
      counts(
        pipelineOverlay(
          [card({ archived: "pending" })],
          DEFAULT_GROUPS,
          "a",
          "critical",
        ),
      ),
    ).toEqual({ implement: [1, 0] });
  });

  it("lists the tasks by number, for the panel", () => {
    const cards = [
      card({ number: 9 }),
      card({ number: 3 }),
      card({ number: 5, pipeline: gate("implement") }),
    ];
    const overlay = pipelineOverlay(cards, DEFAULT_GROUPS, "a", "critical");
    expect(overlay.implement?.running.map((t) => t.number)).toEqual([3, 9]);
    expect(overlay.implement?.waiting).toEqual([
      { id: cards[2]!.id, number: 5, title: cards[2]!.title },
    ]);
  });
});
