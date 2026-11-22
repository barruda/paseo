// CUSTOM(factory): active mode (docs/factory.md, tickets 9 and 10). The board boots on a fixture
// factory, starts a task with the factory worker's settings and profile, keeps the JSON's own
// config on every write, and writes the user's config edits to the factory's files with a commit.
// Everything lives in temp folders.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACTORY_GITIGNORE } from "../server/factory/builtin";
import { runFactoryCli } from "../server/factory/cli";
import { copyProfileMemory } from "../server/factory/cutover";
import {
  FACTORY_CHANGED_ERROR,
  FactoryShadow,
  factoryStoreView,
} from "../server/factory/shadow";
import { compiledWorkerConfigHash } from "../server/factory/stamp";
import { Workboard } from "../server/workboard";
import {
  FactoryIds,
  applyFactory,
  missingFactoryIds,
  factoryPipelinesView,
  restoreJsonConfig,
} from "../shared/factory/active";
import { factoryPipelinesRpc } from "../shared/rpc";
import type { FactoryMode } from "../shared/factory/status";
import {
  dataSchema,
  orchestratorConfigSchema,
  type Data,
} from "../shared/model";
import { AUTOMATIC_SCHEDULE } from "../shared/schedule";
import { fixture } from "./fixtures";

const temp = async (prefix: string) =>
  realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));

async function write(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const LIVE_ID = "3f0c1a2b-0000-4000-8000-000000000001";

/** A factory with one worker (`night`, the live orchestrator LIVE_ID) for the project at `checkout`. */
async function writeFixtureFactory(checkout: string, git = true) {
  const root = path.join(await temp("pwb-active-"), "factory");
  const files: Record<string, string> = {
    "factory.yaml": `schemaVersion: pwb/v1alpha1
name: active-fixture
defaults:
  worker:
    model: claude/claude-opus-5-5
    thinking: medium
  delivery:
    action: notify
`,
    "board.yaml": `# The board's columns, pools and night.
night: { start: "23:00", end: "05:00", shutdownWhenDone: false, shutdownCommand: "" }
housekeeping:
  autoArchive: false # keep the cards
`,
    "pm/worker.md": `---
model: claude/claude-sonnet-5-5
thinking: high
---

You are the factory's Project Manager.
`,
    "workers/night/worker.md": `---
name: Night
project: proj
# The night shift runs on Sonnet.
model: claude/claude-sonnet-5-5
thinking: high # think harder at night
permission: plan
schedule: automatic
maxConcurrent: 1
skills: [review]
memory: true
---

Work at night, from the factory.
`,
    "workers/night/task-prompt.md": "Factory task prompt.\n",
    "workers/night/skills/notes/SKILL.md":
      "---\nname: notes\ndescription: Night notes\n---\nNotes.\n",
    "pipelines/simple.yaml": `start: implement
stages:
  implement:
    role: implement
    prompt: Implement it.
    to: deliver
`,
    "projects/proj.yaml": `# The fixture project.
path: ${checkout}
pipeline: simple
delivery:
  action: review # the PM reviews first
  baseBranch: custom
`,
    ".gitignore": FACTORY_GITIGNORE,
    ".factory-ids.json": `${JSON.stringify({ workers: { [LIVE_ID]: "night" }, pools: {}, projects: { p: "proj" } })}\n`,
  };
  for (const [file, text] of Object.entries(files))
    await write(path.join(root, file), text);
  if (git) {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", "-A");
    git(
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    );
    return { root, head: git("rev-parse", "HEAD") };
  }
  return { root, head: null };
}

/** The JSON's own config: a different orchestrator under the live id, and its own PM settings. */
function liveData(root: string, mode: FactoryMode = "active") {
  return {
    defaultOrchestratorSeeded: true,
    orchestrators: [
      orchestratorConfigSchema.parse({
        id: LIVE_ID,
        name: "Old night",
        projectId: "p",
        provider: "codex/gpt-5",
        schedule: { kind: "manual" },
        instructions: "JSON task prompt.",
      }),
    ],
    assistant: {
      settings: {
        defaultAction: "nothing" as const,
        factory: { root, mode },
      },
    },
  };
}

const boards: Workboard[] = [];
const shadows: FactoryShadow[] = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.dispose();
  for (const shadow of shadows.splice(0)) shadow.dispose();
  vi.useRealTimers();
});

/** Boots the board as index.server.ts does: the shadow, the store view, then `start`. */
async function boot(options: { git?: boolean; factory?: string } = {}) {
  const checkout = await temp("pwb-active-checkout-");
  const written = await writeFixtureFactory(checkout, options.git ?? true);
  const root = options.factory ?? written.root;
  const profilesDirectory = await temp("pwb-active-profiles-");
  const setup = fixture(dataSchema.parse(liveData(root)));
  setup.inventory.projects.push({
    id: "p",
    name: "Project",
    directory: checkout,
    isGit: false,
  });
  let board: Workboard | undefined;
  const watchers = new Set<() => void>();
  const factory = new FactoryShadow({
    live: () =>
      board
        ? {
            settings: () =>
              setup.store.peek((data) => data.assistant.settings.factory),
            revision: () => setup.store.peek((data) => data.revision),
            data: () => setup.store.peek((data) => structuredClone(data)),
            projects: () => board?.inventoryProjects() ?? [],
          }
        : null,
    defaultRoot: root,
    profilesRoot: profilesDirectory,
    removedRoot: path.join(profilesDirectory, "removed"),
    watch: (_dir, changed) => {
      watchers.add(changed);
      return () => watchers.delete(changed);
    },
    applied: () => void board?.factoryChanged().catch(() => undefined),
  });
  shadows.push(factory);
  setup.store.setView(factoryStoreView(factory));
  board = new Workboard(setup.host, setup.store, setup.now, 60000, {
    profilesDirectory,
    chatDirectory: path.join(profilesDirectory, "chat"),
    factory,
  });
  boards.push(board);
  await board.start();
  /** Plays a change in the factory folder, as the watcher would. */
  const touch = () => {
    for (const changed of watchers) changed();
  };
  return {
    ...setup,
    board,
    factory,
    root,
    head: written.head,
    checkout,
    touch,
    profilesRoot: profilesDirectory,
  };
}

type Booted = Awaited<ReturnType<typeof boot>>;

const gitOut = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
/** Commit subjects, newest first. */
const gitLog = (root: string) =>
  gitOut(root, "log", "--format=%s").trim().split("\n");
const readRoot = (root: string, file: string) =>
  readFile(path.join(root, file), "utf8");

async function startTask(s: Booted) {
  await s.board.mutate({
    action: "create",
    title: "Task",
    description: "Do it",
    projectId: "p",
  });
  const task = s.board.snapshot().cards.find((c) => c.title === "Task")!;
  await s.board.mutate({
    action: "stage",
    taskId: task.id,
    stage: "ready",
    expectedLabels: [],
  });
  return task.id;
}

describe("factory active mode: boot", () => {
  it("starts a task with the factory worker's settings, profile and revision stamp", async () => {
    const s = await boot();
    const [orchestrator] = s.board.snapshot().orchestrators;
    // The factory's worker, under the id the live board knew it by.
    expect(orchestrator).toMatchObject({
      id: LIVE_ID,
      name: "Night",
      projectId: "p",
      provider: "claude/claude-sonnet-5-5",
      modeId: "plan",
      thinkingOptionId: "high",
      maxConcurrent: 1,
      instructions: "Factory task prompt.",
      schedule: AUTOMATIC_SCHEDULE,
    });
    const taskId = await startTask(s);
    expect(s.host.startAgent).toHaveBeenCalledTimes(1);
    const start = (s.host.startAgent as any).mock.calls[0][1];
    const directory = path.join(s.root, "workers", "night");
    expect(start).toMatchObject({
      provider: "claude/claude-sonnet-5-5",
      modeId: "plan",
      thinkingOptionId: "high",
      systemPrompt: "Work at night, from the factory.",
    });
    expect(start.providerOptions).toEqual({
      plugins: [{ type: "local", path: directory }],
      skills: ["review", "pwb-night:notes"],
      settings: { autoMemoryDirectory: path.join(directory, "memory") },
    });
    expect(start.prompt).toContain("Factory task prompt.");
    expect(start.prompt).not.toContain("JSON task prompt.");
    expect(
      JSON.parse(
        await readFile(
          path.join(directory, ".claude-plugin", "plugin.json"),
          "utf8",
        ),
      ).name,
    ).toBe("pwb-night");
    const worker = s.factory.applied()!.compiled.workers[0]!;
    expect(s.store.current.orchestrations[taskId]).toMatchObject({
      orchestratorId: LIVE_ID,
      factoryRevision: s.head,
      workerId: "night",
      workerConfigHash: compiledWorkerConfigHash(worker),
    });
    // The plugin manifest and memory the board wrote are git-ignored: the revision stays clean.
    expect(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: s.root,
        encoding: "utf8",
      }),
    ).toBe("");
  });

  it("keeps the JSON's config on every write and copies the factory ids into the runtime state", async () => {
    const s = await boot();
    await startTask(s);
    await vi.waitFor(() =>
      expect(s.store.peek((data) => data.factoryIds.workers)).toEqual({
        [LIVE_ID]: "night",
      }),
    );
    const saved = s.store.peek((data) => structuredClone(data));
    expect(saved.orchestrators).toEqual(liveData(s.root).orchestrators);
    expect(saved.assistant.settings.defaultAction).toBe("nothing");
    expect(saved.night.start).not.toBe("23:00");
    expect(saved.settings.autoArchive).toBe(true);
    // The board reads the factory's.
    const current = s.store.current;
    expect(current.assistant.settings.defaultAction).toBe("notify");
    expect(current.assistant.settings.chat.provider).toBe(
      "claude/claude-sonnet-5-5",
    );
    expect(current.assistant.settings.projects.p).toMatchObject({
      action: "review",
      baseBranch: "custom",
    });
    expect(current.night.start).toBe("23:00");
    expect(current.settings.autoArchive).toBe(false);
    expect(saved.tasks).toHaveLength(1);
  });

  it("reads the Project Manager's prompt from pm/worker.md", async () => {
    const s = await boot();
    const view = await s.board.profileView("assistant");
    expect(view.directory).toBe(path.join(s.root, "pm"));
    expect(view.pluginName).toBe("pwb-assistant");
    expect(view.systemPrompt).toContain(
      "You are the factory's Project Manager.",
    );
  });

  it("lets the mode go back to shadow, writing nothing to the factory", async () => {
    const s = await boot();
    const { settings } = s.board.assistantSettings();
    // Leaving active mode reads the JSON again, already in the reply; the factory's values in the
    // request go nowhere.
    const saved = await s.board.setAssistantSettings({
      ...settings,
      defaultAction: "review",
      factory: { ...settings.factory, mode: "shadow" },
    });
    expect(saved.settings.defaultAction).toBe("nothing");
    expect(s.board.snapshot().orchestrators[0]).toMatchObject({
      id: LIVE_ID,
      name: "Old night",
      provider: "codex/gpt-5",
    });
    expect(s.board.assistantSettings().settings.defaultAction).toBe("nothing");
    expect(gitLog(s.root)).toEqual(["fixture"]);
  });

  it("keeps the last valid compile and its revision when a commit breaks the factory", async () => {
    const s = await boot();
    await write(
      path.join(s.root, "workers", "night", "worker.md"),
      "no frontmatter\n",
    );
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.com"].concat([
        "commit",
        "-qam",
        "broken",
      ]),
      { cwd: s.root },
    );
    s.touch();
    const status = await s.factory.status();
    expect(status.errors.length).toBeGreaterThan(0);
    expect(status.revision).not.toBe(s.head);
    expect(s.factory.applied()?.revision).toBe(s.head);
    expect(s.factory.summary()?.revision).toBe(s.head);
    expect(s.board.snapshot().orchestrators[0]?.name).toBe("Night");
  });

  it("starts no task while the factory has never compiled", async () => {
    const empty = path.join(await temp("pwb-active-empty-"), "factory");
    const s = await boot({ factory: empty });
    expect(s.factory.summary()).toMatchObject({
      mode: "active",
      differences: null,
      note: expect.stringMatching(/no new task starts/),
    });
    await startTask(s);
    expect(s.host.startAgent).not.toHaveBeenCalled();
  });
});

describe("factory active mode: the UI writes the factory", () => {
  /** The live data's own config, which no factory edit may change. */
  const jsonConfig = (s: Booted) =>
    s.store.peek((data) =>
      structuredClone({
        orchestrator: data.orchestrator,
        orchestrators: data.orchestrators,
        settings: data.settings,
        night: data.night,
        assistant: data.assistant.settings,
      }),
    );

  it("saves an orchestrator into its worker.md, keeps the comments and commits", async () => {
    const s = await boot();
    const before = jsonConfig(s);
    const config = s.board.snapshot().orchestrators[0]!;
    const board = await s.board.mutate({
      action: "orchestrator-save",
      orchestrator: {
        ...config,
        provider: "claude/claude-opus-5-5",
        maxConcurrent: 2,
        instructions: "New task prompt.",
      },
    });
    const text = await readRoot(s.root, "workers/night/worker.md");
    expect(text).toContain("# The night shift runs on Sonnet.\n");
    expect(text).toContain("model: claude/claude-opus-5-5\n");
    expect(text).toContain("thinking: high # think harder at night\n");
    expect(text).toContain("maxConcurrent: 2\n");
    expect(text).toContain("Work at night, from the factory.");
    expect(await readRoot(s.root, "workers/night/task-prompt.md")).toBe(
      "New task prompt.\n",
    );
    expect(gitLog(s.root)[0]).toBe(
      "ui: workers/night model, maxConcurrent; workers/night/task-prompt",
    );
    expect(gitOut(s.root, "status", "--porcelain")).toBe("");
    // The reply already reads the new factory, and the JSON keeps its own config.
    expect(board.orchestrators[0]).toMatchObject({
      id: LIVE_ID,
      provider: "claude/claude-opus-5-5",
      maxConcurrent: 2,
      instructions: "New task prompt.",
    });
    expect(s.factory.applied()!.revision).toBe(
      gitOut(s.root, "rev-parse", "HEAD").trim(),
    );
    expect(jsonConfig(s)).toEqual(before);
  });

  it("writes night, pools, housekeeping and defaults into board.yaml and factory.yaml", async () => {
    const s = await boot();
    await s.board.mutate({
      action: "night-settings",
      night: { ...s.store.current.night, start: "21:30" },
    });
    await s.board.mutate({
      action: "pools-save",
      pools: [
        {
          id: "x1",
          name: "Unity Editor",
          maxConcurrent: 1,
          minFreeRamPercent: 20,
        },
      ],
    });
    const current = s.board.snapshot();
    await s.board.mutate({
      action: "settings",
      settings: { ...current.settings, autoArchive: true },
      revision: current.revision,
    });
    await s.board.mutate({
      action: "orchestrator-defaults",
      orchestrator: { provider: "codex/gpt-5", instructions: "New default." },
    });
    const board = await readRoot(s.root, "board.yaml");
    expect(board).toContain("# The board's columns, pools and night.\n");
    expect(board).toContain('night: { start: "21:30", end: "05:00"');
    expect(board).toContain("autoArchive: true # keep the cards\n");
    expect(board).toMatch(/pools:\n {2}- id: unity-editor\n/);
    expect(await readRoot(s.root, "factory.yaml")).toContain(
      "model: codex/gpt-5\n",
    );
    expect(gitLog(s.root).slice(0, 4)).toEqual([
      "ui: factory defaults",
      "ui: board housekeeping",
      "ui: board pools",
      "ui: board night",
    ]);
    // The new pool keeps the board's id; the default task prompt stays in the JSON.
    const data = s.store.current;
    expect(data.settings.pools).toEqual([
      {
        id: "x1",
        name: "Unity Editor",
        maxConcurrent: 1,
        minFreeRamPercent: 20,
      },
    ]);
    expect(s.store.peek((saved) => saved.factoryIds.pools)).toEqual({
      x1: "unity-editor",
    });
    expect(data.night.start).toBe("21:30");
    expect(data.settings.autoArchive).toBe(true);
    expect(data.orchestrator.provider).toBe("codex/gpt-5");
    expect(s.store.peek((saved) => saved.orchestrator.instructions)).toBe(
      "New default.",
    );
  });

  it("writes the PM settings and the project policies (the board tools' path)", async () => {
    const s = await boot();
    const { settings } = s.board.assistantSettings();
    await s.board.setAssistantSettings({
      ...settings,
      defaultAction: "review",
      chat: { ...settings.chat, provider: "claude/claude-opus-5-5" },
      projects: {
        ...settings.projects,
        p: { ...settings.projects.p!, verifyCommand: "npm test" },
      },
      reviews: { p: "fresh-agent" },
    });
    expect(await readRoot(s.root, "factory.yaml")).toMatch(
      /delivery:\n {4}action: review\n/,
    );
    const pm = await readRoot(s.root, "pm/worker.md");
    expect(pm).toContain("model: claude/claude-opus-5-5\n");
    expect(pm).toContain("You are the factory's Project Manager.");
    const project = await readRoot(s.root, "projects/proj.yaml");
    expect(project).toContain("# The fixture project.\n");
    expect(project).toContain("action: review # the PM reviews first\n");
    expect(project).toContain("  verifyCommand: npm test\n");
    expect(gitLog(s.root)[0]).toBe(
      "ui: projects/proj delivery; factory defaults; pm model",
    );
    const read = s.board.assistantSettings().settings;
    expect(read.defaultAction).toBe("review");
    expect(read.projects.p!.verifyCommand).toBe("npm test");
    // `reviews` is not the factory's: it is saved in the JSON.
    expect(s.store.peek((data) => data.assistant.settings.reviews)).toEqual({
      p: "fresh-agent",
    });
    expect(s.store.peek((data) => data.assistant.settings.defaultAction)).toBe(
      "nothing",
    );
  });

  it("creates, moves and deletes workers", async () => {
    const s = await boot();
    const night = s.board.snapshot().orchestrators[0]!;
    await s.board.mutate({
      action: "orchestrator-save",
      orchestrator: {
        ...night,
        id: undefined,
        name: "Day shift",
        instructions: "",
      },
    });
    const created = s.board
      .snapshot()
      .orchestrators.find((o) => o.name === "Day shift")!;
    // The board's new id runs the factory's `day-shift`.
    expect(s.store.peek((data) => data.factoryIds.workers[created.id])).toBe(
      "day-shift",
    );
    const front = await readRoot(s.root, "workers/day-shift/worker.md");
    expect(front).toMatch(
      /^---\nname: Day shift\nrole: implement\nproject: proj\n/,
    );
    expect(front).toContain("priority: 10\n");
    expect(gitLog(s.root)[0]).toBe("ui: add workers/day-shift");
    await s.board.mutate({
      action: "orchestrator-move",
      id: created.id,
      direction: "up",
    });
    expect(s.board.snapshot().orchestrators.map((o) => o.name)).toEqual([
      "Day shift",
      "Night",
    ]);
    expect(await readRoot(s.root, "workers/night/worker.md")).toContain(
      "priority: 10\n",
    );
    await write(path.join(s.root, "workers/night/memory/notes.md"), "kept");
    await s.board.mutate({ action: "orchestrator-delete", id: LIVE_ID });
    expect(existsSync(path.join(s.root, "workers/night"))).toBe(false);
    // The memory the agents wrote leaves the factory but is kept.
    const removed = path.join(s.profilesRoot, "removed");
    const [kept] = await readdir(removed);
    expect(kept).toMatch(/^night-/);
    expect(
      await readFile(path.join(removed, kept!, "memory/notes.md"), "utf8"),
    ).toBe("kept");
    expect(gitLog(s.root)[0]).toBe("ui: remove workers/night");
    expect(gitOut(s.root, "status", "--porcelain")).toBe("");
    expect(s.board.snapshot().orchestrators.map((o) => o.name)).toEqual([
      "Day shift",
    ]);
  });

  it("writes a worker's prompt into the body of its worker.md", async () => {
    const s = await boot();
    await s.board.setProfilePrompt(LIVE_ID, "Edited prompt.");
    const text = await readRoot(s.root, "workers/night/worker.md");
    expect(text).toMatch(
      /thinking: high # think harder at night\n[^]*---\n\nEdited prompt\.\n$/,
    );
    expect(gitLog(s.root)[0]).toBe("ui: workers/night prompt");
    expect((await s.board.profileView(LIVE_ID)).systemPrompt).toBe(
      "Edited prompt.",
    );
  });

  it("reloads a factory changed on disk and refuses the edit", async () => {
    const s = await boot();
    await write(
      path.join(s.root, "workers", "night", "worker.md"),
      (await readRoot(s.root, "workers/night/worker.md")).replace(
        "maxConcurrent: 1",
        "maxConcurrent: 3",
      ),
    );
    const config = s.board.snapshot().orchestrators[0]!;
    await expect(
      s.board.mutate({
        action: "orchestrator-enable",
        id: config.id,
        enabled: false,
      }),
    ).rejects.toThrow(FACTORY_CHANGED_ERROR);
    expect(s.board.snapshot().orchestrators[0]).toMatchObject({
      maxConcurrent: 3,
      enabled: true,
    });
    expect(gitLog(s.root)).toEqual(["fixture"]);
    // The next edit works on what was loaded.
    await s.board.mutate({
      action: "orchestrator-enable",
      id: config.id,
      enabled: false,
    });
    expect(s.board.snapshot().orchestrators[0]!.enabled).toBe(false);
  });

  it("refuses an edit planned on a compile that a waiting load replaces", async () => {
    const s = await boot();
    // A worker that sorts first appears on disk; the watcher's load is still waiting.
    await write(
      path.join(s.root, "workers", "aaa", "worker.md"),
      "---\nname: Aaa\npriority: -10\n---\n",
    );
    s.touch();
    await expect(
      s.board.mutate({
        action: "orchestrator-enable",
        id: LIVE_ID,
        enabled: false,
      }),
    ).rejects.toThrow(FACTORY_CHANGED_ERROR);
    expect(await readRoot(s.root, "workers/aaa/worker.md")).not.toContain(
      "enabled",
    );
    expect(gitLog(s.root)).toEqual(["fixture"]);
    const names = () =>
      s.board.snapshot().orchestrators.map((o) => [o.name, o.enabled]);
    expect(names()).toEqual([
      ["Aaa", true],
      ["Night", true],
    ]);
    await s.board.mutate({
      action: "orchestrator-enable",
      id: LIVE_ID,
      enabled: false,
    });
    expect(names()).toEqual([
      ["Aaa", true],
      ["Night", false],
    ]);
    expect(gitLog(s.root)[0]).toBe("ui: workers/night enabled");
  });

  it("removes a worker from a factory outside git", async () => {
    const s = await boot({ git: false });
    await s.board.mutate({ action: "orchestrator-delete", id: LIVE_ID });
    expect(existsSync(path.join(s.root, "workers", "night"))).toBe(false);
    expect(s.board.snapshot().orchestrators).toEqual([]);
  });

  it("undoes an edit the factory would reject", async () => {
    const s = await boot();
    const config = s.board.snapshot().orchestrators[0]!;
    await expect(
      s.board.mutate({
        action: "orchestrator-save",
        orchestrator: { ...config, provider: "no-model" },
      }),
    ).rejects.toThrow(
      /The factory edit is invalid: workers\/night\/worker\.md/,
    );
    expect(gitOut(s.root, "status", "--porcelain")).toBe("");
    expect(gitLog(s.root)).toEqual(["fixture"]);
    expect(s.board.snapshot().orchestrators[0]!.provider).toBe(
      "claude/claude-sonnet-5-5",
    );
  });
});

describe("factory active mode: overlay", () => {
  it("the Pipelines tab reads the factory's pipelines", async () => {
    const s = await boot();
    const view = factoryPipelinesRpc.output.parse(
      factoryPipelinesView(s.factory.applied()!),
    );
    expect(view).toMatchObject({
      source: "factory",
      projects: { p: "simple" },
      defaultPipeline: "default",
    });
    expect(view.pipelines.simple).toMatchObject({
      start: "implement",
      stages: { implement: { role: "implement", to: "deliver" } },
    });
  });

  it("restoreJsonConfig undoes applyFactory, so a runtime change is the only one saved", async () => {
    const s = await boot();
    const applied = s.factory.applied()!;
    const saved = s.store.peek((data) => structuredClone(data));
    const next: Data = structuredClone(saved);
    applyFactory(next, applied);
    expect(next.orchestrators[0]!.provider).toBe("claude/claude-sonnet-5-5");
    next.nextTaskNumber = 99;
    next.orchestrator.instructions = "Kept";
    restoreJsonConfig(next, saved);
    expect(next).toEqual({
      ...saved,
      nextTaskNumber: 99,
      orchestrator: { ...saved.orchestrator, instructions: "Kept" },
    });
  });

  it("maps ids both ways, the data's entries over the file's", () => {
    const ids = new FactoryIds(
      { workers: { a: "alpha" }, pools: {} },
      { workers: { a: "other", b: "beta" }, pools: { p1: "unity" } },
    );
    expect(ids.liveWorker("alpha")).toBe("a");
    expect(ids.liveWorker("beta")).toBe("b");
    expect(ids.liveWorker("new")).toBe("new");
    expect(ids.factoryWorker("a")).toBe("alpha");
    expect(ids.livePool("unity")).toBe("p1");
    expect(
      missingFactoryIds(
        { workers: { a: "alpha" }, pools: {} },
        { workers: { a: "other", b: "beta" }, pools: {} },
      ),
    ).toEqual({ workers: { b: "beta" }, pools: {} });
    expect(
      missingFactoryIds({ workers: { a: "alpha" }, pools: {} }, null),
    ).toBeNull();
  });
});

describe("factory cutover: memory", () => {
  it("copies each profile's memory into the factory without overwriting", async () => {
    const checkout = await temp("pwb-active-checkout-");
    const { root } = await writeFixtureFactory(checkout, false);
    const profiles = await temp("pwb-active-profiles-");
    await write(path.join(profiles, LIVE_ID, "memory", "MEMORY.md"), "live");
    await write(path.join(profiles, LIVE_ID, "memory", "a.md"), "a");
    await write(path.join(profiles, "assistant", "memory", "pm.md"), "pm");
    await write(path.join(root, "workers", "night", "memory", "a.md"), "kept");
    const lines: string[] = [];
    const code = await runFactoryCli(["memory", root, "--profiles", profiles], {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      env: {},
      cwd: root,
    });
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe("copied 2 memory folder(s)");
    const memory = path.join(root, "workers", "night", "memory");
    expect(await readFile(path.join(memory, "MEMORY.md"), "utf8")).toBe("live");
    expect(await readFile(path.join(memory, "a.md"), "utf8")).toBe("kept");
    expect(
      await readFile(path.join(root, "pm", "memory", "pm.md"), "utf8"),
    ).toBe("pm");
    // The profile folders stay, for a way back.
    expect(existsSync(path.join(profiles, LIVE_ID, "memory", "a.md"))).toBe(
      true,
    );
  });

  it("needs the export's id file", async () => {
    const root = await temp("pwb-active-noids-");
    await expect(
      copyProfileMemory({ factoryRoot: root, profilesRoot: root }),
    ).rejects.toThrow(/factory export first/);
  });
});
