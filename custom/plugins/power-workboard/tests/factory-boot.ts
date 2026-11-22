// CUSTOM(factory): boots the board in active mode on a fixture factory, as index.server.ts does.
// Shared by the active-mode and pipeline engine tests; everything lives in temp folders.
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FACTORY_GITIGNORE } from "../server/factory/builtin";
import { FactoryShadow, factoryStoreView } from "../server/factory/shadow";
import { Workboard } from "../server/workboard";
import type { FactoryMode } from "../shared/factory/status";
import { dataSchema, orchestratorConfigSchema } from "../shared/model";
import { fixture } from "./fixtures";

export const temp = async (prefix: string) =>
  realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));

export async function write(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Stands for the checkout's path in `files` given to `boot`. */
export const CHECKOUT = "{{checkout}}";
export const LIVE_ID = "3f0c1a2b-0000-4000-8000-000000000001";

/** A factory with one worker (`night`, the live orchestrator LIVE_ID) for the project at `checkout`. */
export async function writeFixtureFactory(
  checkout: string,
  git = true,
  /** Files over the fixture's; null drops one. */
  extra: Record<string, string | null> = {},
) {
  const root = path.join(await temp("pwb-active-"), "factory");
  const files: Record<string, string | null> = {
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
    ...extra,
  };
  for (const [file, text] of Object.entries(files))
    if (text !== null)
      await write(path.join(root, file), text.replaceAll(CHECKOUT, checkout));
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
export function liveData(root: string, mode: FactoryMode = "active") {
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
/** Call from `afterEach`: stops every board and shadow `boot` started. */
export function disposeBooted() {
  for (const board of boards.splice(0)) board.dispose();
  for (const shadow of shadows.splice(0)) shadow.dispose();
}

/** Boots the board as index.server.ts does: the shadow, the store view, then `start`. */
export async function boot(
  options: {
    git?: boolean;
    factory?: string;
    /** Factory files over the fixture's (null drops one); `CHECKOUT` stands for its path. */
    files?: Record<string, string | null>;
    /** `factoryIds.workers` the data already has. */
    dataIds?: Record<string, string>;
  } = {},
) {
  const checkout = await temp("pwb-active-checkout-");
  const written = await writeFixtureFactory(
    checkout,
    options.git ?? true,
    options.files,
  );
  const root = options.factory ?? written.root;
  const profilesDirectory = await temp("pwb-active-profiles-");
  const setup = fixture(
    dataSchema.parse({
      ...liveData(root),
      factoryIds: { workers: options.dataIds ?? {}, pools: {} },
    }),
  );
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
  // A clock the test moves, so agent turns can settle.
  let clock = setup.now();
  board = new Workboard(setup.host, setup.store, () => clock, 60000, {
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
    advance: (ms: number) => (clock += ms),
  };
}

export type Booted = Awaited<ReturnType<typeof boot>>;

export const gitOut = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
/** Commit subjects, newest first. */
export const gitLog = (root: string) =>
  gitOut(root, "log", "--format=%s").trim().split("\n");
export const readRoot = (root: string, file: string) =>
  readFile(path.join(root, file), "utf8");

export async function startTask(s: Booted) {
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
