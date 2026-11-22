// CUSTOM(factory): the pipeline editor's edit model (docs/factory.md, "Pipeline editor", ticket 14).
// Pure: every edit takes a draft and returns a new one. The draft keeps the pipeline as loaded
// (`base`), so Save sends only what changed, and the stage renames, so the writer renames a key in
// place and its comments and position in the file stay.
import { BUILTIN_STAGES, isBuiltinStage, stageTargets } from "./pipeline";
import {
  factoryIdSchema,
  pipelineFileSchema,
  type PipelineFile,
  type PipelineStage,
  type StageRole,
} from "./schema";

export type PipelineDraft = {
  /** The pipeline as the factory loaded it. */
  base: PipelineFile;
  /** The pipeline with the edits. */
  pipeline: PipelineFile;
  /** Base stage id → its id in `pipeline`, for the stages renamed since `base`. */
  renames: Record<string, string>;
};

export type Point = { x: number; y: number };

export type PipelineIssue = { path: Array<string | number>; message: string };

/** A stage patch: an undefined value removes the key. */
export type StagePatch = { [K in keyof PipelineStage]?: PipelineStage[K] };

export function startDraft(base: PipelineFile): PipelineDraft {
  return {
    base,
    pipeline: structuredClone(base),
    renames: {},
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON with sorted keys and no undefined values, so key order never makes two values differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** True when the draft would write something. */
export function draftDirty(draft: PipelineDraft): boolean {
  return (
    canonical(draft.base) !== canonical(draft.pipeline) ||
    Object.keys(draft.renames).length > 0
  );
}

/** The schema's problems with the draft, with their path in the file (live validation). */
export function pipelineIssues(pipeline: PipelineFile): PipelineIssue[] {
  const result = pipelineFileSchema.safeParse(pipeline);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map((key) =>
      typeof key === "symbol" ? String(key) : key,
    ),
    message: issue.message,
  }));
}

/** The issues of one stage (`stages.<id>...` and `layout.<id>`). */
export function stageIssues(
  issues: readonly PipelineIssue[],
  id: string,
): PipelineIssue[] {
  return issues.filter(
    (issue) =>
      (issue.path[0] === "stages" || issue.path[0] === "layout") &&
      issue.path[1] === id,
  );
}

/** Renames object keys in place of the old ones, keeping the order. All at once, so swaps work. */
function renameKeys<T>(
  record: Record<string, T>,
  renames: Record<string, string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      Object.hasOwn(renames, key) ? renames[key] : key,
      value,
    ]),
  );
}

/**
 * Renames the keys of `stages` and `layout` only; the references (`start`, `to`, gate options)
 * keep the old ids. The writer applies the same renames to the file's keys, so a diff from this
 * to the draft holds the reference changes.
 */
export function renameStageKeys(
  pipeline: PipelineFile,
  renames: Record<string, string>,
): PipelineFile {
  const next: PipelineFile = {
    ...pipeline,
    stages: renameKeys(pipeline.stages, renames),
  };
  if (pipeline.layout) next.layout = renameKeys(pipeline.layout, renames);
  return next;
}

/** Points every reference to `from` at `to`. */
function renameReferences(
  pipeline: PipelineFile,
  from: string,
  to: string,
): PipelineFile {
  const swap = (id: string) => (id === from ? to : id);
  const stages = Object.fromEntries(
    Object.entries(pipeline.stages).map(([id, stage]) => {
      const next: PipelineStage = { ...stage };
      if (typeof stage.to === "string") next.to = swap(stage.to);
      else if (stage.to)
        next.to = stage.to.map((option) => ({
          ...option,
          stage: swap(option.stage),
        }));
      if (stage.gate)
        next.gate = {
          ...stage.gate,
          options: stage.gate.options.map((option) =>
            option.to === undefined
              ? option
              : { ...option, to: swap(option.to) },
          ),
        };
      return [id, next];
    }),
  );
  return { ...pipeline, start: swap(pipeline.start), stages };
}

/** A stage id the pipeline lacks: `base`, then `base-2`, `base-3`... */
export function freeStageId(pipeline: PipelineFile, base: string): string {
  const taken = (id: string) =>
    Object.hasOwn(pipeline.stages, id) || isBuiltinStage(id);
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

function withStage(
  draft: PipelineDraft,
  id: string,
  change: (stage: PipelineStage) => PipelineStage,
): PipelineDraft {
  const stage = draft.pipeline.stages[id];
  if (!stage) return draft;
  return {
    ...draft,
    pipeline: {
      ...draft.pipeline,
      stages: { ...draft.pipeline.stages, [id]: change(stage) },
    },
  };
}

/**
 * Adds a stage with `role`, its id the role (`-2` on repeats). It has no transition yet, so the
 * validation asks for one. `at` places it when the pipeline has a layout.
 */
export function addStage(
  draft: PipelineDraft,
  role: StageRole,
  at?: Point,
): { draft: PipelineDraft; id: string } {
  const id = freeStageId(draft.pipeline, role);
  const pipeline: PipelineFile = {
    ...draft.pipeline,
    stages: { ...draft.pipeline.stages, [id]: { role } },
  };
  if (at && pipeline.layout && Object.keys(pipeline.layout).length)
    pipeline.layout = { ...pipeline.layout, [id]: at };
  return { draft: { ...draft, pipeline }, id };
}

/**
 * Removes a stage and every transition to it. A gate option that led there keeps its label and
 * loses its `to`, so the validation points at it. A removed `start` moves to the first stage left.
 */
export function removeStage(draft: PipelineDraft, id: string): PipelineDraft {
  if (!Object.hasOwn(draft.pipeline.stages, id)) return draft;
  const stages: Record<string, PipelineStage> = {};
  for (const [key, stage] of Object.entries(draft.pipeline.stages)) {
    if (key === id) continue;
    stages[key] = dropTarget(stage, id);
  }
  const pipeline: PipelineFile = { ...draft.pipeline, stages };
  if (pipeline.start === id) pipeline.start = Object.keys(stages)[0] ?? id;
  if (pipeline.layout && Object.hasOwn(pipeline.layout, id)) {
    const { [id]: _removed, ...layout } = pipeline.layout;
    pipeline.layout = layout;
  }
  const renames = Object.fromEntries(
    Object.entries(draft.renames).filter(([, to]) => to !== id),
  );
  return { ...draft, pipeline, renames };
}

/**
 * The stage with every transition to `target` removed. A gate option leading there loses its `to`,
 * or is dropped whole with `dropOptions`.
 */
function dropTarget(
  stage: PipelineStage,
  target: string,
  dropOptions = false,
): PipelineStage {
  const next: PipelineStage = { ...stage };
  if (stage.to === target) delete next.to;
  else if (Array.isArray(stage.to)) {
    const kept = stage.to.filter((option) => option.stage !== target);
    if (kept.length) next.to = kept;
    else delete next.to;
  }
  if (stage.gate)
    next.gate = {
      ...stage.gate,
      options: dropOptions
        ? stage.gate.options.filter((option) => option.to !== target)
        : stage.gate.options.map((option) => {
            if (option.to !== target) return option;
            const { to: _to, ...rest } = option;
            return rest;
          }),
    };
  return next;
}

export type RenameError = "invalid" | "builtin" | "taken";

/** Renames a stage and every reference to it. */
export function renameStage(
  draft: PipelineDraft,
  from: string,
  to: string,
): PipelineDraft | { error: RenameError } {
  if (from === to || !Object.hasOwn(draft.pipeline.stages, from)) return draft;
  if (!factoryIdSchema.safeParse(to).success) return { error: "invalid" };
  if (isBuiltinStage(to)) return { error: "builtin" };
  if (Object.hasOwn(draft.pipeline.stages, to)) return { error: "taken" };
  // A base stage's id stays taken until that stage is renamed away, even after it is removed:
  // Save renames keys before it removes any, so the file would hold the id twice.
  if (Object.hasOwn(draft.base.stages, to) && !Object.hasOwn(draft.renames, to))
    return { error: "taken" };
  const pipeline = renameReferences(
    renameStageKeys(draft.pipeline, { [from]: to }),
    from,
    to,
  );
  const renames = { ...draft.renames };
  const original = Object.keys(renames).find((key) => renames[key] === from);
  if (original !== undefined) renames[original] = to;
  else if (
    Object.hasOwn(draft.base.stages, from) &&
    !Object.hasOwn(renames, from)
  )
    renames[from] = to;
  for (const key of Object.keys(renames))
    if (renames[key] === key) delete renames[key];
  return { ...draft, pipeline, renames };
}

/** Sets stage fields; an undefined value removes the key. */
export function updateStage(
  draft: PipelineDraft,
  id: string,
  patch: StagePatch,
): PipelineDraft {
  return withStage(draft, id, (stage) => {
    const next: Record<string, unknown> = { ...stage };
    for (const [key, value] of Object.entries(patch))
      if (value === undefined) delete next[key];
      else next[key] = value;
    return next as PipelineStage;
  });
}

export function setStart(draft: PipelineDraft, id: string): PipelineDraft {
  if (!Object.hasOwn(draft.pipeline.stages, id)) return draft;
  return { ...draft, pipeline: { ...draft.pipeline, start: id } };
}

/** A gate option id from a stage id, free among `taken`. */
function freeOptionId(target: string, taken: Set<string>): string {
  let id = target;
  for (let n = 2; taken.has(id); n++) id = `${target}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Connects `from` to `target`, as the drag from a node or the picker does. A stage with no
 * transition gets `to: target`; a single `to` becomes a list of `when` conditions (empty, so the
 * validation asks for them); a list gets one more; a gate gets one more option.
 */
export function connectStages(
  draft: PipelineDraft,
  from: string,
  target: string,
): PipelineDraft {
  const stage = draft.pipeline.stages[from];
  if (!stage || stageTargets(stage).includes(target)) return draft;
  if (!Object.hasOwn(draft.pipeline.stages, target) && !isBuiltinStage(target))
    return draft;
  return withStage(draft, from, (current) => {
    if (current.gate) {
      const taken = new Set(current.gate.options.map((option) => option.id));
      return {
        ...current,
        gate: {
          ...current.gate,
          options: [
            ...current.gate.options,
            { id: freeOptionId(target, taken), label: target, to: target },
          ],
        },
      };
    }
    if (current.to === undefined) return { ...current, to: target };
    if (typeof current.to === "string")
      return {
        ...current,
        to: [
          { stage: current.to, when: "" },
          { stage: target, when: "" },
        ],
      };
    return { ...current, to: [...current.to, { stage: target, when: "" }] };
  });
}

/** Removes every transition from `from` to `target`. */
export function disconnectStages(
  draft: PipelineDraft,
  from: string,
  target: string,
): PipelineDraft {
  return withStage(draft, from, (stage) => dropTarget(stage, target, true));
}

/**
 * Turns a stage's gate on or off, keeping where it leads. On: each target becomes an option with
 * an empty question for the user to write. Off: one target becomes `to`, several become `when`
 * conditions to fill in.
 */
export function setGate(
  draft: PipelineDraft,
  id: string,
  on: boolean,
): PipelineDraft {
  return withStage(draft, id, (stage) => {
    if (on === (stage.gate !== undefined)) return stage;
    const targets = [...new Set(stageTargets(stage))];
    const { gate: _gate, to: _to, ...rest } = stage;
    if (on) {
      const taken = new Set<string>();
      return {
        ...rest,
        gate: {
          question: "",
          options: targets.map((target) => ({
            id: freeOptionId(target, taken),
            label: target,
            to: target,
          })),
        },
      };
    }
    if (targets.length === 0) return rest;
    if (targets.length === 1) return { ...rest, to: targets[0] };
    return { ...rest, to: targets.map((stage) => ({ stage, when: "" })) };
  });
}

/**
 * Moves a node to `at`. `placed` holds where every node is drawn now, in layout coordinates: a
 * layout that misses a node is ignored by the drawing, so the first move saves them all.
 */
export function moveNode(
  draft: PipelineDraft,
  id: string,
  at: Point,
  placed: Record<string, Point>,
): PipelineDraft {
  const round = (point: Point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
  const layout: Record<string, Point> = { ...(draft.pipeline.layout ?? {}) };
  for (const [key, point] of Object.entries(placed)) layout[key] = round(point);
  layout[id] = round(at);
  return { ...draft, pipeline: { ...draft.pipeline, layout } };
}

/** Every stage and built-in a transition can name, the pipeline's own first. */
export function transitionTargets(pipeline: PipelineFile): string[] {
  return [...Object.keys(pipeline.stages), ...BUILTIN_STAGES];
}
