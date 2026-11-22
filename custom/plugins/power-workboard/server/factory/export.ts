// CUSTOM(factory): `bin/factory export`, the migration of docs/factory.md: writes a factory from the
// board's data (`workboard-data.json`), the profile folders and Paseo's projects, adds the built-in
// pipelines and role prompts, validates the result and commits it in a new git repository. It
// writes to the target folder only; the live data is read, never changed.
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYamlText, stringify } from "yaml";
import { z } from "zod";
import {
  compileFactory,
  type CompiledFactory,
} from "../../shared/factory/compile";
import { builtinPipelineFor } from "../../shared/factory/builtin-pipelines";
import { splitFrontmatter } from "../../shared/factory/frontmatter";
import {
  FACTORY_SCHEMA_VERSION,
  factoryIdSchema,
  skillFrontmatterSchema,
  type FactoryIssue,
  type FactorySchedule,
} from "../../shared/factory/schema";
import { migrateData } from "../../shared/migrations";
import {
  DATA_SCHEMA_VERSION,
  dataSchema,
  DEFAULT_LABELS,
  orderedGroups,
  type Data,
  type OrchestratorConfig,
} from "../../shared/model";
import { projectTestsSchema } from "../../shared/assistant";
import { ASSISTANT_PROFILE, type SkillSelection } from "../../shared/profiles";
import { AUTOMATIC_SCHEDULE, type Schedule } from "../../shared/schedule";
import { readBuiltinFactoryFiles } from "./builtin";
import { writeFactoryJsonSchemas } from "./json-schema";
import { loadFactory } from "./loader";

const run = promisify(execFile);

/** One entry of `~/.paseo/projects/projects.json`. */
export const paseoProjectSchema = z.looseObject({
  projectId: z.string().min(1),
  rootPath: z.string().min(1),
  displayName: z.string().nullable().optional(),
  customName: z.string().nullable().optional(),
});
export type PaseoProject = z.infer<typeof paseoProjectSchema>;

export type ExportOptions = {
  /** The board's data, parsed (see `readWorkboardData`). */
  data: Data;
  /** Paseo's projects, for the checkout path of each project id. */
  projects: PaseoProject[];
  /** `<PASEO_HOME>/plugin-data/power-workboard/profiles`. */
  profilesRoot: string;
  /** The factory folder to create; it must be missing or empty. */
  target: string;
  /** Written as `~/` in project paths; defaults to the user's home. */
  homeDir?: string;
  /** `name:` of factory.yaml. */
  name?: string;
};

/** Old id → factory id. Workers are keyed by orchestrator UUID, projects by Paseo project id. */
export type FactoryIdMap = {
  workers: Record<string, string>;
  projects: Record<string, string>;
  pools: Record<string, string>;
};

export type ExportResult = {
  root: string;
  ids: FactoryIdMap;
  /** Data the factory cannot hold, or that was left out. */
  warnings: string[];
  /** Problems of the written factory (load and compile); any of them skips the commit. */
  errors: FactoryIssue[];
  compiled: CompiledFactory | null;
  /** The commit, or null when the factory is invalid. */
  commit: string | null;
};

export const IDS_FILE = ".factory-ids.json";

/** Reads `workboard-data.json` as the plugin stores it (`{version, values}`), migrating old data. */
export async function readWorkboardData(file: string): Promise<Data> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const stored = z
    .object({ version: z.number().int(), values: z.unknown() })
    .safeParse(raw);
  if (!stored.success) return dataSchema.parse(raw);
  const { version, values } = stored.data;
  if (version > DATA_SCHEMA_VERSION)
    throw new Error(
      `${file} is version ${version}; this plugin reads up to ${DATA_SCHEMA_VERSION}`,
    );
  return dataSchema.parse(
    version < DATA_SCHEMA_VERSION ? migrateData(values, version) : values,
  );
}

/** Reads `projects.json`; entries it cannot read are left out. */
export async function readPaseoProjects(file: string): Promise<PaseoProject[]> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const parsed = paseoProjectSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A factory id from a display name: lowercase ASCII, digits and dashes. */
export function slugOf(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 72)
    .replace(/-+$/, "");
  return factoryIdSchema.safeParse(slug).success ? slug : fallback;
}

/** Hands out slugs, adding `-2`, `-3`... to repeats. */
export function slugger() {
  const taken = new Set<string>();
  return (value: string, fallback: string) => {
    const base = slugOf(value, fallback);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  };
}

const permissionOf = (modeId: string | null) => modeId ?? "full";

function scheduleOf(schedule: Schedule): FactorySchedule {
  if (schedule.kind === "manual") return "manual";
  const allDays = (days: number[]) =>
    days.length === 7 && days.every((day, index) => day === index);
  if (
    schedule.kind === "window" &&
    JSON.stringify(schedule) === JSON.stringify(AUTOMATIC_SCHEDULE)
  )
    return "automatic";
  const days = allDays(schedule.days) ? {} : { days: schedule.days };
  return schedule.kind === "window"
    ? { window: { ...days, start: schedule.start, end: schedule.end } }
    : { daily: { ...days, times: schedule.times } };
}

const skillsOf = (skills: SkillSelection) =>
  skills.mode === "all" ? "all" : skills.names;

const yamlText = (value: unknown) => stringify(value, { lineWidth: 0 });

const markdown = (front: Record<string, unknown>, body: string) =>
  `---\n${yamlText(front)}---\n${body.trim() ? `\n${body.trim()}\n` : ""}`;

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function list(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function git(root: string, ...args: string[]) {
  const { stdout } = await run("git", args, { cwd: root });
  return stdout.trim();
}

export async function exportFactory(
  options: ExportOptions,
): Promise<ExportResult> {
  const { data } = options;
  const root = path.resolve(options.target);
  const home = options.homeDir ?? homedir();
  if (!(await isEmptyOrMissing(root)))
    throw new Error(`${root} is not empty; export writes a new factory only`);

  const warnings: string[] = [];
  const ids: FactoryIdMap = { workers: {}, projects: {}, pools: {} };
  const files = new Map<string, string>();
  /** Profile skill folders to copy: factory path → source folder. */
  const skillCopies = new Map<string, string>();

  const paseoProjects = new Map(
    options.projects.map((project) => [project.projectId, project]),
  );
  const settings = data.assistant.settings;

  // Pools.
  const poolSlug = slugger();
  for (const pool of data.settings.pools)
    ids.pools[pool.id] = factoryIdSchema.safeParse(pool.id).success
      ? poolSlug(pool.id, "pool")
      : poolSlug(pool.name, "pool");

  // Projects: the ones a worker, a delivery policy or a review policy names.
  const projectSlug = slugger();
  const wanted = new Set<string>();
  for (const orchestrator of data.orchestrators)
    if (orchestrator.projectId) wanted.add(orchestrator.projectId);
  for (const id of Object.keys(settings.projects)) wanted.add(id);
  for (const [id, review] of Object.entries(settings.reviews))
    if (review === "fresh-agent") wanted.add(id);
  for (const projectId of wanted) {
    const project = paseoProjects.get(projectId);
    if (!project) {
      warnings.push(
        `Project ${projectId} is not a Paseo project; its policy and workers are left out`,
      );
      continue;
    }
    const name =
      project.customName ||
      project.displayName ||
      path.basename(project.rootPath);
    ids.projects[projectId] = projectSlug(name, "project");
  }

  // Workers, in priority order. More than 100 would not fit the priority range in steps of 10.
  const workerSlug = slugger();
  const step = data.orchestrators.length > 100 ? 1 : 10;
  const exported: OrchestratorConfig[] = [];
  for (const orchestrator of data.orchestrators) {
    if (orchestrator.projectId && !ids.projects[orchestrator.projectId]) {
      warnings.push(
        `Orchestrator "${orchestrator.name}" (${orchestrator.id}) is left out: its project ${orchestrator.projectId} is not a Paseo project`,
      );
      continue;
    }
    const id = workerSlug(orchestrator.name, "worker");
    ids.workers[orchestrator.id] = id;
    const priority = exported.length * step;
    exported.push(orchestrator);
    const profile = path.join(options.profilesRoot, orchestrator.id);
    const front = {
      name: orchestrator.name,
      role: "implement",
      project: orchestrator.projectId
        ? ids.projects[orchestrator.projectId]
        : null,
      priority,
      enabled: orchestrator.enabled,
      model: orchestrator.provider,
      thinking: orchestrator.thinkingOptionId,
      permission: permissionOf(orchestrator.modeId),
      autoAccept: orchestrator.autoAccept,
      workspace: orchestrator.useWorktree ? "worktree" : "folder",
      maxConcurrent: orchestrator.maxConcurrent,
      batchSize: orchestrator.batchSize,
      maxCheckpoints: orchestrator.maxCheckpoints,
      pool: orchestrator.poolId
        ? (ids.pools[orchestrator.poolId] ?? orchestrator.poolId)
        : null,
      schedule: scheduleOf(orchestrator.schedule),
      skills: skillsOf(orchestrator.skills),
      memory: orchestrator.memory,
    };
    files.set(
      `workers/${id}/worker.md`,
      markdown(front, await readText(path.join(profile, "system-prompt.md"))),
    );
    if (orchestrator.instructions.trim())
      files.set(
        `workers/${id}/task-prompt.md`,
        `${orchestrator.instructions.trim()}\n`,
      );
    await collectSkills(
      path.join(profile, "skills"),
      `workers/${id}/skills`,
      skillCopies,
      warnings,
    );
  }

  for (const [projectId, id] of Object.entries(ids.projects)) {
    const project = paseoProjects.get(projectId)!;
    const policy = settings.projects[projectId];
    const front: Record<string, unknown> = {
      path: homePath(project.rootPath, home),
    };
    const pipelineId = builtinPipelineFor(
      settings.reviews[projectId] ?? "self",
    );
    if (pipelineId !== "default") front.pipeline = pipelineId;
    if (policy) {
      front.delivery = {
        action: policy.action,
        observe: policy.observe,
        baseBranch: policy.baseBranch,
        verifyCommand: policy.verifyCommand,
        autoFixes: policy.autoFixes,
      };
      const tests = policy.tests;
      const defaults = projectTestsSchema.parse({});
      const gate = {
        command: tests.gateCommand,
        setup: tests.gateSetupCommand,
        requiredEnv: tests.gateRequiredEnv,
        env: tests.gateEnv,
        runIn: tests.gateRunIn,
        riskPaths: tests.gateRiskPaths,
      };
      // The rest of the gate matches today's defaults; the compiler fills it in again.
      if (JSON.stringify(tests) !== JSON.stringify(defaults))
        front.tests = { gate };
    }
    files.set(
      `projects/${id}.yaml`,
      `# yaml-language-server: $schema=../.schema/project.json\n${yamlText(front)}`,
    );
  }

  // factory.yaml: `data.orchestrator` is what new workers start from.
  const defaults = data.orchestrator;
  if (defaults.instructions.trim())
    warnings.push(
      "The default task prompt of new orchestrators has no place in the factory; it is left out",
    );
  files.set(
    "factory.yaml",
    `# yaml-language-server: $schema=.schema/factory.json\n${yamlText({
      schemaVersion: FACTORY_SCHEMA_VERSION,
      name: options.name ?? "workboard",
      description: "Exported from workboard-data.json by bin/factory export",
      defaults: {
        worker: {
          model: defaults.provider,
          thinking: defaults.thinkingOptionId,
          permission: permissionOf(defaults.modeId),
          autoAccept: defaults.autoAccept,
          workspace: defaults.useWorktree ? "worktree" : "folder",
        },
        delivery: { action: settings.defaultAction },
        pipeline: "default",
      },
    })}`,
  );

  // board.yaml.
  const labeled = new Set<string>();
  const columns = orderedGroups(data.settings).map((group) => {
    const automatic = labeled.has(group.kind)
      ? `pwb:${group.id}`
      : DEFAULT_LABELS[group.kind];
    labeled.add(group.kind);
    return {
      id: group.id,
      kind: group.kind,
      ...(group.name ? { name: group.name } : {}),
      ...(group.label !== automatic ? { label: group.label } : {}),
      ...(group.color ? { color: group.color } : {}),
    };
  });
  const preferences = data.settings;
  for (const key of [
    "defaultDraftGroup",
    "defaultStartGroup",
    "defaultStartWorkGroup",
  ] as const)
    if (preferences[key])
      warnings.push(
        `settings.${key} (${preferences[key]}) stays in workboard-data.json; the factory has no place for it`,
      );
  files.set(
    "board.yaml",
    `# yaml-language-server: $schema=.schema/board.json\n${yamlText({
      columns,
      pools: preferences.pools.map((pool) => ({
        ...pool,
        id: ids.pools[pool.id],
      })),
      night: data.night,
      housekeeping: {
        autoArchive: preferences.autoArchive,
        archiveAfterDays: preferences.archiveAfterDays,
        pinInProgressWorkspaces: preferences.pinInProgressWorkspaces,
        tmpCleanup: preferences.tmpCleanup,
      },
    })}`,
  );

  // pm/worker.md.
  const chat = settings.chat;
  const pmProfile = path.join(options.profilesRoot, ASSISTANT_PROFILE);
  files.set(
    "pm/worker.md",
    markdown(
      {
        role: "foreman",
        enabled: settings.enabled,
        model: chat.provider,
        thinking: chat.thinkingOptionId,
        permission: permissionOf(chat.modeId),
        autoAccept: chat.autoAccept,
        skills: skillsOf(chat.skills),
        memory: chat.memory,
        wake: {
          onNeedsYou: chat.wakeOnNeedsYou,
          delaySeconds: chat.wakeDelaySeconds,
        },
        compactAtTokens: chat.compactAtTokens,
        interactivePermission: permissionOf(defaults.refineModeId),
      },
      await readText(path.join(pmProfile, "system-prompt.md")),
    ),
  );
  await collectSkills(
    path.join(pmProfile, "skills"),
    "pm/skills",
    skillCopies,
    warnings,
  );

  // Pipelines, role prompts, the spec template, README.md and .gitignore.
  for (const [file, text] of Object.entries(await readBuiltinFactoryFiles()))
    files.set(file, text);
  files.set(IDS_FILE, `${JSON.stringify(ids, null, 2)}\n`);

  await mkdir(root, { recursive: true });
  for (const [file, text] of files) {
    const full = path.join(root, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  for (const [file, source] of skillCopies)
    await cp(source, path.join(root, file), { recursive: true });
  await writeFactoryJsonSchemas(root);

  // Validate what was written, against the exported projects only: two Paseo projects may share a
  // checkout (one path a symlink to the other), and the one the data names must win.
  const byPath = new Map<string, string>();
  for (const projectId of Object.keys(ids.projects)) {
    try {
      const project = paseoProjects.get(projectId)!;
      byPath.set(await realpath(project.rootPath), projectId);
    } catch {
      // A checkout that is gone; the loader warns about it.
    }
  }
  const loaded = await loadFactory(root, { homeDir: home });
  const errors = [...loaded.errors];
  for (const warning of loaded.warnings) warnings.push(formatIssue(warning));
  let compiled: CompiledFactory | null = null;
  if (loaded.factory) {
    const result = compileFactory(loaded.factory, {
      projectIdForPath: (realPath) => byPath.get(realPath) ?? null,
    });
    errors.push(...result.errors);
    for (const warning of result.warnings) warnings.push(formatIssue(warning));
    compiled = result.compiled;
  }
  if (errors.length)
    return { root, ids, warnings, errors, compiled, commit: null };

  await git(root, "init", "-q", "-b", "main");
  await git(root, "add", "-A");
  const identity = (await git(root, "config", "user.email").catch(() => ""))
    ? []
    : [
        "-c",
        "user.name=Power Workboard",
        "-c",
        "user.email=power-workboard@localhost",
      ];
  await git(
    root,
    ...identity,
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-q",
    "--no-verify",
    "-m",
    "export: factory from workboard-data.json",
  );
  const commit = await git(root, "rev-parse", "HEAD");
  return { root, ids, warnings, errors, compiled, commit };
}

export const formatIssue = (issue: FactoryIssue) =>
  `${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.message} [${issue.kind}]`;

/** `~/...` for a path under the home folder. */
function homePath(value: string, home: string): string {
  const relative = path.relative(home, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~/${relative.split(path.sep).join("/")}`
    : value;
}

/** Queues each profile skill folder whose SKILL.md the factory accepts; warns about the rest. */
async function collectSkills(
  source: string,
  target: string,
  copies: Map<string, string>,
  warnings: string[],
) {
  for (const entry of await list(source)) {
    if (entry.name.startsWith(".")) continue;
    const folder = path.join(source, entry.name);
    const front = entry.isDirectory()
      ? splitFrontmatter(await readText(path.join(folder, "SKILL.md")))
      : null;
    let valid = false;
    if (front) {
      try {
        valid = skillFrontmatterSchema.safeParse(
          parseYamlText(front.yaml),
        ).success;
      } catch {
        valid = false;
      }
    }
    if (valid) copies.set(`${target}/${entry.name}`, folder);
    else
      warnings.push(
        `${folder} is left out: a skill is a folder with a SKILL.md that has a name and a description`,
      );
  }
}
