// CUSTOM(factory): the Pipelines tab's pure helpers.
import { describe, expect, it } from "vitest";
import { pipelineForProject, stageRunnerLabel } from "../client/pipeline-view";
import { pipelineStrings } from "../client/pipeline-strings";
import {
  BUILTIN_PIPELINES,
  builtinPipelinesView,
} from "../shared/factory/builtin-pipelines";

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
  it("maps review policies to pipelines", () => {
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
