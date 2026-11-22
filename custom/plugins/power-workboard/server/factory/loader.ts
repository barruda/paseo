// CUSTOM(factory): reads a factory directory (docs/factory.md, "Layout") into a typed factory, with
// every problem as an issue that names the file and line. Any error leaves `factory` null: the
// board keeps its last valid config.
import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { z } from "zod";
import { splitFrontmatter } from "../../shared/factory/frontmatter";
import {
  DEFAULT_WORKER_ROLE,
  projectWorkers,
  stageRunner,
} from "../../shared/factory/pipeline";
import {
  boardFileSchema,
  factoryFileSchema,
  factoryIdSchema,
  pipelineFileSchema,
  pmFrontmatterSchema,
  projectFileSchema,
  skillFrontmatterSchema,
  STAGE_ROLES,
  TASK_PROMPT_LIMIT,
  workerFrontmatterSchema,
  type BoardFile,
  type FactoryIssue,
  type FactorySkill,
  type LoadedFactory,
  type PmFrontmatter,
  type StageRole,
} from "../../shared/factory/schema";
import { parseYaml, validate, type YamlSource } from "./yaml-source";

export type LoadResult = {
  factory: LoadedFactory | null;
  errors: FactoryIssue[];
  warnings: FactoryIssue[];
};

export type LoadOptions = {
  /** Expands `~/` in project paths; defaults to the user's home. */
  homeDir?: string;
};

const ROOT_ENTRIES = new Set([
  "factory.yaml",
  "board.yaml",
  "pm",
  "workers",
  "projects",
  "pipelines",
  "roles",
  "skills",
  "templates",
  "README.md",
]);
const UNSUPPORTED = new Set(["scorers", "automations"]);
const WORKER_ENTRIES = new Set([
  "worker.md",
  "task-prompt.md",
  "skills",
  "memory",
]);
const PM_ENTRIES = new Set(["worker.md", "skills", "memory"]);

const hidden = (name: string) => name.startsWith(".");

export async function loadFactory(
  root: string,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const errors: FactoryIssue[] = [];
  const warnings: FactoryIssue[] = [];
  const issue = (
    kind: FactoryIssue["kind"],
    file: string,
    message: string,
    line: number | null = null,
  ) => errors.push({ kind, file, line, message });

  const list = async (dir: string): Promise<Dirent[] | null> => {
    try {
      return (
        await readdir(path.join(root, dir), { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return null;
    }
  };
  const read = async (file: string) => {
    try {
      return await readFile(path.join(root, file), "utf8");
    } catch {
      return null;
    }
  };

  async function yamlFile<T>(file: string, schema: z.ZodType<T>) {
    const text = await read(file);
    if (text === null) return null;
    const parsed = parseYaml(text, file);
    errors.push(...parsed.errors);
    if (parsed.errors.length) return null;
    const result = validate(schema, parsed.value, file, parsed.source);
    errors.push(...result.errors);
    return result.data === null
      ? null
      : { data: result.data, source: parsed.source };
  }

  async function markdownFile<T>(file: string, schema: z.ZodType<T>) {
    const text = await read(file);
    if (text === null) return null;
    const front = splitFrontmatter(text);
    if (!front) {
      issue("parse", file, "Needs YAML frontmatter between --- lines", 1);
      return null;
    }
    const parsed = parseYaml(front.yaml, file, front.yamlLine);
    errors.push(...parsed.errors);
    if (parsed.errors.length) return null;
    const result = validate(schema, parsed.value, file, parsed.source);
    errors.push(...result.errors);
    return result.data === null
      ? null
      : { data: result.data, body: front.body.trim(), source: parsed.source };
  }

  async function readSkills(dir: string): Promise<FactorySkill[]> {
    const skills: FactorySkill[] = [];
    for (const entry of (await list(dir)) ?? []) {
      if (hidden(entry.name)) continue;
      const folder = `${dir}/${entry.name}`;
      if (!entry.isDirectory()) {
        issue("unknown-file", folder, "Skills are folders with a SKILL.md");
        continue;
      }
      const file = `${folder}/SKILL.md`;
      const skill = await markdownFile(file, skillFrontmatterSchema);
      if (skill)
        skills.push({
          name: skill.data.name,
          description: skill.data.description,
          file,
        });
      else if ((await read(file)) === null)
        issue("missing-file", file, "A skill folder needs a SKILL.md");
    }
    return skills;
  }

  /** Flags entries of `dir` that `allowed` rejects; returns the entries. */
  async function checkEntries(
    dir: string,
    allowed: (entry: Dirent) => boolean,
    hint: string,
  ) {
    const entries = (await list(dir)) ?? [];
    for (const entry of entries)
      if (!hidden(entry.name) && !allowed(entry))
        issue("unknown-file", `${dir}/${entry.name}`, hint);
    return entries.filter((entry) => !hidden(entry.name) && allowed(entry));
  }

  const validId = (id: string, file: string) => {
    const result = factoryIdSchema.safeParse(id);
    if (!result.success)
      issue("invalid-id", file, `"${id}": ${result.error.issues[0].message}`);
    return result.success;
  };

  try {
    if (!(await stat(root)).isDirectory()) throw new Error();
  } catch {
    issue("missing-file", ".", `${root} is not a directory`);
    return { factory: null, errors, warnings };
  }

  for (const entry of (await list("")) ?? []) {
    if (hidden(entry.name) || ROOT_ENTRIES.has(entry.name)) continue;
    if (UNSUPPORTED.has(entry.name))
      issue("unsupported", entry.name, `${entry.name}/ is not supported yet`);
    else
      issue(
        "unknown-file",
        entry.name,
        "Not part of a factory (see docs/factory.md, Layout)",
      );
  }

  const factoryFile = await yamlFile("factory.yaml", factoryFileSchema);
  if (!factoryFile && (await read("factory.yaml")) === null)
    issue("missing-file", "factory.yaml", "A factory needs a factory.yaml");
  const boardFile =
    (await read("board.yaml")) === null
      ? { data: {} as BoardFile, source: null }
      : await yamlFile("board.yaml", boardFileSchema);

  await checkEntries(
    "pm",
    (entry) => PM_ENTRIES.has(entry.name),
    "pm/ holds worker.md, skills/ and memory/",
  );
  const pmFile =
    (await read("pm/worker.md")) === null
      ? { data: {} as PmFrontmatter, body: "", source: null }
      : await markdownFile("pm/worker.md", pmFrontmatterSchema);
  const pmSkills = await readSkills("pm/skills");

  const workers: LoadedFactory["workers"] = [];
  const workerSources = new Map<string, YamlSource>();
  for (const entry of await checkEntries(
    "workers",
    (entry) => entry.isDirectory(),
    "workers/ holds one folder per worker",
  )) {
    const dir = `workers/${entry.name}`;
    if (!validId(entry.name, dir)) continue;
    await checkEntries(
      dir,
      (child) => WORKER_ENTRIES.has(child.name),
      "A worker folder holds worker.md, task-prompt.md, skills/ and memory/",
    );
    const file = `${dir}/worker.md`;
    if ((await read(file)) === null) {
      issue("missing-file", file, "A worker folder needs a worker.md");
      continue;
    }
    const worker = await markdownFile(file, workerFrontmatterSchema);
    const taskPrompt = ((await read(`${dir}/task-prompt.md`)) ?? "").trim();
    if (taskPrompt.length > TASK_PROMPT_LIMIT)
      issue(
        "schema",
        `${dir}/task-prompt.md`,
        `Longer than ${TASK_PROMPT_LIMIT} characters`,
      );
    const skills = await readSkills(`${dir}/skills`);
    if (!worker) continue;
    workerSources.set(entry.name, worker.source);
    workers.push({
      id: entry.name,
      file,
      settings: worker.data,
      systemPrompt: worker.body,
      taskPrompt,
      skills,
    });
  }

  const projects: LoadedFactory["projects"] = [];
  const projectSources = new Map<string, YamlSource>();
  for (const entry of await checkEntries(
    "projects",
    (entry) => entry.isFile() && entry.name.endsWith(".yaml"),
    "projects/ holds one <id>.yaml per project",
  )) {
    const file = `projects/${entry.name}`;
    const id = entry.name.slice(0, -".yaml".length);
    if (!validId(id, file)) continue;
    const project = await yamlFile(file, projectFileSchema);
    if (!project) continue;
    projectSources.set(id, project.source);
    projects.push({
      id,
      file,
      settings: project.data,
      realPath: await resolveCheckout(
        project.data.path,
        root,
        options.homeDir ?? homedir(),
      ),
    });
  }

  const pipelines: Array<
    Omit<LoadedFactory["pipelines"][number], "prompts"> & {
      source: YamlSource;
    }
  > = [];
  /** Every pipeline file with a valid id, so a broken one is not also reported as missing. */
  const pipelineIds = new Set<string>();
  for (const entry of await checkEntries(
    "pipelines",
    (entry) => entry.isFile() && entry.name.endsWith(".yaml"),
    "pipelines/ holds one <id>.yaml per pipeline",
  )) {
    const file = `pipelines/${entry.name}`;
    const id = entry.name.slice(0, -".yaml".length);
    if (!validId(id, file)) continue;
    pipelineIds.add(id);
    const pipeline = await yamlFile(file, pipelineFileSchema);
    if (pipeline)
      pipelines.push({
        id,
        file,
        pipeline: pipeline.data,
        source: pipeline.source,
      });
  }

  const roleNames = new Set<string>(STAGE_ROLES);
  const roles: LoadedFactory["roles"] = {};
  for (const entry of await checkEntries(
    "roles",
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      roleNames.has(entry.name.slice(0, -".md".length)),
    `roles/ holds one <role>.md per role (${STAGE_ROLES.join(", ")})`,
  )) {
    const role = entry.name.slice(0, -".md".length) as StageRole;
    roles[role] = ((await read(`roles/${entry.name}`)) ?? "").trim();
  }
  const skills = await readSkills("skills");

  // References.
  const projectIds = new Set(projects.map((project) => project.id));
  const workerIds = new Set(workers.map((worker) => worker.id));
  const poolIds = new Set((boardFile?.data.pools ?? []).map((pool) => pool.id));
  for (const worker of workers) {
    const source = workerSources.get(worker.id)!;
    const { project, pool } = worker.settings;
    if (project && !projectIds.has(project))
      issue(
        "reference",
        worker.file,
        `project: no projects/${project}.yaml`,
        source.lineOf(["project"]),
      );
    if (boardFile && pool && !poolIds.has(pool))
      issue(
        "reference",
        worker.file,
        `pool: no pool "${pool}" in board.yaml`,
        source.lineOf(["pool"]),
      );
  }
  const defaultPool = factoryFile?.data.defaults?.worker?.pool;
  if (boardFile && defaultPool && !poolIds.has(defaultPool))
    issue(
      "reference",
      "factory.yaml",
      `defaults.worker.pool: no pool "${defaultPool}" in board.yaml`,
      factoryFile!.source.lineOf(["defaults", "worker", "pool"]),
    );
  const byPath = new Map<string, string>();
  for (const project of projects) {
    const source = projectSources.get(project.id)!;
    if (project.realPath === null)
      warnings.push({
        kind: "inactive-project",
        file: project.file,
        line: source.lineOf(["path"]),
        message: `path: ${project.settings.path} does not exist; the project stays inactive`,
      });
    else if (byPath.has(project.realPath))
      issue(
        "reference",
        project.file,
        `path: same checkout as projects/${byPath.get(project.realPath)}.yaml`,
        source.lineOf(["path"]),
      );
    else byPath.set(project.realPath, project.id);
    const template = project.settings.templates?.spec;
    if (template && !(await isFileUnder(root, template)))
      issue(
        "reference",
        project.file,
        `templates.spec: no file ${template} in the factory`,
        source.lineOf(["templates", "spec"]),
      );
  }

  // Pipelines: stage workers and procedures, then the pipeline each project runs.
  const loadedPipelines: LoadedFactory["pipelines"] = [];
  for (const { id, file, pipeline, source } of pipelines) {
    const prompts: Record<string, string> = {};
    for (const [stageId, stage] of Object.entries(pipeline.stages)) {
      const line = (key?: string) =>
        source.lineOf(key ? ["stages", stageId, key] : ["stages", stageId]);
      if (stage.worker && !workerIds.has(stage.worker))
        issue(
          "reference",
          file,
          `stages.${stageId}.worker: no workers/${stage.worker}/worker.md`,
          line("worker"),
        );
      if (stage.prompt !== undefined) prompts[stageId] = stage.prompt;
      else if (stage.file !== undefined) {
        if (await isFileUnder(root, stage.file))
          prompts[stageId] = ((await read(stage.file)) ?? "").trim();
        else
          issue(
            "reference",
            file,
            `stages.${stageId}.file: no file ${stage.file} in the factory`,
            line("file"),
          );
      } else if (roles[stage.role] !== undefined)
        prompts[stageId] = roles[stage.role]!;
      else
        issue(
          "reference",
          file,
          `stages.${stageId}: no roles/${stage.role}.md; add it or set prompt or file`,
          line("role"),
        );
    }
    loadedPipelines.push({ id, file, pipeline, prompts });
  }
  const defaultPipeline = factoryFile?.data.defaults?.pipeline;
  if (defaultPipeline && !pipelineIds.has(defaultPipeline))
    issue(
      "reference",
      "factory.yaml",
      `defaults.pipeline: no pipelines/${defaultPipeline}.yaml`,
      factoryFile!.source.lineOf(["defaults", "pipeline"]),
    );
  // Same order as the compiled orchestrators, so the first match is the one that takes the task.
  const candidates = [...workers]
    .sort(
      (a, b) =>
        (a.settings.priority ?? 0) - (b.settings.priority ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((worker) => ({
      id: worker.id,
      project: worker.settings.project ?? null,
      role: worker.settings.role ?? DEFAULT_WORKER_ROLE,
    }));
  for (const project of projects) {
    const source = projectSources.get(project.id)!;
    const named = project.settings.pipeline;
    if (named && !pipelineIds.has(named)) {
      issue(
        "reference",
        project.file,
        `pipeline: no pipelines/${named}.yaml`,
        source.lineOf(["pipeline"]),
      );
      continue;
    }
    const pipeline = pipelines.find(
      (pipeline) => pipeline.id === (named ?? defaultPipeline),
    );
    const serving = projectWorkers(project.id, candidates);
    // A project no worker takes runs nothing, as today; there is no role to miss.
    if (!pipeline || serving.length === 0) continue;
    for (const [stageId, stage] of Object.entries(pipeline.pipeline.stages))
      if (!stageRunner(stage, serving))
        issue(
          "reference",
          project.file,
          `pipeline ${pipeline.id}, stage ${stageId}: no worker of this project has role ${stage.role === DEFAULT_WORKER_ROLE ? stage.role : `${stage.role} or ${DEFAULT_WORKER_ROLE}`} (set worker: on the stage, or add a worker)`,
          source.lineOf(named ? ["pipeline"] : ["path"]),
        );
  }

  if (errors.length || !factoryFile || !boardFile || !pmFile)
    return { factory: null, errors, warnings };
  return {
    factory: {
      root,
      factory: factoryFile.data,
      board: boardFile.data,
      pm: {
        settings: pmFile.data,
        systemPrompt: pmFile.body,
        skills: pmSkills,
      },
      workers,
      projects,
      pipelines: loadedPipelines,
      roles,
      skills,
    },
    errors,
    warnings,
  };
}

/** The checkout's real path, or null when it is not an existing folder. */
async function resolveCheckout(
  value: string,
  root: string,
  home: string,
): Promise<string | null> {
  const expanded =
    value === "~"
      ? home
      : value.startsWith("~/")
        ? path.join(home, value.slice(2))
        : path.resolve(root, value);
  try {
    const real = await realpath(expanded);
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

async function isFileUnder(root: string, file: string): Promise<boolean> {
  const full = path.resolve(root, file);
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  try {
    return (await stat(full)).isFile();
  } catch {
    return false;
  }
}
