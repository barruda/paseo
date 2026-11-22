// CUSTOM(factory): the revision stamp each run and history event records (docs/factory.md,
// "Loading and revisions"), so metrics can compare runs before and after a config change.
import { createHash } from "node:crypto";
import { DEFAULT_AUTONOMY } from "../../shared/autonomy";
import type { CompiledWorker } from "../../shared/factory/compile";
import { DEFAULT_WORKER_ROLE } from "../../shared/factory/pipeline";
import type { OrchestratorConfig } from "../../shared/model";

export type RevisionStamp = {
  /** Git HEAD of the factory (`+dirty.<hash>` when uncommitted); null with the factory off or in shadow. */
  factoryRevision: string | null;
  /** The worker (orchestrator) that ran the task. */
  workerId: string | null;
  /** `workerConfigHash` of that worker's config when the run started. */
  workerConfigHash: string | null;
};

/**
 * The fields that change what the worker's agent does. Scheduling and identity (id, name,
 * project, enabled, schedule, concurrency, batch, pool) stay out, so retuning a schedule or
 * renaming a worker keeps its hash, and the same config hashes the same under a UUID (the live
 * board) and a slug (the factory).
 */
export type WorkerHashInput = {
  config: Pick<
    OrchestratorConfig,
    | "provider"
    | "modeId"
    | "autoAccept"
    | "thinkingOptionId"
    | "useWorktree"
    | "instructions"
    | "skills"
    | "memory"
    | "maxCheckpoints"
  >;
  /** The worker's system prompt (`system-prompt.md` or the body of `worker.md`). */
  systemPrompt: string;
  /** The factory role; null on the live board, whose orchestrators are all implement workers. */
  role?: string | null;
  /** CUSTOM(factory): the resolved autonomy preset of the worker's project (ticket 12). */
  autonomy?: string | null;
};

/** JSON with object keys sorted at every level, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** 16 hex characters of a sha256 over the agent-facing config, its system prompt and task prompt. */
export function workerConfigHash(input: WorkerHashInput): string {
  const { config } = input;
  const payload = {
    v: 1,
    provider: config.provider,
    modeId: config.modeId,
    autoAccept: config.autoAccept,
    thinkingOptionId: config.thinkingOptionId,
    useWorktree: config.useWorktree,
    // The agent gets the trimmed system prompt (buildAgentProfile), so outer whitespace is no change.
    systemPrompt: input.systemPrompt.trim(),
    taskPrompt: config.instructions,
    skills: {
      mode: config.skills.mode,
      names: [...config.skills.names].sort(),
    },
    memory: config.memory,
    maxCheckpoints: config.maxCheckpoints,
    // A live orchestrator (null) and a factory implement worker are the same worker: hash both as
    // null, so their hashes match and the hashes recorded before roles existed stay valid.
    role: input.role && input.role !== DEFAULT_WORKER_ROLE ? input.role : null,
    // Left out at `standard` (and on the live board), so the hashes from before presets stay valid.
    autonomy:
      input.autonomy && input.autonomy !== DEFAULT_AUTONOMY
        ? input.autonomy
        : undefined,
  };
  return createHash("sha256")
    .update(canonical(payload))
    .digest("hex")
    .slice(0, 16);
}

/** The hash of a worker compiled from the factory (active mode). */
export function compiledWorkerConfigHash(worker: CompiledWorker): string {
  return workerConfigHash({
    config: worker.config,
    systemPrompt: worker.systemPrompt,
    role: worker.role,
    autonomy: worker.autonomy,
  });
}
