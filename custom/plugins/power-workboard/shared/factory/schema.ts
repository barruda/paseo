// CUSTOM(factory): the schemas of the factory's files (docs/factory.md, "Layout"). They are strict,
// so a typo is an error, and they carry no defaults: an omitted field inherits (worker from
// `defaults.worker`, everything else from today's schemas) when the compiler fills it in.
import { z } from "zod";
import {
  assistantActionSchema,
  assistantDefaultActionSchema,
} from "../assistant";
import { autonomyPresetIdSchema } from "../autonomy";
import {
  GROUP_COLORS,
  nightSettingsSchema,
  stageKindSchema,
  stageSchema,
  tmpCleanupSchema,
} from "../model";
import { timeOfDaySchema } from "../schedule";
import { pipelineProblems } from "./pipeline";

export const FACTORY_SCHEMA_VERSION = "pwb/v1alpha1";

/** A worker, project or pipeline id: its folder or file name. */
export const factoryIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and dashes")
  .max(80);

/** Where a factory problem is: a path relative to the factory root, and its 1-based line. */
export const FACTORY_ISSUE_KINDS = [
  "missing-file",
  "parse",
  "schema",
  "invalid-id",
  "unknown-file",
  "unsupported",
  "reference",
  "inactive-project",
  "compile",
] as const;
export type FactoryIssueKind = (typeof FACTORY_ISSUE_KINDS)[number];
export type FactoryIssue = {
  kind: FactoryIssueKind;
  file: string;
  line: number | null;
  message: string;
};

const providerModel = z
  .string()
  .trim()
  .min(3)
  .refine((value) => {
    const slash = value.indexOf("/");
    return slash > 0 && slash < value.length - 1;
  }, "Use provider/model");
/** `full` is full access; anything else is a provider mode id. */
const permission = z.string().trim().min(1);
const days = z.array(z.number().int().min(0).max(6)).min(1);

export const factoryScheduleSchema = z.union([
  z.literal("automatic"),
  z.literal("manual"),
  z.strictObject({
    window: z.strictObject({
      days: days.optional(),
      start: timeOfDaySchema,
      end: timeOfDaySchema,
    }),
  }),
  z.strictObject({
    daily: z.strictObject({
      days: days.optional(),
      times: z.array(timeOfDaySchema).min(1),
    }),
  }),
]);
export type FactorySchedule = z.infer<typeof factoryScheduleSchema>;

/** `all` or the names the allowlist takes (`skill` or `plugin:skill`). */
export const factorySkillsSchema = z.union([
  z.literal("all"),
  z.array(z.string().trim().min(1).max(200)).max(500),
]);

/** Agent settings a worker may set and `defaults.worker` may give every worker. */
const workerSettingsShape = {
  model: providerModel.optional(),
  thinking: z.string().trim().min(1).nullable().optional(),
  permission: permission.optional(),
  /** Feature providers (OpenCode, Cursor...). */
  autoAccept: z.boolean().optional(),
  workspace: z.enum(["worktree", "folder"]).optional(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  batchSize: z.number().int().min(1).max(50).optional(),
  maxCheckpoints: z.number().int().min(0).max(50).optional(),
  /** Id of a pool in board.yaml; null: only the worker's own limit. */
  pool: factoryIdSchema.nullable().optional(),
  schedule: factoryScheduleSchema.optional(),
  skills: factorySkillsSchema.optional(),
  memory: z.boolean().optional(),
};

export const factoryFileSchema = z.strictObject({
  schemaVersion: z.literal(FACTORY_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(80),
  description: z.string().optional(),
  defaults: z
    .strictObject({
      worker: z.strictObject(workerSettingsShape).optional(),
      delivery: z
        .strictObject({ action: assistantDefaultActionSchema.optional() })
        .optional(),
      /** Id of pipelines/*.yaml for projects that name none. */
      pipeline: factoryIdSchema.optional(),
    })
    .optional(),
});
export type FactoryFile = z.infer<typeof factoryFileSchema>;

export const factoryColumnSchema = z.strictObject({
  id: stageSchema,
  kind: stageKindSchema,
  name: z.string().trim().min(1).max(80).nullable().optional(),
  /** Defaults to today's `pwb:*` label of the kind (the first column of each kind). */
  label: z.string().trim().min(1).max(120).optional(),
  color: z.enum(GROUP_COLORS).optional(),
});
export type FactoryColumn = z.infer<typeof factoryColumnSchema>;

export const factoryPoolSchema = z.strictObject({
  id: factoryIdSchema,
  name: z.string().trim().min(1).max(80),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  minFreeRamPercent: z.number().int().min(1).max(95).nullable().optional(),
});

export const boardFileSchema = z
  .strictObject({
    /** Order on screen. */
    columns: z.array(factoryColumnSchema).min(1).optional(),
    pools: z.array(factoryPoolSchema).optional(),
    night: z.strictObject(nightSettingsSchema.shape).optional(),
    housekeeping: z
      .strictObject({
        autoArchive: z.boolean().optional(),
        archiveAfterDays: z.number().int().min(0).max(365).optional(),
        pinInProgressWorkspaces: z.boolean().optional(),
        tmpCleanup: z.strictObject(tmpCleanupSchema.shape).optional(),
      })
      .optional(),
  })
  .superRefine((board, context) => {
    const columns = board.columns ?? [];
    const seen = new Set<string>();
    columns.forEach((column, index) => {
      if (seen.has(column.id))
        context.addIssue({
          code: "custom",
          path: ["columns", index, "id"],
          message: `Duplicate column id "${column.id}"`,
        });
      seen.add(column.id);
    });
    if (columns.length > 0 && !columns.some((column) => column.kind === "todo"))
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Keep at least one column of kind todo for drafts",
      });
    const pools = new Set<string>();
    (board.pools ?? []).forEach((pool, index) => {
      if (pools.has(pool.id))
        context.addIssue({
          code: "custom",
          path: ["pools", index, "id"],
          message: `Duplicate pool id "${pool.id}"`,
        });
      pools.add(pool.id);
    });
  });
export type BoardFile = z.infer<typeof boardFileSchema>;

export const WORKER_ROLES = [
  "triage",
  "spec",
  "implement",
  "verify",
  "review",
] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/** The frontmatter of workers/<id>/worker.md; the body is the system prompt. */
export const workerFrontmatterSchema = z.strictObject({
  /** Shown in the board; defaults to the id. */
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().optional(),
  role: z.enum(WORKER_ROLES).optional(),
  /** Id of projects/*.yaml; null takes projects with no worker of their own. */
  project: factoryIdSchema.nullable().optional(),
  /** Lower takes tasks first; equal priorities go by id. Defaults to 0. */
  priority: z.number().int().min(-1000).max(1000).optional(),
  enabled: z.boolean().optional(),
  ...workerSettingsShape,
});
export type WorkerFrontmatter = z.infer<typeof workerFrontmatterSchema>;

/** The frontmatter of pm/worker.md; the body is the Project Manager's system prompt. */
export const pmFrontmatterSchema = z.strictObject({
  role: z.literal("foreman").optional(),
  enabled: z.boolean().optional(),
  model: providerModel.optional(),
  thinking: z.string().trim().min(1).nullable().optional(),
  permission: permission.optional(),
  autoAccept: z.boolean().optional(),
  skills: factorySkillsSchema.optional(),
  memory: z.boolean().optional(),
  wake: z
    .strictObject({
      onNeedsYou: z.boolean().optional(),
      delaySeconds: z.number().int().min(3).max(300).optional(),
    })
    .optional(),
  compactAtTokens: z.number().int().min(0).max(10_000_000).optional(),
  /** Permission of interactive chats (refinement, spec stages): `default` asks before edits. */
  interactivePermission: permission.optional(),
  /** The board's autonomy preset (shared/autonomy.ts); a pipeline or project may override it. */
  autonomy: autonomyPresetIdSchema.optional(),
});
export type PmFrontmatter = z.infer<typeof pmFrontmatterSchema>;

export const projectFileSchema = z.strictObject({
  /** The checkout; `~/` is the home folder, a relative path starts at the factory root. */
  path: z.string().trim().min(1),
  /** Id of pipelines/*.yaml; defaults to `defaults.pipeline` in factory.yaml. */
  pipeline: factoryIdSchema.optional(),
  /** Overrides the pipeline's and pm/worker.md's autonomy preset. */
  autonomy: autonomyPresetIdSchema.optional(),
  delivery: z
    .strictObject({
      action: assistantActionSchema.optional(),
      observe: z.boolean().optional(),
      baseBranch: z.string().max(200).optional(),
      verifyCommand: z.string().max(2000).optional(),
      autoFixes: z.number().int().min(0).max(3).optional(),
    })
    .optional(),
  tests: z
    .strictObject({
      gate: z
        .strictObject({
          command: z.string().max(2000).optional(),
          setup: z.string().max(2000).optional(),
          requiredEnv: z.array(z.string().trim().min(1)).optional(),
          env: z.record(z.string(), z.string()).optional(),
          runIn: z.enum(["worktree", "checkout"]).optional(),
          riskPaths: z.array(z.string().trim().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),
  templates: z
    .strictObject({
      /** A file under the factory root, e.g. templates/spec.md. */
      spec: z.string().trim().min(1).optional(),
    })
    .optional(),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

/** SKILL.md frontmatter is Claude's format: only `name` and `description` are checked. */
export const skillFrontmatterSchema = z.looseObject({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

/** Max length of a task prompt (today's orchestrator `instructions`) and of a stage's `prompt`. */
export const TASK_PROMPT_LIMIT = 20_000;

/** A stage's role: a worker role, or `pm` for the Project Manager (today's self review). */
export const STAGE_ROLES = [...WORKER_ROLES, "pm"] as const;
export type StageRole = (typeof STAGE_ROLES)[number];

export const pipelineStageSchema = z.strictObject({
  role: z.enum(STAGE_ROLES),
  /** Pins one worker; otherwise the project's worker with the role, else its implement worker. */
  worker: factoryIdSchema.optional(),
  /** The stage procedure. Defaults to roles/<role>.md. */
  prompt: z.string().trim().min(1).max(TASK_PROMPT_LIMIT).optional(),
  /** A file under the factory root holding the stage procedure. */
  file: z.string().trim().min(1).optional(),
  /** `continue` (default): the role's last agent on the task continues; `fresh`: a new agent. */
  session: z.enum(["continue", "fresh"]).optional(),
  /** After the stage, ask the user; each option names the stage it leads to. */
  gate: z
    .strictObject({
      question: z.string().trim().min(1).max(500),
      options: z
        .array(
          z.strictObject({
            id: factoryIdSchema,
            label: z.string().trim().min(1).max(80),
            // Optional here so the pipeline check names the option that lacks it.
            to: factoryIdSchema.optional(),
          }),
        )
        .min(1),
    })
    .optional(),
  /** One stage (the board advances) or a list of conditions (the Project Manager chooses). */
  to: z
    .union([
      factoryIdSchema,
      z
        .array(
          z.strictObject({
            stage: factoryIdSchema,
            when: z.string().trim().min(1).max(500),
          }),
        )
        .min(1),
    ])
    .optional(),
  /** Visits before the task goes to Needs you as `loop`; defaults to 3. */
  maxVisits: z.number().int().min(1).max(20).optional(),
});
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

const pipelineShapeSchema = z.strictObject({
  description: z.string().optional(),
  /** Overrides pm/worker.md's autonomy preset for the projects that run this pipeline. */
  autonomy: autonomyPresetIdSchema.optional(),
  /** The stage a task enters when it leaves Ready. */
  start: factoryIdSchema,
  stages: z.record(factoryIdSchema, pipelineStageSchema),
  /** Editor positions only; the engine ignores it. */
  layout: z
    .record(factoryIdSchema, z.strictObject({ x: z.number(), y: z.number() }))
    .optional(),
});

/** pipelines/<id>.yaml. The checks inside one file run here, so the editor gets them too. */
export const pipelineFileSchema = pipelineShapeSchema.superRefine(
  (pipeline, context) => {
    for (const problem of pipelineProblems(pipeline))
      context.addIssue({
        code: "custom",
        path: problem.path,
        message: problem.message,
      });
  },
);
export type PipelineFile = z.infer<typeof pipelineFileSchema>;

/** The JSON Schema files `bin/factory schema` writes to `.schema/`, for editor completion. */
export const FACTORY_JSON_SCHEMAS = {
  "factory.json": factoryFileSchema,
  "board.json": boardFileSchema,
  "project.json": projectFileSchema,
  "worker.json": workerFrontmatterSchema,
  "pm.json": pmFrontmatterSchema,
  "pipeline.json": pipelineFileSchema,
} as const;

/** A skill folder with a valid SKILL.md. */
export type FactorySkill = { name: string; description: string; file: string };

/** A factory read from disk with every file valid and every reference resolved. */
export type LoadedFactory = {
  root: string;
  factory: FactoryFile;
  board: BoardFile;
  pm: {
    settings: PmFrontmatter;
    systemPrompt: string;
    skills: FactorySkill[];
  };
  workers: Array<{
    id: string;
    file: string;
    settings: WorkerFrontmatter;
    systemPrompt: string;
    /** Text that opens every task; empty when there is no task-prompt.md. */
    taskPrompt: string;
    skills: FactorySkill[];
  }>;
  projects: Array<{
    id: string;
    file: string;
    settings: ProjectFile;
    /** The checkout's real path; null when it does not exist (the project stays inactive). */
    realPath: string | null;
  }>;
  pipelines: Array<{
    id: string;
    file: string;
    pipeline: PipelineFile;
    /** Each stage's procedure: its `prompt`, its `file`'s text, else roles/<role>.md. */
    prompts: Record<string, string>;
  }>;
  /** roles/<role>.md, trimmed. */
  roles: Partial<Record<StageRole, string>>;
  /** skills/<name>/SKILL.md, for every worker. */
  skills: FactorySkill[];
};
