// CUSTOM(factory): pure helpers of the Pipelines tab.
import {
  projectWorkers,
  stageRunner,
  type StageWorkerCandidate,
} from "../shared/factory/pipeline";
import type { PipelineStage } from "../shared/factory/schema";
import { isDraftGroup, type Card, type Group } from "../shared/model";
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

/** A task on a node of the Pipelines overlay. */
export interface StageTask {
  id: string;
  number: number;
  title: string;
}

/** The tasks on one node: `waiting` on its gate or stage choice, `running` the rest. */
export interface StageOverlay {
  running: StageTask[];
  waiting: StageTask[];
}

type OverlayCard = Pick<
  Card,
  | "id"
  | "number"
  | "title"
  | "projectId"
  | "stage"
  | "archived"
  | "pipeline"
  | "stageChip"
>;

/**
 * The project's tasks per stage of the pipeline the tab shows, by stage id. A task counts while
 * its card shows the stage chip (the engine runs its pipeline and the card is not in Done or
 * Canceled) and only on the pipeline it runs; never from a draft column, where a run starts over
 * at `start`, nor archived. One whose gate or `when` choice is open waits on that stage.
 */
export function pipelineOverlay(
  cards: readonly OverlayCard[],
  groups: readonly Group[],
  projectId: string,
  pipelineId: string,
): Record<string, StageOverlay> {
  const overlay: Record<string, StageOverlay> = {};
  const live = cards
    .filter(
      (card) =>
        card.projectId === projectId &&
        card.pipeline?.id === pipelineId &&
        !!card.stageChip &&
        card.archived?.status !== "archived" &&
        card.archived?.status !== "external" &&
        !isDraftGroup(card.stage, groups),
    )
    .sort((a, b) => a.number - b.number);
  for (const card of live) {
    const state = card.pipeline!;
    const stage = state.gate?.stage ?? state.stage;
    const entry = (overlay[stage] ??= { running: [], waiting: [] });
    (state.gate ? entry.waiting : entry.running).push({
      id: card.id,
      number: card.number,
      title: card.title,
    });
  }
  return overlay;
}
