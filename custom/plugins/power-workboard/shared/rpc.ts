import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { deskStatusSchema } from "./desk-status";
import { factoryStatusSchema } from "./factory/status"; // CUSTOM(factory)
import {
  FINISH_STEPS,
  GROUP_COLORS,
  boardSchema,
  orchestratorConfigSchema,
  orchestratorSchema,
  groupOrderSchema,
  groupsSchema,
  groupSchema,
  nightSettingsSchema,
  packageGateSchema,
  packageRunSchema,
  packageStatusSchema,
  poolsSchema,
  providerModelSchema, // CUSTOM(bulk-orchestrator-agent)
  projectAccentSchema, // CUSTOM(project-icon-colors)
  projectIconDataSchema, // CUSTOM(project-icon-colors)
  settingsSchema,
  stageSchema,
  startSchema,
  taskTimingSchema,
  testTierSchema, // CUSTOM(packages)
} from "./model";
import { factoryIdSchema, pipelineFileSchema } from "./factory/schema"; // CUSTOM(factory)
import { autonomyPresetIdSchema } from "./autonomy"; // CUSTOM(factory)

// CUSTOM(factory): shadow mode's full report (docs/factory.md, "Loading and revisions").
export const factoryStatusRpc = defineRpc({
  name: "workboard.factory.status",
  input: z.object({}),
  output: factoryStatusSchema,
});
export const snapshotRpc = defineRpc({
  name: "workboard.snapshot",
  input: z.object({}),
  output: boardSchema,
});
// CUSTOM(factory): the Pipelines tab's source: the loaded factory in active mode, otherwise the
// built-in pipelines with each project's from its review policy.
const factoryPipelinesViewSchema = z.object({
  source: z.enum(["builtin", "factory"]),
  pipelines: z.record(z.string(), pipelineFileSchema),
  projects: z.record(z.string(), z.string()),
  defaultPipeline: z.string(),
  /** Active mode (ticket 14): pm/worker.md's own preset, for the "Inherit" labels. */
  pmAutonomy: autonomyPresetIdSchema.nullable().optional(),
  /** Active mode: each board project's own preset (projects/<id>.yaml), by Paseo project id. */
  projectAutonomy: z.record(z.string(), autonomyPresetIdSchema).optional(),
  /** Active mode: factory worker id → name, for a stage's pinned `worker`. */
  workers: z.record(z.string(), z.string()).optional(),
});
export type FactoryPipelinesView = z.infer<typeof factoryPipelinesViewSchema>;
export const factoryPipelinesRpc = defineRpc({
  name: "workboard.factory.pipelines.get",
  input: z.object({}),
  output: factoryPipelinesViewSchema,
});
// CUSTOM(factory): the pipeline editor's Save (ticket 14). `base` is the pipeline the editor
// loaded; the write refuses when the file changed since. `renames`: base stage id → new id.
export const factoryPipelineSaveRpc = defineRpc({
  name: "workboard.factory.pipelines.save",
  input: z.object({
    id: z.string(),
    base: pipelineFileSchema,
    pipeline: pipelineFileSchema,
    renames: z.record(z.string(), factoryIdSchema),
  }),
  output: factoryPipelinesViewSchema,
});
// CUSTOM(factory): the autonomy comboboxes of the pipeline editor (ticket 14). null ("Inherit")
// removes the key. `id`: the pipeline's id, or the board project's (Paseo) id.
export const factoryAutonomySetRpc = defineRpc({
  name: "workboard.factory.autonomy.set",
  input: z.object({
    target: z.enum(["pipeline", "project"]),
    id: z.string(),
    autonomy: autonomyPresetIdSchema.nullable(),
  }),
  output: factoryPipelinesViewSchema,
});
// CUSTOM(project-icon-colors): the accent the assistant pages paint a project's name with.
export const projectAccentsRpc = defineRpc({
  name: "workboard.project-accents",
  input: z.object({}),
  output: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        accent: projectAccentSchema.nullable(),
      }),
    ),
  }),
});
// CUSTOM(project-icon-colors): the image the app shows for each board project. Fetched apart
// from the snapshot so a 1.5 s poll never carries base64 icons.
export const projectIconsRpc = defineRpc({
  name: "workboard.project-icons",
  input: z.object({}),
  output: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        revision: z.string(),
        icon: projectIconDataSchema.nullable(),
      }),
    ),
  }),
});
// CUSTOM(workboard-chip-status): three counts for the Desk header chip.
export const deskStatusRpc = defineRpc({
  name: "workboard.desk-status",
  input: z.object({}),
  output: deskStatusSchema,
});
// CUSTOM(redeploy-button): runs custom/bin/build-paseo-if-needed-and-kill-daemons.sh.
export const redeployPaseoRpc = defineRpc({
  name: "workboard.redeploy-paseo",
  input: z.object({}),
  output: z.object({ ok: z.boolean(), output: z.string() }),
});
export const CANCEL_BINDING_BUSY_ERROR_CODE = "cancel-binding-busy";
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(1000),
    description: z.string().max(50000).default(""),
    projectId: z.string().nullable().default(null),
    orchestratorId: z.string().nullable().optional(),
    stage: stageSchema.optional(),
    // CUSTOM(night-tasks): a timing puts the new task in Scheduled.
    timing: taskTimingSchema.nullable().optional(),
  }),
  z.object({
    action: z.literal("edit"),
    taskId: z.string(),
    updatedAt: z.string(),
    title: z.string().trim().min(1).max(1000),
    description: z.string().max(50000),
    projectId: z.string().nullable(),
    orchestratorId: z.string().nullable().optional(),
    // CUSTOM(night-tasks): drafts only; setting one moves the task to Scheduled, null moves it out.
    timing: taskTimingSchema.nullable().optional(),
  }),
  z.object({ action: z.literal("start"), ...startSchema.shape }),
  z.object({
    action: z.literal("stage"),
    taskId: z.string(),
    stage: stageSchema,
    expectedLabels: z.array(z.string()),
    expectedUpdatedAt: z.string().optional(),
    expectedGroup: groupSchema
      .pick({ id: true, kind: true, label: true })
      .optional(),
  }),
  z.object({
    action: z.literal("reorder-cards"),
    taskId: z.string(),
    stage: stageSchema,
    expectedOrder: z.array(z.string()),
    cardOrder: z.array(z.string()),
  }),
  z.object({
    action: z.literal("reset-card-order"),
    stage: stageSchema,
    expectedOrder: z.array(z.string()),
  }),
  z.object({ action: z.literal("archive-draft"), taskId: z.string() }),
  z.object({
    action: z.literal("detach-draft"),
    taskId: z.string(),
    draftId: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    action: z.literal("cancel-binding"),
    taskId: z.string(),
    operationId: z.string(),
  }),
  z.object({
    action: z.literal("resolve-archive"),
    taskId: z.string(),
    operationId: z.string(),
    updatedAt: z.string(),
    outcome: z.enum(["confirm", "restore"]),
  }),
  z.object({
    action: z.literal("reorder-groups"),
    expectedGroupOrder: groupOrderSchema,
    groupOrder: groupOrderSchema,
  }),
  z.object({ action: z.literal("refine"), taskId: z.string() }),
  // A Ready to review card: accept it, or send it back to Ready to start with feedback.
  z.object({
    action: z.literal("review"),
    taskId: z.string(),
    outcome: z.enum(["done", "continue"]),
    feedback: z.string().max(50000).default(""),
  }),
  z.object({
    action: z.literal("orchestrator-defaults"),
    orchestrator: orchestratorSchema.partial(),
  }),
  z.object({
    action: z.literal("orchestrator-save"),
    // No id creates a new orchestrator.
    orchestrator: orchestratorConfigSchema.extend({
      id: z.string().min(1).optional(),
    }),
  }),
  // CUSTOM(bulk-orchestrator-agent): provider/model, mode and thinking for several at once.
  z.object({
    action: z.literal("orchestrators-set-agent"),
    ids: z.array(z.string()).min(1),
    provider: providerModelSchema,
    modeId: z.string().trim().min(1).nullable(),
    thinkingOptionId: z.string().trim().min(1).nullable(),
    // CUSTOM(unattended-automation): the Permissions select of OpenCode-like providers.
    autoAccept: z.boolean().optional(),
  }),
  z.object({ action: z.literal("orchestrator-delete"), id: z.string() }),
  // CUSTOM(resource-pools): the list order decides which orchestrator is a project's first.
  z.object({
    action: z.literal("orchestrator-move"),
    id: z.string(),
    direction: z.enum(["up", "down"]),
  }),
  // CUSTOM(resource-pools): replace the pool list; orchestrators of a removed pool leave it.
  z.object({ action: z.literal("pools-save"), pools: poolsSchema }),
  // A Done task's work: commit it, write a PR description, or merge it into the project.
  z.object({
    action: z.literal("finish"),
    taskId: z.string(),
    step: z.enum(FINISH_STEPS),
  }),
  z.object({ action: z.literal("orchestrator-run"), id: z.string() }),
  z.object({ action: z.literal("orchestrator-stop"), id: z.string() }),
  z.object({
    action: z.literal("orchestrator-enable"),
    id: z.string(),
    enabled: z.boolean(),
  }),
  // CUSTOM(night-tasks): the night window and power-off, and canceling a power-off countdown.
  z.object({ action: z.literal("night-settings"), night: nightSettingsSchema }),
  z.object({ action: z.literal("night-shutdown-cancel") }),
  // CUSTOM(packages): a package is created with a name; everything else has a default. Creating
  // and assigning in one mutation makes the toast's Undo a single step.
  z.object({
    action: z.literal("package-create"),
    name: z.string().trim().min(1).max(80),
    projectId: z.string().min(1),
    taskIds: z.array(z.string()).max(200).default([]),
  }),
  z.object({
    action: z.literal("package-assign"),
    packageId: z.string().min(1),
    taskIds: z.array(z.string()).min(1).max(200),
  }),
  z.object({
    action: z.literal("package-remove"),
    taskIds: z.array(z.string()).min(1).max(200),
  }),
  z.object({ action: z.literal("package-delete"), packageId: z.string() }),
  z.object({
    action: z.literal("package-update"),
    packageId: z.string(),
    name: z.string().trim().min(1).max(80).optional(),
    color: z.enum(GROUP_COLORS).optional(),
    status: packageStatusSchema.optional(),
    branch: z.string().trim().max(200).nullable().optional(),
    gate: packageGateSchema.nullable().optional(),
    trigger: z
      .object({
        night: z.boolean(),
        onClose: z.boolean(),
        everyMerges: z.number().int().min(1).max(100).nullable(),
      })
      .optional(),
    tierPolicy: z.object({ escalateOnRisk: z.boolean() }).optional(),
  }),
  z.object({
    action: z.literal("package-close"),
    packageId: z.string(),
    runGate: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("package-run-gate"),
    packageId: z.string(),
  }),
  z.object({
    action: z.literal("set-test-tier"),
    taskId: z.string(),
    tier: testTierSchema,
    reason: z.string().max(2000).default(""),
  }),
  z.object({
    action: z.literal("settings"),
    revision: z.number(),
    expectedSettings: settingsSchema
      .extend({ groups: groupsSchema })
      .strict()
      .optional(),
    settings: settingsSchema.extend({ groups: groupsSchema }).strict(),
  }),
]);
export type Mutation = z.infer<typeof mutationSchema>;
export const mutateRpc = defineRpc({
  name: "workboard.mutate",
  input: mutationSchema,
  output: boardSchema,
});
// CUSTOM(packages): the gate history of one package, read by its detail page. The board snapshot
// only carries the last run, so the 1.5 s poll does not grow.
export const packageRunsRpc = defineRpc({
  name: "workboard.package.runs",
  input: z.object({ packageId: z.string().min(1) }),
  output: z.object({ runs: z.array(packageRunSchema) }),
});

// CUSTOM(workboard-images): save a pasted image on the daemon host, and read one back to show it.
export const saveImageRpc = defineRpc({
  name: "workboard.image.save",
  input: z.object({
    mimeType: z.string(),
    // Base64 of at most IMAGE_MAX_BYTES (10 MiB) is just under 14M characters.
    base64: z.string().min(1).max(14_000_000),
  }),
  output: z.object({ path: z.string() }),
});
export const readImageRpc = defineRpc({
  name: "workboard.image.read",
  input: z.object({ path: z.string() }),
  output: z.object({ dataUri: z.string() }),
});

// CUSTOM(task-description-files): the snapshot has no descriptions; the ticket panel, the editor
// and the board search read them here. A task that no longer exists is left out.
export const taskDescriptionsRpc = defineRpc({
  name: "workboard.task-descriptions",
  input: z.object({ taskIds: z.array(z.string()).max(10000) }),
  output: z.object({
    descriptions: z.array(
      z.object({ taskId: z.string(), revision: z.number(), text: z.string() }),
    ),
  }),
});

export const writeTicketRpc = defineRpc({
  name: "workboard.refinement.write-ticket",
  input: z.object({
    agentId: z.string(),
    focus: z.string().max(5000).default(""),
  }),
  output: z.object({ ok: z.literal(true) }),
});
