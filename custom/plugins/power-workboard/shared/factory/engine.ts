// CUSTOM(factory): the pipeline engine (docs/factory.md, "pipelines/<id>.yaml", ticket 11). Pure
// transitions over a task's pipeline state; server/workboard.ts runs the stages they name.
import { z } from "zod";
import type {
  CompiledFactory,
  CompiledPipeline,
  CompiledStage,
} from "./compile";
import { isBuiltinStage, type BuiltinStage } from "./pipeline";

/** Oldest entries go first once a task's history passes this. */
export const PIPELINE_HISTORY_LIMIT = 50;

/** How the task entered a stage. `review`: the reviewer sent it back from a `pm` stage. */
export const PIPELINE_VIAS = [
  "start",
  "to",
  "gate",
  "choose",
  "review",
  "loop",
] as const;
export const pipelineViaSchema = z.enum(PIPELINE_VIAS);
export type PipelineVia = z.infer<typeof pipelineViaSchema>;

export const pipelineHistoryEntrySchema = z.object({
  stage: z.string(),
  at: z.string(),
  via: pipelineViaSchema,
  /** The gate option or the reason, in one line. */
  detail: z.string().nullable().default(null),
});
export type PipelineHistoryEntry = z.infer<typeof pipelineHistoryEntrySchema>;

/** A task's place in its project's pipeline. Null on tasks the engine does not run. */
export const taskPipelineSchema = z.object({
  /** Id of pipelines/<id>.yaml. */
  id: z.string(),
  /** The stage the task is in: one of the pipeline's, or a built-in once it left them. */
  stage: z.string(),
  /** Entries per stage, for `maxVisits`. */
  visits: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Per role, the agent that last ran a stage of that role here, for `session: continue`. */
  agents: z.record(z.string(), z.string()).default({}),
  /** A transition entered `stage` and the next pass starts its run. */
  pending: z.boolean().default(false),
  /** What the pending run gets besides the stage procedure: the user's answer at a gate. */
  note: z.string().nullable().default(null),
  /** The Decisões proposal the task waits on: a gate, or the stage choice of a `when` list. */
  gate: z
    .object({
      cardId: z.string(),
      stage: z.string(),
      kind: z.enum(["gate", "choose"]),
    })
    .nullable()
    .default(null),
  history: z.array(pipelineHistoryEntrySchema).default([]),
});
export type TaskPipeline = z.infer<typeof taskPipelineSchema>;

/** The pipeline a project's tasks run: its own `pipeline:`, else `defaults.pipeline`. */
export function pipelineForProject(
  compiled: CompiledFactory,
  defaultPipeline: string | null,
  projectId: string | null,
): CompiledPipeline | null {
  const own = compiled.projects.find(
    (project) => project.projectId === projectId,
  );
  const id = own?.pipeline ?? defaultPipeline;
  return compiled.pipelines.find((pipeline) => pipeline.id === id) ?? null;
}

export function findStage(
  pipeline: CompiledPipeline,
  id: string,
): CompiledStage | null {
  return pipeline.stages.find((stage) => stage.id === id) ?? null;
}

function pushHistory(
  state: TaskPipeline,
  entry: Omit<PipelineHistoryEntry, "detail"> & { detail?: string | null },
): PipelineHistoryEntry[] {
  return [...state.history, { detail: null, ...entry }].slice(
    -PIPELINE_HISTORY_LIMIT,
  );
}

/** The state of a task that leaves Ready: in `start`, first visit. */
export function startPipeline(
  pipeline: CompiledPipeline,
  at: string,
): TaskPipeline {
  return taskPipelineSchema.parse({
    id: pipeline.id,
    stage: pipeline.start,
    visits: { [pipeline.start]: 1 },
    history: [{ stage: pipeline.start, at, via: "start" }],
  });
}

/** What follows a stage that reported done. */
export type StageExit =
  /** A single `to`: the board advances with no PM turn. */
  | { kind: "go"; to: string }
  /** The user picks an option; each names its next stage. */
  | {
      kind: "gate";
      question: string;
      options: Array<{ id: string; label: string; to: string }>;
    }
  /** A list of `when` conditions: someone chooses among the candidates. */
  | { kind: "choose"; candidates: Array<{ stage: string; when: string }> };

export function stageExit(stage: CompiledStage): StageExit {
  if (stage.gate)
    return {
      kind: "gate",
      question: stage.gate.question,
      options: stage.gate.options,
    };
  if (typeof stage.to === "string") return { kind: "go", to: stage.to };
  return { kind: "choose", candidates: stage.to ?? [] };
}

/** Where a transition lands. */
export type PipelineTarget =
  /** A stage a worker runs. */
  | { kind: "worker"; stage: CompiledStage }
  /** A stage the Project Manager runs: today's delivery, with the project's action. */
  | { kind: "pm"; stage: CompiledStage }
  | { kind: "builtin"; stage: BuiltinStage };

export type EnterResult =
  | { state: TaskPipeline; target: PipelineTarget; loop: null }
  /** One more visit than `maxVisits`: the task stays where it was and goes to Needs you. */
  | {
      state: TaskPipeline;
      target: null;
      loop: { stage: string; visits: number; maxVisits: number };
    };

/**
 * Moves the task into `to`. A pipeline stage counts a visit; one past its `maxVisits` is refused
 * as a loop, and the task keeps its stage. A `pm` stage has no guard: today's review decides how
 * many rounds it takes. A worker stage is left `pending` for the next pass.
 */
export function enterStage(
  pipeline: CompiledPipeline,
  state: TaskPipeline,
  to: string,
  via: PipelineVia,
  at: string,
  detail: string | null = null,
): EnterResult {
  if (isBuiltinStage(to))
    return {
      state: {
        ...state,
        stage: to,
        pending: false,
        note: null,
        gate: null,
        history: pushHistory(state, { stage: to, at, via, detail }),
      },
      target: { kind: "builtin", stage: to },
      loop: null,
    };
  const stage = findStage(pipeline, to);
  if (!stage) throw new Error(`Pipeline ${pipeline.id} has no stage ${to}`);
  const visits = (state.visits[to] ?? 0) + 1;
  if (stage.role !== "pm" && visits > stage.maxVisits)
    return {
      state: {
        ...state,
        pending: false,
        note: null,
        gate: null,
        history: pushHistory(state, {
          stage: to,
          at,
          via: "loop",
          detail: `Visit ${visits} of ${stage.maxVisits}`,
        }),
      },
      target: null,
      loop: { stage: to, visits, maxVisits: stage.maxVisits },
    };
  const pm = stage.role === "pm";
  return {
    state: {
      ...state,
      stage: to,
      visits: { ...state.visits, [to]: visits },
      pending: !pm,
      note: pm ? null : detail,
      gate: null,
      history: pushHistory(state, { stage: to, at, via, detail }),
    },
    target: pm ? { kind: "pm", stage } : { kind: "worker", stage },
    loop: null,
  };
}

/**
 * The worker stage the task ran before its current one, for a reviewer who sends it back from a
 * `pm` stage. Falls back to `start`.
 */
export function previousWorkerStage(
  pipeline: CompiledPipeline,
  state: TaskPipeline,
): string {
  for (let index = state.history.length - 1; index >= 0; index--) {
    const entry = state.history[index]!;
    if (entry.via === "loop" || entry.stage === state.stage) continue;
    const stage = findStage(pipeline, entry.stage);
    if (stage && stage.role !== "pm") return stage.id;
  }
  return pipeline.start;
}

/** The card's stage chip: `spec · gate`, `implement 2/3`; null once the task left the stages. */
export function stageChip(
  pipeline: CompiledPipeline | null,
  state: TaskPipeline | null,
): string | null {
  if (!pipeline || !state || state.id !== pipeline.id) return null;
  const stage = findStage(pipeline, state.stage);
  if (!stage) return null;
  if (state.gate) return `${stage.id} · gate`;
  const visits = state.visits[stage.id] ?? 1;
  // A `pm` stage has no visit limit.
  return stage.role === "pm"
    ? `${stage.id} ${visits}`
    : `${stage.id} ${visits}/${stage.maxVisits}`;
}

/**
 * The text a stage's run gets after the task prompt: its procedure, the spec template for a
 * `spec` stage, and the user's answer at the gate that led here.
 */
export function stageSection(
  stage: CompiledStage,
  options: { template?: string | null; note?: string | null } = {},
): string {
  return [
    `## Pipeline stage: ${stage.id} (${stage.role})`,
    stage.prompt.trim(),
    options.template?.trim()
      ? `### Spec template\n\n${options.template.trim()}`
      : "",
    options.note?.trim()
      ? `### What the user said\n\n${options.note.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
