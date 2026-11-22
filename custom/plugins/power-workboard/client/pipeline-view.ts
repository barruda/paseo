// CUSTOM(factory): pure helpers of the Pipelines tab.
import {
  projectWorkers,
  stageRunner,
  type StageWorkerCandidate,
} from "../shared/factory/pipeline";
import type { PipelineStage } from "../shared/factory/schema";
import {
  AUTONOMY_PRESET_IDS,
  autonomyPreset,
  DEFAULT_AUTONOMY,
  type AutonomyPresetId,
} from "../shared/autonomy";
import type { PipelineFile } from "../shared/factory/schema";
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

/** The pipelines view as the autonomy helpers read it (active mode fills the optional fields). */
type AutonomyView = {
  pipelines: Record<string, Pick<PipelineFile, "autonomy">>;
  projects: Record<string, string>;
  defaultPipeline: string;
  pmAutonomy?: AutonomyPresetId | null;
  projectAutonomy?: Record<string, AutonomyPresetId>;
};

/** What a pipeline with no `autonomy` runs: pm/worker.md's, else `standard`. */
export function pipelineInheritedAutonomy(
  view: AutonomyView,
): AutonomyPresetId {
  return view.pmAutonomy ?? DEFAULT_AUTONOMY;
}

/** What a project with no `autonomy` runs: its pipeline's, pm/worker.md's, else `standard`. */
export function projectInheritedAutonomy(
  view: AutonomyView,
  projectId: string,
): AutonomyPresetId {
  return (
    view.pipelines[pipelineForProject(view, projectId)]?.autonomy ??
    pipelineInheritedAutonomy(view)
  );
}

/** The combobox's value for "Inherit": the key is missing from the file. */
export const INHERIT_AUTONOMY = "inherit";
export type AutonomyChoice = AutonomyPresetId | typeof INHERIT_AUTONOMY;

/** The combobox options: "Inherit (<inherited preset>)", then the presets. */
export function autonomyOptions(
  inherited: AutonomyPresetId,
  s: Pick<PipelineStrings, "inherit">,
): Array<{ value: AutonomyChoice; label: string }> {
  return [
    {
      value: INHERIT_AUTONOMY,
      label: s.inherit.replace("{preset}", autonomyPreset(inherited).label),
    },
    ...AUTONOMY_PRESET_IDS.map((id) => ({
      value: id,
      label: autonomyPreset(id).label,
    })),
  ];
}

/** The value a combobox choice writes: null ("Inherit") removes the key. */
export function autonomyOfChoice(
  choice: AutonomyChoice,
): AutonomyPresetId | null {
  return choice === INHERIT_AUTONOMY ? null : choice;
}

/** The line under a combobox: what goes to the user under the preset, and its breaker. */
export function autonomySummary(
  id: AutonomyPresetId,
  s: Pick<
    PipelineStrings,
    "autonomyUser" | "breakerOn" | "breakerOff" | "reasons"
  >,
): string {
  const preset = autonomyPreset(id);
  const reasons = preset.userDecides.map((reason) => s.reasons[reason]);
  const breaker =
    preset.breakerMinutes === null
      ? s.breakerOff
      : s.breakerOn.replace("{minutes}", String(preset.breakerMinutes));
  return `${s.autonomyUser.replace("{reasons}", reasons.join("; "))} ${breaker}`;
}
