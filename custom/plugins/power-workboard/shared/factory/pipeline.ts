// CUSTOM(factory): the rules of a pipeline (docs/factory.md, "pipelines/<id>.yaml"): the checks
// inside one pipeline file, and which worker runs a stage. Pure, so the loader, the compiler and
// the pipeline editor share them.
import type { PipelineFile, PipelineStage, WorkerRole } from "./schema";

/** Stage ids the board owns: `deliver` runs the project's delivery, `end` is Done with no
 * delivery, `cancel` cancels the task. Transitions may name them; a pipeline may not define them. */
export const BUILTIN_STAGES = ["deliver", "end", "cancel"] as const;
export type BuiltinStage = (typeof BUILTIN_STAGES)[number];
export const DEFAULT_MAX_VISITS = 3;
/** A worker with no `role` is an implement worker, as every orchestrator is today. */
export const DEFAULT_WORKER_ROLE: WorkerRole = "implement";

export const isBuiltinStage = (id: string): id is BuiltinStage =>
  (BUILTIN_STAGES as readonly string[]).includes(id);

export type PipelineProblem = {
  /** Path in the file, for the line of the key it is about. */
  path: Array<string | number>;
  message: string;
};

/** The fields of a stage, in its file or compiled, that lead to another stage. */
type StageLinks = {
  to?: string | Array<{ stage: string }> | null;
  gate?: { options: Array<{ to?: string }> } | null;
};

/** Where a stage can go next: its `to` stages and its gate options' stages. */
export function stageTargets(stage: StageLinks): string[] {
  const targets: string[] = [];
  if (typeof stage.to === "string") targets.push(stage.to);
  else for (const option of stage.to ?? []) targets.push(option.stage);
  for (const option of stage.gate?.options ?? [])
    if (option.to) targets.push(option.to);
  return targets;
}

/** The checks that need only the file itself; the loader adds the ones across files. */
export function pipelineProblems(pipeline: PipelineFile): PipelineProblem[] {
  const problems: PipelineProblem[] = [];
  const stages = pipeline.stages;
  const known = (id: string) => Object.hasOwn(stages, id) || isBuiltinStage(id);
  const unknown = (id: string) =>
    `no stage "${id}" (built-in: ${BUILTIN_STAGES.join(", ")})`;

  if (Object.keys(stages).length === 0)
    problems.push({ path: ["stages"], message: "Define at least one stage" });
  if (isBuiltinStage(pipeline.start))
    problems.push({
      path: ["start"],
      message: `"${pipeline.start}" is built in; start at one of the pipeline's stages`,
    });
  else if (!Object.hasOwn(stages, pipeline.start))
    problems.push({ path: ["start"], message: unknown(pipeline.start) });

  for (const [id, stage] of Object.entries(stages)) {
    const at = (...rest: Array<string | number>) => ["stages", id, ...rest];
    if (isBuiltinStage(id))
      problems.push({
        path: at(),
        message: `"${id}" is a built-in stage; pick another id`,
      });
    if (stage.prompt !== undefined && stage.file !== undefined)
      problems.push({
        path: at("file"),
        message: "Use prompt or file, not both",
      });
    if (stage.to === undefined && stage.gate === undefined)
      problems.push({
        path: at(),
        message: "Needs to or gate: where the task goes after this stage",
      });
    if (stage.to !== undefined && stage.gate !== undefined)
      problems.push({
        path: at("gate"),
        message:
          "Use to or gate, not both: a gate's options name the next stage",
      });

    if (typeof stage.to === "string") {
      if (!known(stage.to))
        problems.push({ path: at("to"), message: unknown(stage.to) });
    } else
      stage.to?.forEach((option, index) => {
        if (!known(option.stage))
          problems.push({
            path: at("to", index, "stage"),
            message: unknown(option.stage),
          });
      });

    const optionIds = new Set<string>();
    stage.gate?.options.forEach((option, index) => {
      if (optionIds.has(option.id))
        problems.push({
          path: at("gate", "options", index, "id"),
          message: `Duplicate gate option "${option.id}"`,
        });
      optionIds.add(option.id);
      if (option.to === undefined)
        problems.push({
          path: at("gate", "options", index),
          message: `Gate option "${option.id}" needs to: the stage it leads to`,
        });
      else if (!known(option.to))
        problems.push({
          path: at("gate", "options", index, "to"),
          message: unknown(option.to),
        });
    });
  }

  for (const id of Object.keys(pipeline.layout ?? {}))
    if (!known(id))
      problems.push({ path: ["layout", id], message: unknown(id) });

  if (Object.hasOwn(stages, pipeline.start)) {
    const reached = reachableStages(pipeline);
    for (const id of Object.keys(stages))
      if (!reached.has(id))
        problems.push({
          path: ["stages", id],
          message: `Unreachable: no transition from start "${pipeline.start}" leads here`,
        });
  }
  return problems;
}

/** The pipeline's own stages a task can reach from `start`. */
export function reachableStages(pipeline: PipelineFile): Set<string> {
  const reached = new Set<string>();
  const queue = [pipeline.start];
  while (queue.length) {
    const id = queue.shift()!;
    if (reached.has(id) || !Object.hasOwn(pipeline.stages, id)) continue;
    reached.add(id);
    queue.push(...stageTargets(pipeline.stages[id]));
  }
  return reached;
}

export type StageWorkerCandidate = {
  id: string;
  /** Id of projects/*.yaml; null takes projects with no worker of their own. */
  project: string | null;
  role: WorkerRole;
};

/** The workers that take a project's tasks: its own, else the ones with `project: null`.
 * `workers` comes in priority order; the result keeps it. */
export function projectWorkers<T extends StageWorkerCandidate>(
  projectId: string,
  workers: T[],
): T[] {
  const own = workers.filter((worker) => worker.project === projectId);
  return own.length ? own : workers.filter((worker) => worker.project === null);
}

export type StageRunner =
  | { kind: "pm" }
  /** `fallback`: the project's implement worker runs it with the role's prompt. */
  | { kind: "worker"; workerId: string; fallback: boolean };

/** Who runs a stage for a project: the Project Manager for `pm`, the pinned worker, the first
 * project worker with the stage's role, else its first implement worker. Null when none fits. */
export function stageRunner(
  stage: PipelineStage,
  workers: StageWorkerCandidate[],
): StageRunner | null {
  if (stage.role === "pm") return { kind: "pm" };
  if (stage.worker)
    return { kind: "worker", workerId: stage.worker, fallback: false };
  const own = workers.find((worker) => worker.role === stage.role);
  if (own) return { kind: "worker", workerId: own.id, fallback: false };
  const implement = workers.find((worker) => worker.role === "implement");
  return implement
    ? { kind: "worker", workerId: implement.id, fallback: true }
    : null;
}
