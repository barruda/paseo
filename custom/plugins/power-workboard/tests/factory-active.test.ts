// CUSTOM(factory): active mode (docs/factory.md, ticket 9). The board boots on a fixture factory,
// starts a task with the factory worker's settings and profile, keeps the JSON's own config on
// every write, and refuses edits of what the factory owns. Everything lives in temp folders.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFactoryCli } from "../server/factory/cli";
import { copyProfileMemory } from "../server/factory/cutover";
import { compiledWorkerConfigHash } from "../server/factory/stamp";
import { FACTORY_PROMPT_READ_ONLY } from "../server/profiles";
import { FACTORY_READ_ONLY_ERROR } from "../server/workboard";
import {
  FactoryIds,
  applyFactory,
  changedSettingsKeys,
  missingFactoryIds,
  factoryPipelinesView,
  restoreJsonConfig,
} from "../shared/factory/active";
import { factoryPipelinesRpc } from "../shared/rpc";
import { dataSchema, type Data } from "../shared/model";
import { AUTOMATIC_SCHEDULE } from "../shared/schedule";
import {
  LIVE_ID,
  boot,
  disposeBooted,
  liveData,
  startTask,
  temp,
  write,
  writeFixtureFactory,
} from "./factory-boot";

afterEach(() => {
  disposeBooted();
  vi.useRealTimers();
});

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

  it("refuses edits of what the factory owns and lets the mode go back to shadow", async () => {
    const s = await boot();
    const config = s.board.snapshot().orchestrators[0]!;
    for (const mutation of [
      { action: "orchestrator-save" as const, orchestrator: config },
      { action: "orchestrator-delete" as const, id: LIVE_ID },
      { action: "orchestrator-enable" as const, id: LIVE_ID, enabled: false },
      { action: "pools-save" as const, pools: [] },
      {
        action: "orchestrator-defaults" as const,
        orchestrator: { provider: "codex/gpt-5" },
      },
    ])
      await expect(s.board.mutate(mutation)).rejects.toThrow(
        FACTORY_READ_ONLY_ERROR,
      );
    // The default task prompt of new orchestrators stays in the JSON.
    await s.board.mutate({
      action: "orchestrator-defaults",
      orchestrator: { instructions: "New default." },
    });
    expect(s.store.peek((data) => data.orchestrator.instructions)).toBe(
      "New default.",
    );
    await expect(s.board.setProfilePrompt(LIVE_ID, "Edited")).rejects.toThrow(
      FACTORY_PROMPT_READ_ONLY,
    );
    const { settings } = s.board.assistantSettings();
    await expect(
      s.board.setAssistantSettings({ ...settings, defaultAction: "review" }),
    ).rejects.toThrow(FACTORY_READ_ONLY_ERROR);
    // Leaving active mode is allowed, and the board reads the JSON again, already in the reply.
    const saved = await s.board.setAssistantSettings({
      ...settings,
      factory: { ...settings.factory, mode: "shadow" },
    });
    expect(saved.settings.defaultAction).toBe("nothing");
    expect(s.board.snapshot().orchestrators[0]).toMatchObject({
      id: LIVE_ID,
      name: "Old night",
      provider: "codex/gpt-5",
    });
    expect(s.board.assistantSettings().settings.defaultAction).toBe("nothing");
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

  it("compares settings whatever their key order", () => {
    const settings = dataSchema.parse({}).settings;
    const reordered = Object.fromEntries(
      Object.entries(settings).reverse(),
    ) as typeof settings;
    expect(changedSettingsKeys(settings, reordered)).toEqual([]);
    expect(
      changedSettingsKeys(settings, { ...settings, autoArchive: false }),
    ).toEqual(["autoArchive"]);
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
