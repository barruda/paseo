// CUSTOM(pm-chat-task-sync): keeps a chat reply's `seu` line in step with the board tasks it cites
// as `[<task id>]`. The board answers a small RPC (`workboard.assistant.tasks.state`) with the
// state of each cited task; the chat draws the `seu` amber while a task waits for the user in
// Needs you and neutral or green once none does. Pure functions, so both mappings are tested
// without a board or a renderer.
import { z } from "zod";
import type { Delivery } from "./assistant";
import type { Orchestration, StageKind, Task } from "./model";

/** A cited task id: the first 8 hex characters or the whole UUID (as `splitReplyIds` reads it). */
export const TASK_REF_PATTERN =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;
/** The most ids one call answers; the chat asks for the union of the replies on screen. */
export const TASK_STATES_MAX = 200;

/**
 * Where a cited task is, as the chat cares about it:
 * - `needs-you`: its delivery waits for the user in Needs you.
 * - `running`: its agent (or its delivery) is at work.
 * - `done` / `canceled`: it sits in a Done or Canceled column.
 * - `archived`: it left the board.
 * - `other`: any other column, nobody working on it (a draft, Ready to review after a dismiss).
 */
export const replyTaskPhaseSchema = z.enum([
  "needs-you",
  "running",
  "done",
  "canceled",
  "archived",
  "other",
]);
export type ReplyTaskPhase = z.infer<typeof replyTaskPhaseSchema>;

export const replyTaskStateSchema = z.object({
  /** The id as the chat asked for it, lowercased. */
  ref: z.string(),
  id: z.string(),
  /** The short `#42` number; 0 on old data. */
  number: z.number().int().min(0),
  columnId: z.string().nullable(),
  /** The column's name as the board shows it. */
  column: z.string().nullable(),
  phase: replyTaskPhaseSchema,
  /** The task waits for the user (phase `needs-you`). */
  needsYou: z.boolean(),
  /** The last change the board knows of: the task, its delivery or its agent run. */
  changedAt: z.string().nullable(),
});
export type ReplyTaskState = z.infer<typeof replyTaskStateSchema>;

const ACTIVE_RUNS: ReadonlySet<Orchestration["status"]> = new Set([
  "starting",
  "running",
  "queued",
  "waiting",
]);
const ACTIVE_DELIVERIES: ReadonlySet<Delivery["stage"]> = new Set([
  "reported",
  "verifying",
  "fixing",
  "committing",
  "merging",
  "preparing-pr",
]);

/** The phase of one task. Done and Canceled win over a stale delivery; a resumed agent wins over Needs you. */
export function replyTaskPhase(input: {
  archived: boolean;
  kind: StageKind | undefined;
  delivery: Pick<Delivery, "stage"> | undefined;
  run: Pick<Orchestration, "status"> | undefined;
}): ReplyTaskPhase {
  if (input.archived) return "archived";
  if (input.kind === "done") return "done";
  if (input.kind === "canceled") return "canceled";
  if (input.run && ACTIVE_RUNS.has(input.run.status)) return "running";
  if (input.delivery?.stage === "needs-you") return "needs-you";
  if (input.delivery && ACTIVE_DELIVERIES.has(input.delivery.stage))
    return "running";
  return "other";
}

const newest = (...values: (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time) || time <= bestTime) continue;
    best = value;
    bestTime = time;
  }
  return best;
};

/** The task each ref names: the whole id, else the task whose id starts with the 8 characters. */
export function findTaskByRef<T extends Pick<Task, "id">>(
  tasks: readonly T[],
  ref: string,
): T | undefined {
  const wanted = ref.toLowerCase();
  return (
    tasks.find((task) => task.id.toLowerCase() === wanted) ??
    (wanted.length === 8
      ? tasks.find((task) => task.id.toLowerCase().startsWith(wanted))
      : undefined)
  );
}

/** The state of each cited task the board has; a ref that names no task is left out. */
export function buildReplyTaskStates(
  refs: readonly string[],
  source: {
    tasks: readonly Task[];
    deliveries: Readonly<Record<string, Delivery>>;
    orchestrations: Readonly<Record<string, Orchestration>>;
    groups: readonly {
      id: string;
      kind: StageKind;
      name?: string | null;
      label: string;
    }[];
    /** The column the board shows the task in (`Workboard.snapshot`'s `stage`). */
    stageOf: (task: Task) => string;
  },
): ReplyTaskState[] {
  const states: ReplyTaskState[] = [];
  for (const raw of new Set(refs.map((ref) => ref.toLowerCase()))) {
    const task = findTaskByRef(source.tasks, raw);
    if (!task) continue;
    const stage = source.stageOf(task);
    const group = source.groups.find((item) => item.id === stage);
    const delivery = source.deliveries[task.id];
    const run = source.orchestrations[task.id];
    const archived =
      task.archived?.status === "archived" ||
      task.archived?.status === "external";
    const phase = replyTaskPhase({
      archived,
      kind: group?.kind,
      delivery,
      run,
    });
    states.push({
      ref: raw,
      id: task.id,
      number: task.number,
      columnId: stage,
      column: group ? (group.name ?? group.label) : stage,
      phase,
      needsYou: phase === "needs-you",
      changedAt: newest(
        task.updatedAt,
        delivery?.updatedAt,
        run?.finishedAt,
        run?.startedAt,
        task.archived?.archivedAt,
      ),
    });
  }
  return states;
}

/**
 * How the `seu` line draws, from the tasks it cites:
 * - `none`: it cites no task, the states have not loaded, the call failed, or no cited task is on
 *   the board; it draws as it always did (amber).
 * - `pending`: a cited task still waits for the user in Needs you; amber.
 * - `settled`: none does. `success` (green) when every cited task is Done, else `muted` (neutral).
 */
export type ReplyTaskView =
  | { state: "none" }
  | { state: "pending"; tasks: ReplyTaskState[] }
  | {
      state: "settled";
      tone: "success" | "muted";
      tasks: ReplyTaskState[];
      /** The newest change among the cited tasks. */
      at: string | null;
    };

/** The view of a `seu` line, from the ids it cites and the board's answer (undefined: not loaded). */
export function replyTaskView(
  ids: readonly string[],
  states: readonly ReplyTaskState[] | undefined,
): ReplyTaskView {
  if (ids.length === 0 || !states) return { state: "none" };
  const byRef = new Map(states.map((item) => [item.ref, item]));
  const tasks = [...new Set(ids.map((id) => id.toLowerCase()))]
    .map((id) => byRef.get(id))
    .filter((item): item is ReplyTaskState => item !== undefined);
  if (tasks.length === 0) return { state: "none" };
  if (tasks.some((item) => item.needsYou)) return { state: "pending", tasks };
  return {
    state: "settled",
    tone: tasks.every((item) => item.phase === "done") ? "success" : "muted",
    tasks,
    at: newest(...tasks.map((item) => item.changedAt)),
  };
}

/** "#138 Done", "#140 em andamento": one task's state for the settled `seu`. */
export function replyTaskLabel(
  task: ReplyTaskState,
  labels: { taskRunning: string; archived: string },
): string {
  const state =
    task.phase === "running"
      ? labels.taskRunning
      : task.phase === "archived"
        ? labels.archived
        : (task.column ?? task.columnId ?? "");
  const number = task.number > 0 ? `#${task.number}` : task.id.slice(0, 8);
  return state ? `${number} ${state}` : number;
}
