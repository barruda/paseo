// CUSTOM(factory): `bin/factory export` and the round trip export → load → compile
// (docs/factory.md, ticket 4). Everything lives in temp folders; ~/.paseo is never read.
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readBuiltinFactoryFiles } from "../server/factory/builtin";
import { runFactoryCli } from "../server/factory/cli";
import {
  exportFactory,
  IDS_FILE,
  slugOf,
  type PaseoProject,
} from "../server/factory/export";
import type { SkillSelection } from "../shared/profiles";
import {
  DATA_SCHEMA_VERSION,
  dataSchema,
  DEFAULT_GROUPS,
  orderedGroups,
  type Data,
} from "../shared/model";
import { AUTOMATIC_SCHEDULE } from "../shared/schedule";

const run = promisify(execFile);
const temp = async (prefix: string) =>
  realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));

async function write(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const UUID = {
  default: "485ef775-b7ab-4052-9210-16af1a8cb2ac",
  paseo: "8ad18f84-2755-4ec6-9f86-814de4c455d3",
  dream: "0cf3a764-f10d-4611-bca1-fc5aa94bbe0d",
  paseo2: "f91d7924-41ae-4949-8eef-76b2d0e22e86",
  gone: "11111111-2222-3333-4444-555555555555",
};

/** A board shaped like the live one, plus every case the export maps. */
async function fixture() {
  const home = await temp("pwb-export-home-");
  const paseo = path.join(home, "projetos", "paseo");
  await mkdir(paseo, { recursive: true });
  const dream = await temp("pwb-export-dream-");
  const alias = path.join(home, "dream-link");
  await symlink(dream, alias);
  const projects: PaseoProject[] = [
    { projectId: "prj_paseo", rootPath: paseo, displayName: "paseo" },
    {
      projectId: "prj_dream",
      rootPath: dream,
      displayName: "DreamMMO",
      customName: null,
    },
    // Not referenced by anything: no projects/*.yaml.
    { projectId: "prj_other", rootPath: home, displayName: "other" },
    // Same checkout as prj_dream through a symlink; the data names prj_dream, so it wins.
    { projectId: "prj_alias", rootPath: alias, displayName: "DreamMMO" },
  ];
  const data = dataSchema.parse({
    orchestrator: {
      provider: "claude/claude-opus-5-5",
      modeId: "bypassPermissions",
      thinkingOptionId: "medium",
      useWorktree: true,
      refineModeId: "default",
    },
    orchestrators: [
      {
        id: UUID.default,
        name: "Default",
        projectId: null,
        enabled: false,
        schedule: AUTOMATIC_SCHEDULE,
        modeId: "bypassPermissions",
      },
      {
        id: UUID.paseo,
        name: "Paseo",
        projectId: "prj_paseo",
        schedule: AUTOMATIC_SCHEDULE,
        thinkingOptionId: "high",
        instructions: "## Projeto paseo\n\nRead CLAUDE.md first.\n",
        skills: { mode: "selected", names: ["paseo", "paseo-customizations"] },
        poolId: "Unity Pool",
        maxCheckpoints: 3,
      },
      {
        id: UUID.dream,
        name: "Dream MMO!",
        projectId: "prj_dream",
        schedule: {
          kind: "window",
          days: [1, 2, 3, 4, 5],
          start: "09:00",
          end: "18:00",
        },
        provider: "codex/gpt-5.4",
        thinkingOptionId: null,
        useWorktree: false,
        autoAccept: false,
        maxConcurrent: 1,
        batchSize: 3,
        memory: false,
        // Names kept while the mode is "all" mean nothing; the factory drops them.
        skills: { mode: "all", names: ["stale"] },
      },
      {
        id: UUID.paseo2,
        name: "paseo",
        projectId: "prj_paseo",
        schedule: {
          kind: "daily",
          days: [0, 1, 2, 3, 4, 5, 6],
          times: ["08:00", "20:30"],
        },
        modeId: "acceptEdits",
      },
      { id: UUID.gone, name: "Gone", projectId: "prj_gone" },
    ],
    settings: {
      archiveAfterDays: 3,
      autoArchive: false,
      pinInProgressWorkspaces: false,
      groups: [
        ...DEFAULT_GROUPS.map((group) =>
          group.id === "review"
            ? { ...group, label: "pwb:custom-review" }
            : group,
        ),
        { id: "icebox", name: "Icebox", kind: "todo", label: "pwb:icebox" },
      ],
      groupOrder: ["scheduled", "backlog", "icebox", "ready"],
      pools: [
        {
          id: "Unity Pool",
          name: "Unity Editor",
          maxConcurrent: 1,
          minFreeRamPercent: 20,
        },
        { id: "ram", name: "RAM", maxConcurrent: 3, minFreeRamPercent: null },
      ],
      tmpCleanup: { path: "/srv/tmp", maxAgeHours: 12 },
    },
    night: {
      start: "23:00",
      end: "07:30",
      shutdownWhenDone: true,
      shutdownCommand: "systemctl suspend",
    },
    assistant: {
      settings: {
        enabled: true,
        defaultAction: "notify",
        projects: {
          prj_paseo: {
            action: "review",
            baseBranch: "custom",
            verifyCommand: "npm run typecheck",
            tests: { gateCommand: "npm test", gateEnv: { CI: "1" } },
          },
          prj_dream: { action: "prepare-pr", observe: true, autoFixes: 2 },
          prj_gone: { action: "merge" },
        },
        reviews: { prj_dream: "fresh-agent", prj_paseo: "self" },
        chat: {
          provider: "claude/claude-opus-5-5",
          thinkingOptionId: "high",
          modeId: null,
          skills: { mode: "selected", names: ["paseo"] },
          wakeOnNeedsYou: false,
          wakeDelaySeconds: 20,
          compactAtTokens: 0,
        },
      },
    },
  });

  const profiles = await temp("pwb-export-profiles-");
  await write(
    path.join(profiles, UUID.paseo, "system-prompt.md"),
    "You are the paseo worker.\n\nFollow `CLAUDE.md`.\n",
  );
  await write(
    path.join(profiles, UUID.paseo, "skills", "ship", "SKILL.md"),
    "---\nname: ship\ndescription: Ship the change\n---\n\nSteps.\n",
  );
  await write(
    path.join(profiles, UUID.paseo, "skills", "ship", "scripts", "go.sh"),
    "echo go\n",
  );
  await write(
    path.join(profiles, UUID.paseo, "skills", "broken", "SKILL.md"),
    "no frontmatter\n",
  );
  await write(
    path.join(profiles, UUID.paseo, "memory", "MEMORY.md"),
    "- a memory\n",
  );
  await write(
    path.join(profiles, "assistant", "system-prompt.md"),
    "You are the Project Manager.\n",
  );
  await write(
    path.join(profiles, "assistant", "skills", "triage", "SKILL.md"),
    "---\nname: triage\ndescription: Sort the inbox\n---\n",
  );
  return { home, paseo, dream, projects, data, profiles };
}

const normalSkills = (skills: SkillSelection): SkillSelection =>
  skills.mode === "all" ? { mode: "all", names: [] } : skills;

/** The config of the live data with factory ids, in the shape the compiler returns. */
function expectedConfig(data: Data, workers: Record<string, string>) {
  const pools: Record<string, string> = {
    "Unity Pool": "unity-editor",
    ram: "ram",
  };
  return {
    orchestrators: data.orchestrators
      .filter((orchestrator) => workers[orchestrator.id])
      .map((orchestrator) => ({
        ...orchestrator,
        id: workers[orchestrator.id],
        instructions: orchestrator.instructions.trim(),
        skills: normalSkills(orchestrator.skills),
        poolId: orchestrator.poolId ? pools[orchestrator.poolId] : null,
      })),
    orchestrator: data.orchestrator,
    groups: orderedGroups(data.settings),
    settings: {
      autoArchive: data.settings.autoArchive,
      archiveAfterDays: data.settings.archiveAfterDays,
      pinInProgressWorkspaces: data.settings.pinInProgressWorkspaces,
      tmpCleanup: data.settings.tmpCleanup,
      pools: data.settings.pools.map((pool) => ({
        ...pool,
        id: pools[pool.id],
      })),
    },
    night: data.night,
    assistant: {
      enabled: data.assistant.settings.enabled,
      defaultAction: data.assistant.settings.defaultAction,
      projects: {
        prj_paseo: data.assistant.settings.projects.prj_paseo,
        prj_dream: data.assistant.settings.projects.prj_dream,
      },
      chat: {
        ...data.assistant.settings.chat,
        skills: normalSkills(data.assistant.settings.chat.skills),
      },
    },
  };
}

describe("slugOf", () => {
  it("turns names into factory ids", () => {
    expect(slugOf("Dream MMO!", "worker")).toBe("dream-mmo");
    expect(slugOf("Ação Única", "worker")).toBe("acao-unica");
    expect(slugOf("!!!", "worker")).toBe("worker");
  });
});

describe("exportFactory", () => {
  it("round trip: export → load → compile gives the source config, ids aside", async () => {
    const source = await fixture();
    const target = path.join(await temp("pwb-export-target-"), "factory");
    const result = await exportFactory({
      data: source.data,
      projects: source.projects,
      profilesRoot: source.profiles,
      target,
      homeDir: source.home,
    });
    expect(result.errors).toEqual([]);
    expect(result.ids).toEqual({
      workers: {
        [UUID.default]: "default",
        [UUID.paseo]: "paseo",
        [UUID.dream]: "dream-mmo",
        [UUID.paseo2]: "paseo-2",
      },
      projects: { prj_paseo: "paseo", prj_dream: "dreammmo" },
      pools: { "Unity Pool": "unity-editor", ram: "ram" },
    });
    const compiled = result.compiled!;
    const expected = expectedConfig(source.data, result.ids.workers);
    expect(compiled.orchestrators).toEqual(expected.orchestrators);
    expect(compiled.orchestrator).toEqual(expected.orchestrator);
    expect(orderedGroups(compiled.settings)).toEqual(expected.groups);
    expect({
      autoArchive: compiled.settings.autoArchive,
      archiveAfterDays: compiled.settings.archiveAfterDays,
      pinInProgressWorkspaces: compiled.settings.pinInProgressWorkspaces,
      tmpCleanup: compiled.settings.tmpCleanup,
      pools: compiled.settings.pools,
    }).toEqual(expected.settings);
    expect(compiled.night).toEqual(expected.night);
    expect(compiled.assistant).toEqual(expected.assistant);

    // Review policy → pipeline; profiles → prompts and own skills.
    expect(
      Object.fromEntries(
        compiled.projects.map((p) => [p.projectId, p.pipeline]),
      ),
    ).toEqual({ prj_paseo: "default", prj_dream: "critical" });
    const paseo = compiled.workers.find((worker) => worker.id === "paseo")!;
    expect(paseo.systemPrompt).toBe(
      "You are the paseo worker.\n\nFollow `CLAUDE.md`.",
    );
    expect(paseo.ownSkills).toEqual(["ship"]);
    expect(paseo.role).toBe("implement");
    expect(compiled.workers.find((w) => w.id === "default")!.systemPrompt).toBe(
      "",
    );
    expect(compiled.pm).toEqual({
      systemPrompt: "You are the Project Manager.",
      ownSkills: ["triage"],
    });
  });

  it("writes the layout, keeps memory out and warns about what it leaves out", async () => {
    const source = await fixture();
    const target = path.join(await temp("pwb-export-target-"), "factory");
    const result = await exportFactory({
      data: source.data,
      projects: source.projects,
      profilesRoot: source.profiles,
      target,
      homeDir: source.home,
    });
    const read = (file: string) => readFile(path.join(target, file), "utf8");
    expect(await read("projects/paseo.yaml")).toContain(
      "path: ~/projetos/paseo",
    );
    expect(await read("projects/dreammmo.yaml")).toContain(
      "pipeline: critical",
    );
    expect(await read("workers/paseo/task-prompt.md")).toBe(
      "## Projeto paseo\n\nRead CLAUDE.md first.\n",
    );
    expect(await read("workers/paseo/skills/ship/scripts/go.sh")).toBe(
      "echo go\n",
    );
    await expect(read("workers/paseo/memory/MEMORY.md")).rejects.toThrow();
    await expect(read("workers/default/task-prompt.md")).rejects.toThrow();
    for (const file of [
      "pipelines/default.yaml",
      "pipelines/critical.yaml",
      "roles/triage.md",
      "roles/spec.md",
      "roles/implement.md",
      "roles/verify.md",
      "roles/review.md",
      ".schema/factory.json",
    ])
      expect((await read(file)).length).toBeGreaterThan(0);
    // The built-in files (ticket 6) are copied as they are.
    for (const [file, text] of Object.entries(await readBuiltinFactoryFiles()))
      expect(await read(file)).toBe(text);
    expect(JSON.parse(await read(IDS_FILE))).toEqual(result.ids);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Project prj_gone is not a Paseo project"),
        expect.stringContaining(`"Gone" (${UUID.gone}) is left out`),
        expect.stringMatching(/skills\/broken is left out/),
      ]),
    );
  });

  it("commits everything but memory and the id map in a new git repository", async () => {
    const source = await fixture();
    const target = path.join(await temp("pwb-export-target-"), "factory");
    const result = await exportFactory({
      data: source.data,
      projects: source.projects,
      profilesRoot: source.profiles,
      target,
      homeDir: source.home,
    });
    const git = async (...args: string[]) =>
      (await run("git", args, { cwd: target })).stdout.trim();
    expect(result.commit).toBe(await git("rev-parse", "HEAD"));
    expect(await git("rev-list", "--count", "HEAD")).toBe("1");
    expect(await git("status", "--porcelain", "--ignored")).toBe(
      `!! ${IDS_FILE}`,
    );
    const tracked = (await git("ls-files")).split("\n");
    expect(tracked).toContain("factory.yaml");
    expect(tracked).toContain("workers/paseo/skills/ship/SKILL.md");
    expect(tracked).not.toContain(IDS_FILE);
  });

  it("refuses a target that is not empty", async () => {
    const source = await fixture();
    const target = await temp("pwb-export-target-");
    await writeFile(path.join(target, "keep.txt"), "mine");
    await expect(
      exportFactory({
        data: source.data,
        projects: source.projects,
        profilesRoot: source.profiles,
        target,
        homeDir: source.home,
      }),
    ).rejects.toThrow(/not empty/);
    expect(await readFile(path.join(target, "keep.txt"), "utf8")).toBe("mine");
  });

  it("does not commit a factory that fails validation", async () => {
    const source = await fixture();
    source.data.orchestrators[1]!.provider = "no-slash";
    const target = path.join(await temp("pwb-export-target-"), "factory");
    const result = await exportFactory({
      data: source.data,
      projects: source.projects,
      profilesRoot: source.profiles,
      target,
      homeDir: source.home,
    });
    expect(result.commit).toBeNull();
    expect(result.errors.map((issue) => issue.file)).toContain(
      "workers/paseo/worker.md",
    );
  });
});

describe("bin/factory export", () => {
  it("reads the stored board, exports, and the result validates", async () => {
    const source = await fixture();
    const inputs = await temp("pwb-export-inputs-");
    const dataFile = path.join(inputs, "workboard-data.json");
    const projectsFile = path.join(inputs, "projects.json");
    await writeFile(
      dataFile,
      JSON.stringify({ version: DATA_SCHEMA_VERSION, values: source.data }),
    );
    await writeFile(projectsFile, JSON.stringify(source.projects));
    const target = path.join(await temp("pwb-export-target-"), "factory");
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      env: { PASEO_HOME: path.join(inputs, "no-such-home") },
      cwd: inputs,
    };
    const code = await runFactoryCli(
      [
        "export",
        target,
        "--data",
        dataFile,
        "--profiles",
        source.profiles,
        "--projects",
        "projects.json",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(out).toContain(`worker ${UUID.paseo} -> paseo`);
    expect(out.at(-1)).toMatch(/exported 4 workers and 2 projects/);
    expect(err.every((line) => line.startsWith("warning: "))).toBe(true);

    out.length = 0;
    expect(await runFactoryCli(["validate", target], io)).toBe(0);
    expect(out.at(-1)).toMatch(/valid \(4 workers, 2 projects\)/);

    // A second export to the same folder refuses and says why.
    err.length = 0;
    const again = await runFactoryCli(
      ["export", target, "--data", dataFile, "--projects", projectsFile],
      io,
    );
    expect(again).toBe(1);
    expect(err).toEqual([expect.stringMatching(/^error: .* is not empty/)]);
  });

  it.each([
    [["export", "dir", "--nope"]],
    [["export"]],
    [["export", "--data", "x.json"]],
  ])("rejects %j before reading or writing anything", async (args) => {
    const err: string[] = [];
    const code = await runFactoryCli(args, {
      out: () => undefined,
      err: (line) => err.push(line),
      // No PASEO_HOME: a default would point at the live ~/.paseo.
      env: {},
      cwd: os.tmpdir(),
    });
    expect(code).toBe(2);
    expect(err[0]).toMatch(/^usage:/);
  });
});
