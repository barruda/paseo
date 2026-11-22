// CUSTOM(factory): shadow mode (docs/factory.md, ticket 7): watch debounce, the diff against the
// live config and the invalid-file case. Everything lives in temp folders; ~/.paseo is never read.
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryLines } from "../client/FactoryLine";
import { strings } from "../client/strings";
import { diffFactory } from "../shared/factory/diff";
import { exportFactory } from "../server/factory/export";
import { loadFactory } from "../server/factory/loader";
import {
  FactoryShadow,
  resolveFactoryRoot,
  type ShadowLive,
  type WatchFolder,
} from "../server/factory/shadow";
import type { FactorySettings } from "../shared/factory/status";
import { dataSchema, type Data } from "../shared/model";
import { AUTOMATIC_SCHEDULE } from "../shared/schedule";

const temp = async (prefix: string) =>
  realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));

async function write(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const PASEO = "8ad18f84-2755-4ec6-9f86-814de4c455d3";
const SPARE = "f91d7924-41ae-4949-8eef-76b2d0e22e86";

/** A board with two workers and a delivery policy, exported to a new factory. */
async function fixture() {
  const home = await temp("pwb-shadow-home-");
  const checkout = path.join(home, "projetos", "paseo");
  await mkdir(checkout, { recursive: true });
  const projects = [{ id: "prj_paseo", directory: checkout }];
  const data = dataSchema.parse({
    orchestrators: [
      {
        id: PASEO,
        name: "Paseo",
        projectId: "prj_paseo",
        schedule: AUTOMATIC_SCHEDULE,
        instructions: "Read CLAUDE.md first.",
        skills: { mode: "selected", names: ["paseo"] },
      },
      { id: SPARE, name: "Spare", projectId: null, enabled: false },
    ],
    assistant: {
      settings: {
        projects: {
          prj_paseo: { action: "review", baseBranch: "custom" },
        },
      },
    },
  });
  const profiles = await temp("pwb-shadow-profiles-");
  await write(
    path.join(profiles, PASEO, "system-prompt.md"),
    "You are the paseo worker.\n",
  );
  await write(
    path.join(profiles, "assistant", "system-prompt.md"),
    "You are the Project Manager.\n",
  );
  const root = path.join(await temp("pwb-shadow-target-"), "factory");
  const exported = await exportFactory({
    data,
    projects: projects.map((project) => ({
      projectId: project.id,
      rootPath: project.directory,
      displayName: "paseo",
    })),
    profilesRoot: profiles,
    target: root,
    homeDir: home,
  });
  expect(exported.errors).toEqual([]);
  return { home, root, profiles, projects, data };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The board side the shadow reads; tests change `data` and `settings` in place. */
function liveState(source: Fixture, settings: FactorySettings) {
  const state = {
    data: structuredClone(source.data),
    settings,
    projects: source.projects,
    up: true,
  };
  const live: ShadowLive = {
    settings: () => state.settings,
    revision: () => state.data.revision,
    data: () => structuredClone(state.data),
    projects: () => state.projects,
  };
  return { state, live: () => (state.up ? live : null) };
}

/** Records the watched folders; `fire` plays a change in one of them. */
function fakeWatch() {
  const watched = new Map<string, () => void>();
  const watch: WatchFolder = (dir, changed) => {
    watched.set(dir, changed);
    return () => watched.delete(dir);
  };
  const fire = (dir: string) => {
    const changed = watched.get(dir);
    if (!changed) throw new Error(`${dir} is not watched`);
    changed();
  };
  return { watched, watch, fire };
}

const shadows: FactoryShadow[] = [];
function shadowOf(
  source: Fixture,
  live: () => ShadowLive | null,
  extra: Partial<ConstructorParameters<typeof FactoryShadow>[0]> = {},
) {
  const shadow = new FactoryShadow({
    live,
    defaultRoot: source.root,
    profilesRoot: source.profiles,
    homeDir: source.home,
    ...extra,
  });
  shadows.push(shadow);
  return shadow;
}

afterEach(() => {
  for (const shadow of shadows.splice(0)) shadow.dispose();
  vi.useRealTimers();
});

describe("factory shadow: diff", () => {
  it("reports no differences for the factory exported from the live data", async () => {
    const source = await fixture();
    const { live } = liveState(source, { root: "", mode: "shadow" });
    const shadow = shadowOf(source, live, { watch: fakeWatch().watch });
    const status = await shadow.status();
    expect(status.errors).toEqual([]);
    expect(status.compiled).toBe(true);
    expect(status.root).toBe(source.root);
    expect(status.differences).toEqual([]);
    expect(shadow.summary()).toEqual({
      mode: "shadow",
      loading: false,
      errors: 0,
      firstError: null,
      differences: 0,
      note: null,
    });
  });

  it("follows live changes: settings, policies and prompts, with factory ids", async () => {
    const source = await fixture();
    const { state, live } = liveState(source, { root: "", mode: "shadow" });
    const shadow = shadowOf(source, live, { watch: fakeWatch().watch });
    await shadow.status();
    state.data.orchestrators[0]!.maxConcurrent = 4;
    state.data.assistant.settings.projects.prj_paseo!.baseBranch = "main";
    state.data.revision++;
    await write(
      path.join(source.profiles, PASEO, "system-prompt.md"),
      "Edited.\n",
    );
    const status = await shadow.status();
    expect(status.differences).toEqual([
      { path: "workers.paseo.maxConcurrent", live: "4", factory: "2" },
      {
        path: "workers.paseo.systemPrompt",
        live: "Edited.",
        factory: "You are the paseo worker.",
      },
      {
        path: "projects.prj_paseo.baseBranch",
        live: "main",
        factory: "custom",
      },
    ]);
    expect(status.differenceCount).toBe(3);
    // The summary picks up a new data revision without a status call.
    state.data.night.start = "21:00";
    state.data.revision++;
    shadow.summary();
    await shadow.idle();
    expect(shadow.summary()?.differences).toBe(4);
  });

  it("names missing workers and a new order", async () => {
    const source = await fixture();
    const loaded = await loadFactory(source.root, { homeDir: source.home });
    const { compileFactory } = await import("../shared/factory/compile");
    const compiled = compileFactory(loaded.factory!, {
      projectIdForPath: () => "prj_paseo",
    }).compiled!;
    const data: Data = structuredClone(source.data);
    data.orchestrators.reverse();
    data.orchestrators.push(
      dataSchema.parse({ orchestrators: [{ id: "new", name: "New" }] })
        .orchestrators[0]!,
    );
    const ids = { workers: { [PASEO]: "paseo", [SPARE]: "spare" }, pools: {} };
    const paths = diffFactory(
      compiled,
      {
        orchestrator: data.orchestrator,
        orchestrators: data.orchestrators,
        settings: data.settings,
        night: data.night,
        assistant: data.assistant.settings,
        prompts: null,
      },
      ids,
    ).map((difference) => [difference.path, difference.factory]);
    expect(paths).toEqual([
      ["workers.new", null],
      ["workers.order", JSON.stringify(["paseo", "spare"])],
    ]);
  });
});

describe("factory shadow: watch", () => {
  it("loads once 500 ms after the last change of a burst", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const source = await fixture();
    const { live } = liveState(source, { root: "", mode: "shadow" });
    const { watched, watch, fire } = fakeWatch();
    const load = vi.fn(loadFactory);
    const shadow = shadowOf(source, live, { watch, load });
    shadow.sync();
    expect(shadow.summary()?.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await shadow.idle();
    expect(load).toHaveBeenCalledTimes(1);
    // The folders the loader reads, without memory/ and dot folders other than .git.
    const folders = [...watched.keys()].map((dir) =>
      path.relative(source.root, dir),
    );
    expect(folders).toEqual(
      expect.arrayContaining(["", ".git", "workers", "workers/paseo", "pm"]),
    );
    expect(folders.some((dir) => dir.includes("memory"))).toBe(false);
    expect(folders).not.toContain(".schema");

    fire(path.join(source.root, "workers", "paseo"));
    await vi.advanceTimersByTimeAsync(200);
    fire(source.root);
    await vi.advanceTimersByTimeAsync(200);
    fire(path.join(source.root, "workers"));
    await vi.advanceTimersByTimeAsync(499);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shadow.summary()?.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await shadow.idle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(shadow.summary()?.loading).toBe(false);
  });

  it("watches a folder created after the first load", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const source = await fixture();
    const { live } = liveState(source, { root: "", mode: "shadow" });
    const { watched, watch, fire } = fakeWatch();
    const shadow = shadowOf(source, live, { watch });
    await shadow.status();
    const extra = path.join(source.root, "skills", "new-skill");
    expect(watched.has(extra)).toBe(false);
    await write(
      path.join(extra, "SKILL.md"),
      "---\nname: new-skill\ndescription: New\n---\n",
    );
    fire(source.root);
    await vi.advanceTimersByTimeAsync(500);
    await shadow.idle();
    expect(watched.has(extra)).toBe(true);
  });

  it("reloads on a real file change with the default watcher", async () => {
    const source = await fixture();
    const { live } = liveState(source, { root: "", mode: "shadow" });
    const shadow = shadowOf(source, live, { debounceMs: 50 });
    expect((await shadow.status()).differences).toEqual([]);
    const file = path.join(source.root, "workers", "paseo", "worker.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "maxConcurrent: 2",
        "maxConcurrent: 3",
      ),
    );
    await vi.waitFor(
      () => {
        expect(shadow.summary()?.differences).toBe(1);
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it("loads a new folder set while a slow load of the old one runs", async () => {
    const source = await fixture();
    const other = path.join(path.dirname(source.root), "other");
    await cp(source.root, other, { recursive: true });
    const { state, live } = liveState(source, { root: "", mode: "shadow" });
    const { watched, watch } = fakeWatch();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const roots: string[] = [];
    const load: typeof loadFactory = async (root, options) => {
      roots.push(root);
      if (roots.length === 1) await gate;
      return loadFactory(root, options);
    };
    const shadow = shadowOf(source, live, { watch, load });
    shadow.sync();
    await vi.waitFor(() => expect(roots).toEqual([source.root]));
    state.settings = { root: other, mode: "shadow" };
    shadow.sync();
    // Let the new folder's load be asked for while the old one still runs.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() => expect(roots).toEqual([source.root, other]));
    await shadow.idle();
    expect(watched.has(other)).toBe(true);
    expect(watched.has(source.root)).toBe(false);
    expect(shadow.summary()).toMatchObject({ errors: 0, differences: 0 });
  });

  it("loads again after shadow → off → shadow during a slow load", async () => {
    const source = await fixture();
    const { state, live } = liveState(source, { root: "", mode: "shadow" });
    const { watched, watch } = fakeWatch();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const load: typeof loadFactory = async (root, options) => {
      if (++calls === 1) await gate;
      return loadFactory(root, options);
    };
    const shadow = shadowOf(source, live, { watch, load });
    shadow.sync();
    await vi.waitFor(() => expect(calls).toBe(1));
    state.settings = { root: "", mode: "off" };
    shadow.sync();
    state.settings = { root: "", mode: "shadow" };
    shadow.sync();
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() => expect(calls).toBe(2));
    await shadow.idle();
    expect(watched.has(source.root)).toBe(true);
    expect(shadow.summary()).toMatchObject({ errors: 0, differences: 0 });
  });

  it("stops watching when the mode goes off and starts over when it comes back", async () => {
    const source = await fixture();
    const { state, live } = liveState(source, { root: "", mode: "shadow" });
    const { watched, watch } = fakeWatch();
    const shadow = shadowOf(source, live, { watch });
    await shadow.status();
    expect(watched.size).toBeGreaterThan(0);
    state.settings = { root: "", mode: "off" };
    expect(shadow.summary()).toBeNull();
    expect(watched.size).toBe(0);
    state.settings = { root: source.root, mode: "active" };
    const status = await shadow.status();
    expect(status.mode).toBe("active");
    expect(status.note).toMatch(/shadow/);
    expect(status.differences).toEqual([]);
  });
});

describe("factory shadow: invalid file", () => {
  it("keeps the last valid factory and reports the error with file and line", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const source = await fixture();
    const { state, live } = liveState(source, { root: "", mode: "shadow" });
    const { watch, fire } = fakeWatch();
    const shadow = shadowOf(source, live, { watch });
    await shadow.status();
    const file = path.join(source.root, "workers", "paseo", "worker.md");
    const valid = await readFile(file, "utf8");
    await writeFile(file, valid.replace("maxConcurrent: 2", "maxConcurent: 3"));
    fire(path.join(source.root, "workers", "paseo"));
    await vi.advanceTimersByTimeAsync(500);
    await shadow.idle();

    const status = await shadow.status();
    expect(status.compiled).toBe(true);
    expect(status.errors).toHaveLength(1);
    expect(status.errors[0]).toMatchObject({
      file: "workers/paseo/worker.md",
      kind: "schema",
    });
    expect(status.errors[0]!.line).toBeGreaterThan(1);
    // The diff still compares the last valid factory with the live data.
    state.data.orchestrators[0]!.batchSize = 9;
    state.data.revision++;
    expect((await shadow.status()).differences.map((d) => d.path)).toEqual([
      "workers.paseo.batchSize",
    ]);
    const summary = shadow.summary()!;
    expect(summary.errors).toBe(1);
    expect(summary.firstError).toMatch(/^workers\/paseo\/worker\.md:\d+: /);
    expect(summary.differences).toBe(1);

    await writeFile(file, valid);
    fire(path.join(source.root, "workers", "paseo"));
    await vi.advanceTimersByTimeAsync(500);
    await shadow.idle();
    expect(shadow.summary()).toMatchObject({ errors: 0, firstError: null });
  });

  it("reports a missing folder and has no diff until a factory compiles", async () => {
    const source = await fixture();
    const missing = path.join(source.home, "nowhere");
    const { live } = liveState(source, { root: missing, mode: "shadow" });
    const shadow = shadowOf(source, live, { watch: fakeWatch().watch });
    const status = await shadow.status();
    expect(status.compiled).toBe(false);
    expect(status.errors.length).toBeGreaterThan(0);
    expect(shadow.summary()).toMatchObject({
      differences: null,
      loading: false,
    });
  });
});

describe("factory shadow: root and revision", () => {
  it("resolves the root setting", () => {
    expect(resolveFactoryRoot("", "/d/factory", "/home/u")).toBe("/d/factory");
    expect(resolveFactoryRoot("~/f", "/d", "/home/u")).toBe("/home/u/f");
    expect(resolveFactoryRoot(" /srv/f ", "/d", "/home/u")).toBe("/srv/f");
  });

  it("is git HEAD, plus a content hash while there are changes", async () => {
    const source = await fixture();
    const { live } = liveState(source, { root: "", mode: "shadow" });
    const { watch, fire } = fakeWatch();
    const shadow = shadowOf(source, live, { watch, debounceMs: 0 });
    const clean = (await shadow.status()).revision;
    expect(clean).toMatch(/^[0-9a-f]{40}$/);
    await write(path.join(source.root, "templates", "spec.md"), "# Spec\n");
    fire(source.root);
    await vi.waitFor(async () => {
      expect((await shadow.status()).revision).toMatch(
        new RegExp(`^${clean}\\+dirty\\.[0-9a-f]{12}$`),
      );
    });
  });
});

describe("factory line", () => {
  const t = strings("en").factory;
  const summary = {
    mode: "shadow" as const,
    loading: false,
    errors: 0,
    firstError: null,
    differences: 3,
    note: null,
  };
  it("shows nothing while the mode is off", () => {
    expect(factoryLines(null, t)).toBeNull();
    expect(factoryLines(undefined, t)).toBeNull();
  });
  it("shows the mode and the difference count, and the first error", () => {
    expect(factoryLines(summary, t)).toEqual({
      status: "factory: shadow, 3 differences",
      error: null,
      note: null,
    });
    expect(
      factoryLines(
        { ...summary, errors: 2, firstError: "board.yaml:4: bad" },
        t,
      )?.error,
    ).toBe("2 error(s); the last valid factory is kept: board.yaml:4: bad");
    expect(
      factoryLines({ ...summary, differences: null, loading: true }, t)?.status,
    ).toBe("factory: shadow, loading…");
    expect(factoryLines({ ...summary, differences: null }, t)?.status).toBe(
      "factory: shadow, no valid factory yet",
    );
  });
});
