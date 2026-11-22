// CUSTOM(factory): schema, loader, compiler, JSON Schema and `bin/factory` (docs/factory.md, ticket 2).
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantChatSettingsSchema,
  projectPolicySchema,
} from "../shared/assistant";
import { compileFactory } from "../shared/factory/compile";
import { splitFrontmatter } from "../shared/factory/frontmatter";
import type { FactoryIssue } from "../shared/factory/schema";
import {
  DEFAULT_GROUPS,
  nightSettingsSchema,
  orchestratorConfigSchema,
  orchestratorSchema,
  settingsSchema,
} from "../shared/model";
import { AUTOMATIC_SCHEDULE } from "../shared/schedule";
import { runFactoryCli } from "../server/factory/cli";
import { factoryJsonSchemas } from "../server/factory/json-schema";
import { loadFactory } from "../server/factory/loader";
import {
  MINIMAL_FACTORY,
  VALID_FACTORY,
  writeFactory,
  type FactoryFiles,
} from "./factory-fixtures";

const checkouts = async () => ({
  PASEO: await realpath(await mkdtemp(path.join(os.tmpdir(), "pwb-paseo-"))),
  DREAM: await realpath(await mkdtemp(path.join(os.tmpdir(), "pwb-dream-"))),
});
const projectIds = (vars: Record<string, string>) => {
  const ids = new Map([
    [vars.PASEO, "prj_paseo"],
    [vars.DREAM, "prj_dream"],
  ]);
  return (realPath: string) => ids.get(realPath) ?? null;
};

async function loadValid(overrides: FactoryFiles = {}) {
  const vars = await checkouts();
  const root = await writeFactory({ ...VALID_FACTORY, ...overrides }, vars);
  return { vars, root, loaded: await loadFactory(root) };
}

/** Loads a factory that must fail; returns its errors as `kind file:line message`. */
async function errorsOf(
  files: FactoryFiles,
  vars: Record<string, string> = {},
) {
  const loaded = await loadFactory(await writeFactory(files, vars));
  expect(loaded.factory).toBeNull();
  return loaded.errors;
}
const brief = (issue: FactoryIssue) =>
  `${issue.kind} ${issue.file}${issue.line ? `:${issue.line}` : ""}`;

describe("splitFrontmatter", () => {
  it("splits the YAML from the body", () => {
    expect(splitFrontmatter("---\na: 1\n---\n\nBody\n")).toEqual({
      yaml: "a: 1",
      yamlLine: 2,
      body: "\nBody\n",
    });
    expect(splitFrontmatter("﻿---\r\n---\r\nx")?.body).toBe("x");
  });
  it("is null without an opening or a closing fence", () => {
    expect(splitFrontmatter("Body")).toBeNull();
    expect(splitFrontmatter("---\na: 1\n")).toBeNull();
  });
});

describe("loadFactory and compileFactory", () => {
  it("loads the docs' example factory with no issues", async () => {
    const { loaded, root } = await loadValid();
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings).toEqual([]);
    const factory = loaded.factory!;
    expect(factory.root).toBe(root);
    expect(factory.workers.map((worker) => worker.id)).toEqual([
      "dreammmo",
      "general",
      "paseo",
    ]);
    expect(factory.pm.systemPrompt).toBe("Project Manager system prompt.");
    expect(factory.pm.skills.map((skill) => skill.name)).toEqual([
      "board-tips",
    ]);
    expect(factory.skills.map((skill) => skill.name)).toEqual(["shared-skill"]);
  });

  it("compiles to today's structures, each a fixed point of its schema", async () => {
    const { loaded, vars } = await loadValid();
    const result = compileFactory(loaded.factory!, {
      projectIdForPath: projectIds(vars),
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const compiled = result.compiled!;
    for (const config of compiled.orchestrators)
      expect(orchestratorConfigSchema.parse(config)).toEqual(config);
    expect(orchestratorSchema.parse(compiled.orchestrator)).toEqual(
      compiled.orchestrator,
    );
    expect(settingsSchema.parse(compiled.settings)).toEqual(compiled.settings);
    expect(nightSettingsSchema.parse(compiled.night)).toEqual(compiled.night);
    expect(assistantChatSettingsSchema.parse(compiled.assistant.chat)).toEqual(
      compiled.assistant.chat,
    );
    for (const policy of Object.values(compiled.assistant.projects))
      expect(projectPolicySchema.parse(policy)).toEqual(policy);
  });

  it("maps workers to orchestrators in priority order, inheriting defaults.worker", async () => {
    const { loaded, vars } = await loadValid();
    const { compiled } = compileFactory(loaded.factory!, {
      projectIdForPath: projectIds(vars),
    });
    const [dream, paseo, general] = compiled!.orchestrators;
    expect(compiled!.orchestrators.map((config) => config.id)).toEqual([
      "dreammmo",
      "paseo",
      "general",
    ]);
    expect(paseo).toEqual({
      id: "paseo",
      name: "Paseo",
      projectId: "prj_paseo",
      enabled: true,
      schedule: AUTOMATIC_SCHEDULE,
      maxConcurrent: 2,
      batchSize: 5,
      provider: "claude/claude-opus-5-5",
      modeId: null,
      autoAccept: true,
      thinkingOptionId: "high",
      useWorktree: true,
      instructions: "## Projeto paseo\n\nRead CLAUDE.md first.",
      skills: { mode: "selected", names: ["paseo-customizations", "paseo"] },
      memory: true,
      poolId: null,
      maxCheckpoints: 5,
    });
    expect(dream).toMatchObject({
      name: "dreammmo",
      projectId: "prj_dream",
      modeId: "bypassPermissions",
      useWorktree: false,
      poolId: "unity",
      thinkingOptionId: "medium",
      skills: { mode: "all", names: [] },
      schedule: {
        kind: "window",
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
      },
    });
    expect(general).toMatchObject({
      projectId: null,
      enabled: false,
      thinkingOptionId: null,
      schedule: {
        kind: "daily",
        days: [0, 1, 2, 3, 4, 5, 6],
        times: ["08:00"],
      },
    });
    const worker = compiled!.workers.find((entry) => entry.id === "paseo")!;
    expect(worker).toMatchObject({
      role: "implement",
      description: "Implements paseo tickets on the custom branch",
      systemPrompt: "You implement paseo tickets.",
      ownSkills: ["paseo-notes"],
    });
  });

  it("maps board.yaml, projects and the Project Manager", async () => {
    const { loaded, vars } = await loadValid();
    const { compiled } = compileFactory(loaded.factory!, {
      projectIdForPath: projectIds(vars),
    });
    const { settings, night, assistant, orchestrator } = compiled!;
    expect(settings.groups.map((group) => group.label)).toEqual(
      DEFAULT_GROUPS.map((group) => group.label),
    );
    expect(settings.groups[1]).toEqual({
      id: "scheduled",
      kind: "scheduled",
      name: null,
      label: "pwb:scheduled",
      color: "teal",
    });
    expect(settings.groupOrder).toEqual([
      "backlog",
      "scheduled",
      "ready",
      "in-progress",
      "review",
      "done",
    ]);
    expect(settings.pools).toEqual([
      {
        id: "unity",
        name: "Unity Editor",
        maxConcurrent: 1,
        minFreeRamPercent: 20,
      },
    ]);
    expect(night).toEqual({
      start: "22:00",
      end: "06:00",
      shutdownWhenDone: false,
      shutdownCommand: "",
    });
    expect(assistant.enabled).toBe(true);
    expect(assistant.defaultAction).toBe("review");
    // dreammmo has no delivery or tests block: it follows the default, as a project with no policy.
    expect(Object.keys(assistant.projects)).toEqual(["prj_paseo"]);
    expect(assistant.projects.prj_paseo).toEqual({
      action: "review",
      observe: false,
      verifyCommand: "npm run typecheck && npm run lint",
      autoFixes: 1,
      baseBranch: "custom",
      tests: {
        gateCommand: "npm test",
        gateSetupCommand: "npm ci",
        gateRequiredEnv: ["DB_URL"],
        gateEnv: { CI: "1" },
        gateRunIn: "worktree",
        gateRiskPaths: ["**/migrations/**", "**/protocol/**"],
      },
    });
    expect(assistant.chat).toEqual({
      ...assistantChatSettingsSchema.parse({}),
      thinkingOptionId: "high",
      wakeDelaySeconds: 12,
    });
    expect(orchestrator).toEqual({
      ...orchestratorSchema.parse({}),
      refineModeId: "default",
    });
    expect(compiled!.projects).toEqual([
      {
        id: "dreammmo",
        realPath: vars.DREAM,
        projectId: "prj_dream",
        pipeline: "default",
        specTemplate: null,
      },
      {
        id: "paseo",
        realPath: vars.PASEO,
        projectId: "prj_paseo",
        pipeline: "default",
        specTemplate: "templates/spec.md",
      },
    ]);
  });

  it("compiles a factory with only factory.yaml to today's defaults", async () => {
    const loaded = await loadFactory(await writeFactory(MINIMAL_FACTORY));
    expect(loaded.errors).toEqual([]);
    const { compiled, errors } = compileFactory(loaded.factory!, {
      projectIdForPath: () => null,
    });
    expect(errors).toEqual([]);
    expect(compiled!.orchestrators).toEqual([]);
    expect(compiled!.settings).toEqual({
      ...settingsSchema.parse({}),
      groupOrder: DEFAULT_GROUPS.map((group) => group.id),
    });
    expect(compiled!.night).toEqual(nightSettingsSchema.parse({}));
    expect(compiled!.orchestrator).toEqual(orchestratorSchema.parse({}));
    expect(compiled!.assistant).toEqual({
      enabled: true,
      defaultAction: "review",
      projects: {},
      chat: assistantChatSettingsSchema.parse({}),
    });
  });

  it("labels a second column of the same kind by its id", async () => {
    const root = await writeFactory({
      ...MINIMAL_FACTORY,
      "board.yaml":
        "columns:\n  - { id: backlog, kind: todo }\n  - { id: ideas, kind: todo }\n",
    });
    const loaded = await loadFactory(root);
    const { compiled } = compileFactory(loaded.factory!, {
      projectIdForPath: () => null,
    });
    expect(compiled!.settings.groups.map((group) => group.label)).toEqual([
      "pwb:backlog",
      "pwb:ideas",
    ]);
  });
});

describe("inactive projects", () => {
  it("warns about a path that does not exist and turns its worker off", async () => {
    const vars = { ...(await checkouts()), DREAM: "/nonexistent/dream" };
    const loaded = await loadFactory(await writeFactory(VALID_FACTORY, vars));
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings.map(brief)).toEqual([
      "inactive-project projects/dreammmo.yaml:1",
    ]);
    const result = compileFactory(loaded.factory!, {
      projectIdForPath: projectIds(vars),
    });
    expect(result.warnings.map(brief)).toEqual([
      "inactive-project workers/dreammmo/worker.md",
    ]);
    expect(result.compiled!.orchestrators.map((config) => config.id)).toEqual([
      "paseo",
      "general",
    ]);
  });

  it("warns about a checkout Paseo has no project for", async () => {
    const { loaded, vars } = await loadValid();
    const result = compileFactory(loaded.factory!, {
      projectIdForPath: (realPath) =>
        realPath === vars.PASEO ? "prj_paseo" : null,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map(brief)).toEqual([
      "inactive-project projects/dreammmo.yaml",
      "inactive-project workers/dreammmo/worker.md",
    ]);
  });
});

describe("factory errors", () => {
  it("missing-file: no factory.yaml, a worker without worker.md, a skill without SKILL.md", async () => {
    expect(
      (await errorsOf({ "board.yaml": "pools: []\n" })).map(brief),
    ).toEqual(["missing-file factory.yaml"]);
    const errors = await errorsOf({
      ...MINIMAL_FACTORY,
      "workers/empty/task-prompt.md": "x",
      "skills/broken/notes.md": "x",
    });
    expect(errors.map(brief)).toEqual([
      "missing-file workers/empty/worker.md",
      "missing-file skills/broken/SKILL.md",
    ]);
  });

  it("parse: invalid YAML and a worker.md without frontmatter, with lines", async () => {
    const errors = await errorsOf({
      ...MINIMAL_FACTORY,
      "board.yaml": "pools:\n  - id: a\n   name: b\n",
      "workers/a/worker.md": "Just a prompt\n",
      "workers/b/worker.md": "---\nproject: [x\n---\n",
    });
    expect(errors.map(brief)).toEqual([
      "parse board.yaml:3",
      "parse workers/a/worker.md:1",
      "parse workers/b/worker.md:2",
    ]);
  });

  it("schema: unknown keys and bad values point at their line", async () => {
    const errors = await errorsOf({
      "factory.yaml":
        "schemaVersion: pwb/v1alpha1\nname: x\ndefaults:\n  worker:\n    modle: claude/x\n",
      "workers/a/worker.md":
        "---\ndescription: ok\nmaxConcurrent: 99\nschedule: sometimes\n---\nPrompt\n",
      "projects/p.yaml": "pth: /tmp\n",
      "board.yaml":
        "columns:\n  - { id: a, kind: ready }\n  - { id: a, kind: done }\n",
      "workers/b/worker.md": "---\n---\n",
      "workers/b/task-prompt.md": "x".repeat(20_001),
    });
    expect(errors.map((issue) => `${brief(issue)} ${issue.message}`)).toEqual([
      'schema factory.yaml:5 defaults.worker: Unrecognized key: "modle"',
      expect.stringMatching(/^schema board\.yaml:3 columns\.1\.id: Duplicate/),
      expect.stringMatching(/^schema board\.yaml:1 columns: Keep at least one/),
      expect.stringMatching(/^schema workers\/a\/worker\.md:3 maxConcurrent:/),
      expect.stringMatching(/^schema workers\/a\/worker\.md:4 schedule:/),
      expect.stringMatching(/^schema workers\/b\/task-prompt\.md Longer/),
      expect.stringMatching(/^schema projects\/p\.yaml:1 path:/),
      expect.stringMatching(
        /^schema projects\/p\.yaml:1 Unrecognized key: "pth"/,
      ),
    ]);
  });

  it("schema: a wrong schemaVersion", async () => {
    const errors = await errorsOf({
      "factory.yaml": "schemaVersion: pwb/v2\nname: x\n",
    });
    expect(errors.map(brief)).toEqual(["schema factory.yaml:1"]);
  });

  it("invalid-id: worker and project names must be slugs", async () => {
    const errors = await errorsOf({
      ...MINIMAL_FACTORY,
      "workers/Bad_Name/worker.md": "---\n---\n",
      "projects/My Project.yaml": "path: /tmp\n",
    });
    expect(errors.map(brief)).toEqual([
      "invalid-id workers/Bad_Name",
      "invalid-id projects/My Project.yaml",
    ]);
  });

  it("unknown-file: entries outside the layout", async () => {
    const errors = await errorsOf({
      ...MINIMAL_FACTORY,
      "notes.txt": "x",
      "worker/x/worker.md": "---\n---\n",
      "workers/a/worker.md": "---\n---\n",
      "workers/a/extra.md": "x",
      "workers/loose.md": "x",
      "projects/p.yml": "path: /tmp\n",
      "pipelines/default.json": "{}",
      "roles/implement.txt": "x",
      "pm/prompt.md": "x",
      "skills/loose.md": "x",
      ".hidden/anything": "ignored",
      "workers/a/.DS_Store": "ignored",
    });
    expect(errors.map(brief).sort()).toEqual(
      [
        "unknown-file notes.txt",
        "unknown-file worker",
        "unknown-file pm/prompt.md",
        "unknown-file workers/a/extra.md",
        "unknown-file workers/loose.md",
        "unknown-file projects/p.yml",
        "unknown-file pipelines/default.json",
        "unknown-file roles/implement.txt",
        "unknown-file skills/loose.md",
      ].sort(),
    );
  });

  it('unsupported: scorers/ and automations/ are "not supported yet"', async () => {
    const errors = await errorsOf({
      ...MINIMAL_FACTORY,
      "scorers/a.yaml": "x: 1\n",
      "automations/b.yaml": "x: 1\n",
    });
    expect(errors.map((issue) => `${brief(issue)} ${issue.message}`)).toEqual([
      "unsupported automations automations/ is not supported yet",
      "unsupported scorers scorers/ is not supported yet",
    ]);
  });

  it("reference: unknown project, unknown pool, shared checkout, missing template", async () => {
    const vars = await checkouts();
    const errors = await errorsOf(
      {
        "factory.yaml":
          "schemaVersion: pwb/v1alpha1\nname: x\ndefaults:\n  worker:\n    pool: gpu\n",
        "board.yaml": "pools:\n  - { id: unity, name: Unity }\n",
        "workers/a/worker.md": "---\nproject: nope\npool: ram\n---\n",
        "projects/one.yaml": "path: {{PASEO}}\n",
        "projects/two.yaml":
          "path: {{PASEO}}\ntemplates:\n  spec: templates/missing.md\n",
      },
      vars,
    );
    expect(errors.map((issue) => `${brief(issue)} ${issue.message}`)).toEqual([
      "reference workers/a/worker.md:2 project: no projects/nope.yaml",
      'reference workers/a/worker.md:3 pool: no pool "ram" in board.yaml',
      'reference factory.yaml:5 defaults.worker.pool: no pool "gpu" in board.yaml',
      "reference projects/two.yaml:1 path: same checkout as projects/one.yaml",
      "reference projects/two.yaml:3 templates.spec: no file templates/missing.md in the factory",
    ]);
  });

  it("missing-file: the root is not a directory", async () => {
    const loaded = await loadFactory("/nonexistent/factory");
    expect(loaded.errors.map(brief)).toEqual(["missing-file ."]);
  });
});

describe("JSON Schema", () => {
  it("generates a strict schema per file", () => {
    const schemas = factoryJsonSchemas() as Record<
      string,
      { type: string; additionalProperties: boolean; required?: string[] }
    >;
    expect(Object.keys(schemas)).toEqual([
      "factory.json",
      "board.json",
      "project.json",
      "worker.json",
      "pm.json",
      "pipeline.json",
    ]);
    for (const schema of Object.values(schemas)) {
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
    }
    expect(schemas["factory.json"].required).toEqual(["schemaVersion", "name"]);
  });
});

describe("bin/factory", () => {
  const run = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runFactoryCli(args, {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      env: {},
      cwd: "/",
    });
    return { code, out, err };
  };

  it("validate exits 0 on a valid factory", async () => {
    const { root } = await loadValid();
    const result = await run(["validate", root]);
    expect(result).toEqual({
      code: 0,
      out: [`${root}: valid (3 workers, 2 projects)`],
      err: [],
    });
  });

  it("validate prints file:line errors and exits 1", async () => {
    const root = await writeFactory({
      "factory.yaml": "schemaVersion: pwb/v1alpha1\nname: x\ncolor: red\n",
      "scorers/a.yaml": "x: 1\n",
    });
    const result = await run(["validate", root]);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "error: scorers: scorers/ is not supported yet [unsupported]",
      'error: factory.yaml:3: Unrecognized key: "color" [schema]',
      `${root}: 2 error(s)`,
    ]);
  });

  it("schema writes .schema/*.json", async () => {
    const root = await writeFactory(MINIMAL_FACTORY);
    const result = await run(["schema", root]);
    expect(result.code).toBe(0);
    expect(result.out.map((file) => path.basename(file))).toEqual([
      "factory.json",
      "board.json",
      "project.json",
      "worker.json",
      "pm.json",
      "pipeline.json",
    ]);
    const factory = JSON.parse(
      await readFile(path.join(root, ".schema", "factory.json"), "utf8"),
    );
    expect(factory.properties.schemaVersion.const).toBe("pwb/v1alpha1");
    expect((await loadFactory(root)).errors).toEqual([]);
  });

  it("rejects an unknown command", async () => {
    expect((await run(["frobnicate"])).code).toBe(2);
  });
});
