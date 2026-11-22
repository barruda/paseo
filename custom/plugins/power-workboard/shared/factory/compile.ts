// CUSTOM(factory): turns a loaded factory into the structures the engine uses today, each parsed by
// its own schema, so the board can apply it without knowing about files.
import { z } from "zod";
import {
  assistantChatSettingsSchema,
  assistantDefaultActionSchema,
  projectPolicySchema,
  type AssistantChatSettings,
  type ProjectPolicy,
} from "../assistant";
import {
  DEFAULT_GROUPS,
  DEFAULT_LABELS,
  nightSettingsSchema,
  orchestratorConfigSchema,
  orchestratorSchema,
  settingsSchema,
  type Group,
  type NightSettings,
  type Orchestrator,
  type OrchestratorConfig,
  type Settings,
} from "../model";
import type { SkillSelection } from "../profiles";
import { AUTOMATIC_SCHEDULE, type Schedule } from "../schedule";
import { DEFAULT_MAX_VISITS, DEFAULT_WORKER_ROLE } from "./pipeline";
import type {
  FactoryIssue,
  FactorySchedule,
  LoadedFactory,
  PipelineStage,
  StageRole,
  WorkerRole,
} from "./schema";

export type CompiledWorker = {
  id: string;
  /** The orchestrator it compiles to; its id is the worker id. */
  config: OrchestratorConfig;
  /** Defaults to implement, the role of every orchestrator today. */
  role: WorkerRole;
  /** `priority` of worker.md, 0 when it has none. */
  priority: number;
  description: string;
  systemPrompt: string;
  /** Names of workers/<id>/skills/*. */
  ownSkills: string[];
};

export type CompiledProject = {
  id: string;
  realPath: string;
  /** The Paseo project the path resolved to. */
  projectId: string;
  pipeline: string | null;
  /** Path of the spec template relative to the factory root, or null. */
  specTemplate: string | null;
};

export type CompiledStage = {
  id: string;
  role: StageRole;
  /** The pinned worker; null: the project's worker with the role, else its implement worker. */
  worker: string | null;
  /** The stage procedure: its prompt, its file's text, or roles/<role>.md. */
  prompt: string;
  session: "continue" | "fresh";
  maxVisits: number;
  /** Gate options always name their next stage once loaded. */
  gate: {
    question: string;
    options: Array<{ id: string; label: string; to: string }>;
  } | null;
  /** One stage (the board advances), conditions (the Project Manager chooses), or null with a gate. */
  to: string | Array<{ stage: string; when: string }> | null;
};

export type CompiledPipeline = {
  id: string;
  description: string;
  start: string;
  /** In file order. */
  stages: CompiledStage[];
  layout: Record<string, { x: number; y: number }>;
};

export type CompiledFactory = {
  name: string;
  /** Agent settings new orchestrators and refinement chats start from (`data.orchestrator`). */
  orchestrator: Orchestrator;
  /** In priority order (`data.orchestrators`). */
  orchestrators: OrchestratorConfig[];
  workers: CompiledWorker[];
  /** `data.settings`. */
  settings: Settings;
  /** `data.night`. */
  night: NightSettings;
  /** The config fields of `data.assistant.settings`; `reviews` belongs to the pipelines (ticket 13). */
  assistant: {
    enabled: boolean;
    defaultAction: z.infer<typeof assistantDefaultActionSchema>;
    /** Keyed by Paseo project id. */
    projects: Record<string, ProjectPolicy>;
    chat: AssistantChatSettings;
  };
  pm: { systemPrompt: string; ownSkills: string[] };
  projects: CompiledProject[];
  pipelines: CompiledPipeline[];
  /** Names of skills/*, for every worker. */
  sharedSkills: string[];
};

export type CompileOptions = {
  /** The Paseo project id of a checkout's real path; null when Paseo has no such project. */
  projectIdForPath: (realPath: string) => string | null;
};

export type CompileResult = {
  compiled: CompiledFactory | null;
  errors: FactoryIssue[];
  warnings: FactoryIssue[];
};

/** Drops undefined values, so a schema default fills them in. */
function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/** The first value that is not undefined (null counts as set). */
function pick<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

const modeIdOf = (permission: string | undefined) =>
  permission === undefined
    ? undefined
    : permission === "full"
      ? null
      : permission;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export function scheduleOf(schedule: FactorySchedule): Schedule {
  if (schedule === "automatic") return AUTOMATIC_SCHEDULE;
  if (schedule === "manual") return { kind: "manual" };
  if ("window" in schedule)
    return {
      kind: "window",
      days: schedule.window.days ?? ALL_DAYS,
      start: schedule.window.start,
      end: schedule.window.end,
    };
  return {
    kind: "daily",
    days: schedule.daily.days ?? ALL_DAYS,
    times: schedule.daily.times,
  };
}

export function skillsOf(skills: "all" | string[]): SkillSelection {
  return skills === "all"
    ? { mode: "all", names: [] }
    : { mode: "selected", names: skills };
}

/** Today's groups from board.yaml's columns; the first column of each kind keeps its `pwb:*` label. */
function groupsOf(factory: LoadedFactory): Group[] {
  const columns = factory.board.columns;
  if (!columns) return DEFAULT_GROUPS;
  const labeled = new Set<string>();
  return columns.map((column) => {
    let label = column.label;
    if (!label) {
      label = labeled.has(column.kind)
        ? `pwb:${column.id}`
        : DEFAULT_LABELS[column.kind];
      labeled.add(column.kind);
    }
    return {
      id: column.id,
      kind: column.kind,
      name: column.name ?? null,
      label,
      ...(column.color ? { color: column.color } : {}),
    };
  });
}

function parseOrIssue<T>(
  schema: z.ZodType<T>,
  input: unknown,
  file: string,
  what: string,
  errors: FactoryIssue[],
): T | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues)
    errors.push({
      kind: "compile",
      file,
      line: null,
      message: `${what}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`,
    });
  return null;
}

export function compileFactory(
  factory: LoadedFactory,
  options: CompileOptions,
): CompileResult {
  const errors: FactoryIssue[] = [];
  const warnings: FactoryIssue[] = [];
  const defaults = factory.factory.defaults ?? {};
  const workerDefaults = defaults.worker ?? {};
  const pm = factory.pm.settings;

  const projects: CompiledProject[] = [];
  const activeProjects = new Map<string, CompiledProject>();
  for (const project of factory.projects) {
    if (!project.realPath) continue; // The loader already warned.
    const projectId = options.projectIdForPath(project.realPath);
    if (!projectId) {
      warnings.push({
        kind: "inactive-project",
        file: project.file,
        line: null,
        message: `No Paseo project at ${project.realPath}; project "${project.id}" stays inactive`,
      });
      continue;
    }
    const compiled: CompiledProject = {
      id: project.id,
      realPath: project.realPath,
      projectId,
      pipeline: project.settings.pipeline ?? defaults.pipeline ?? null,
      specTemplate: project.settings.templates?.spec ?? null,
    };
    projects.push(compiled);
    activeProjects.set(project.id, compiled);
  }

  const orchestrator = parseOrIssue(
    orchestratorSchema,
    defined({
      provider: workerDefaults.model,
      modeId: modeIdOf(workerDefaults.permission),
      autoAccept: workerDefaults.autoAccept,
      thinkingOptionId: workerDefaults.thinking,
      useWorktree:
        workerDefaults.workspace === undefined
          ? undefined
          : workerDefaults.workspace === "worktree",
      refineModeId: modeIdOf(pm.interactivePermission),
    }),
    "factory.yaml",
    "orchestrator",
    errors,
  );

  const workers: CompiledWorker[] = [];
  const sorted = [...factory.workers].sort(
    (a, b) =>
      (a.settings.priority ?? 0) - (b.settings.priority ?? 0) ||
      a.id.localeCompare(b.id),
  );
  for (const worker of sorted) {
    const own = worker.settings;
    let projectId: string | null = null;
    if (own.project) {
      const project = activeProjects.get(own.project);
      if (!project) {
        warnings.push({
          kind: "inactive-project",
          file: worker.file,
          line: null,
          message: `Worker "${worker.id}" is off: its project "${own.project}" is inactive`,
        });
        continue;
      }
      projectId = project.projectId;
    }
    const setting = <K extends keyof typeof workerDefaults>(key: K) =>
      pick(own[key], workerDefaults[key]);
    const schedule = setting("schedule");
    const skills = setting("skills");
    const workspace = setting("workspace");
    const config = parseOrIssue(
      orchestratorConfigSchema,
      defined({
        id: worker.id,
        name: own.name ?? worker.id,
        projectId,
        enabled: own.enabled,
        schedule: schedule === undefined ? undefined : scheduleOf(schedule),
        maxConcurrent: setting("maxConcurrent"),
        batchSize: setting("batchSize"),
        provider: setting("model"),
        modeId: modeIdOf(setting("permission")),
        autoAccept: setting("autoAccept"),
        thinkingOptionId: setting("thinking"),
        useWorktree:
          workspace === undefined ? undefined : workspace === "worktree",
        instructions: worker.taskPrompt,
        skills: skills === undefined ? undefined : skillsOf(skills),
        memory: setting("memory"),
        poolId: setting("pool"),
        maxCheckpoints: setting("maxCheckpoints"),
      }),
      worker.file,
      "worker",
      errors,
    );
    if (!config) continue;
    workers.push({
      id: worker.id,
      config,
      role: own.role ?? DEFAULT_WORKER_ROLE,
      priority: own.priority ?? 0,
      description: own.description ?? "",
      systemPrompt: worker.systemPrompt,
      ownSkills: worker.skills.map((skill) => skill.name),
    });
  }

  const housekeeping = factory.board.housekeeping ?? {};
  const columns = groupsOf(factory);
  // The board adds these to the JSON's columns on its own; active mode reads board.yaml as it is.
  for (const kind of ["ready", "scheduled"] as const)
    if (!columns.some((column) => column.kind === kind))
      warnings.push({
        kind: "compile",
        file: "board.yaml",
        line: null,
        message:
          kind === "ready"
            ? "No ready column: in active mode no task starts"
            : "No scheduled column: in active mode night and scheduled tasks have nowhere to wait",
      });
  const settings = parseOrIssue(
    settingsSchema,
    defined({
      autoArchive: housekeeping.autoArchive,
      archiveAfterDays: housekeeping.archiveAfterDays,
      pinInProgressWorkspaces: housekeeping.pinInProgressWorkspaces,
      groups: columns,
      groupOrder: columns.map((group) => group.id),
      pools: factory.board.pools,
      tmpCleanup: housekeeping.tmpCleanup,
    }),
    "board.yaml",
    "settings",
    errors,
  );
  const night = parseOrIssue(
    nightSettingsSchema,
    factory.board.night ?? {},
    "board.yaml",
    "night",
    errors,
  );

  const defaultAction = defaults.delivery?.action ?? "review";
  const policies: Record<string, ProjectPolicy> = {};
  for (const project of factory.projects) {
    const active = activeProjects.get(project.id);
    const { delivery, tests } = project.settings;
    // A project with neither block follows `defaults.delivery`, as one with no policy does today.
    if (!active || (!delivery && !tests)) continue;
    const gate = tests?.gate ?? {};
    const policy = parseOrIssue(
      projectPolicySchema,
      defined({
        action: delivery?.action ?? defaultAction,
        observe: delivery?.observe,
        verifyCommand: delivery?.verifyCommand,
        autoFixes: delivery?.autoFixes,
        baseBranch: delivery?.baseBranch,
        tests: defined({
          gateCommand: gate.command,
          gateSetupCommand: gate.setup,
          gateRequiredEnv: gate.requiredEnv,
          gateEnv: gate.env,
          gateRunIn: gate.runIn,
          gateRiskPaths: gate.riskPaths,
        }),
      }),
      project.file,
      "project",
      errors,
    );
    if (policy) policies[active.projectId] = policy;
  }

  const chat = parseOrIssue(
    assistantChatSettingsSchema,
    defined({
      provider: pm.model,
      thinkingOptionId: pm.thinking,
      modeId: modeIdOf(pm.permission),
      autoAccept: pm.autoAccept,
      skills: pm.skills === undefined ? undefined : skillsOf(pm.skills),
      memory: pm.memory,
      wakeOnNeedsYou: pm.wake?.onNeedsYou,
      wakeDelaySeconds: pm.wake?.delaySeconds,
      compactAtTokens: pm.compactAtTokens,
    }),
    "pm/worker.md",
    "pm",
    errors,
  );

  if (errors.length > 0 || !orchestrator || !settings || !night || !chat)
    return { compiled: null, errors, warnings };
  return {
    compiled: {
      name: factory.factory.name,
      orchestrator,
      orchestrators: workers.map((worker) => worker.config),
      workers,
      settings,
      night,
      assistant: {
        enabled: pm.enabled ?? true,
        defaultAction,
        projects: policies,
        chat,
      },
      pm: {
        systemPrompt: factory.pm.systemPrompt,
        ownSkills: factory.pm.skills.map((skill) => skill.name),
      },
      projects,
      pipelines: factory.pipelines.map(({ id, pipeline, prompts }) => ({
        id,
        description: pipeline.description ?? "",
        start: pipeline.start,
        stages: Object.entries(pipeline.stages).map(([stageId, stage]) =>
          compileStage(stageId, stage, prompts[stageId] ?? ""),
        ),
        layout: pipeline.layout ?? {},
      })),
      sharedSkills: factory.skills.map((skill) => skill.name),
    },
    errors,
    warnings,
  };
}

function compileStage(
  id: string,
  stage: PipelineStage,
  prompt: string,
): CompiledStage {
  return {
    id,
    role: stage.role,
    worker: stage.worker ?? null,
    prompt,
    session: stage.session ?? "continue",
    maxVisits: stage.maxVisits ?? DEFAULT_MAX_VISITS,
    gate: stage.gate
      ? {
          question: stage.gate.question,
          // The pipeline schema rejects an option without `to`.
          options: stage.gate.options.map((option) => ({
            id: option.id,
            label: option.label,
            to: option.to ?? "",
          })),
        }
      : null,
    to: stage.to ?? null,
  };
}
