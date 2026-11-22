// CUSTOM(factory): pure helpers of the Pipelines tab.
import {
  projectWorkers,
  stageRunner,
  type StageWorkerCandidate,
} from "../shared/factory/pipeline";
import type { PipelineStage } from "../shared/factory/schema";
import type { PipelineStrings } from "./pipeline-strings";

/** Who runs the stage for the project, as text: the Project Manager, a worker or none. Live
 * orchestrators have no role yet, so they are implement workers. */
export function stageRunnerLabel(
  stage: PipelineStage,
  projectId: string | null,
  orchestrators: Array<{ id: string; name: string; projectId: string | null }>,
  s: Pick<PipelineStrings, "projectManager" | "noWorker" | "implementFallback">,
): string {
  const candidates: StageWorkerCandidate[] = orchestrators.map((o) => ({
    id: o.id,
    project: o.projectId,
    role: "implement",
  }));
  const workers =
    projectId === null
      ? candidates.filter((worker) => worker.project === null)
      : projectWorkers(projectId, candidates);
  const runner = stageRunner(stage, workers);
  if (!runner) return s.noWorker;
  if (runner.kind === "pm") return s.projectManager;
  const name =
    orchestrators.find((o) => o.id === runner.workerId)?.name ??
    runner.workerId;
  return runner.fallback ? `${name} ${s.implementFallback}` : name;
}

/** The pipeline id a project runs, the view's default when it has no entry. */
export function pipelineForProject(
  view: { projects: Record<string, string>; defaultPipeline: string },
  projectId: string,
): string {
  return view.projects[projectId] ?? view.defaultPipeline;
}
