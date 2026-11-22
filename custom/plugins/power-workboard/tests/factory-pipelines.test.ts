// CUSTOM(factory): pipelines, roles and the built-in factory files (docs/factory.md, ticket 6).
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileFactory } from "../shared/factory/compile";
import {
  projectWorkers,
  stageRunner,
  type StageWorkerCandidate,
} from "../shared/factory/pipeline";
import {
  pipelineFileSchema,
  type FactoryIssue,
} from "../shared/factory/schema";
import { readBuiltinFactoryFiles } from "../server/factory/builtin";
import { loadFactory } from "../server/factory/loader";
import {
  MINIMAL_FACTORY,
  writeFactory,
  type FactoryFiles,
} from "./factory-fixtures";

const checkout = async () =>
  realpath(await mkdtemp(path.join(os.tmpdir(), "pwb-pipeline-")));

/** `kind file:line message`, the way the tests compare issues. */
const full = (issue: FactoryIssue) =>
  `${issue.kind} ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`;

/** A factory with one project ({{P}}) and its worker `w`, plus `files`. */
async function load(files: FactoryFiles, worker = "role: implement\n") {
  const root = await writeFactory(
    {
      ...MINIMAL_FACTORY,
      "projects/p.yaml": "path: {{P}}\npipeline: flow\n",
      "workers/w/worker.md": `---\nproject: p\n${worker}---\n`,
      "roles/implement.md": "Implement.\n",
      "roles/review.md": "Review.\n",
      ...files,
    },
    { P: await checkout() },
  );
  return loadFactory(root);
}

async function errorsOf(files: FactoryFiles, worker?: string) {
  const loaded = await load(files, worker);
  expect(loaded.factory).toBeNull();
  return loaded.errors.map(full);
}

const pipeline = (yaml: string) => ({ "pipelines/flow.yaml": yaml });

describe("built-in factory files", () => {
  it("ships the default and critical pipelines, five role prompts, the spec template, README and .gitignore", async () => {
    const files = await readBuiltinFactoryFiles();
    expect(Object.keys(files)).toEqual([
      ".gitignore",
      "README.md",
      "pipelines/critical.yaml",
      "pipelines/default.yaml",
      "roles/implement.md",
      "roles/review.md",
      "roles/spec.md",
      "roles/triage.md",
      "roles/verify.md",
      "templates/spec.md",
    ]);
    expect(files["roles/verify.md"]).toMatch(/evidence/);
    expect(files["roles/spec.md"]).toMatch(/spec template/);
  });

  it("load into a factory with no issues, an implement worker covering every role", async () => {
    const vars = { P: await checkout(), Q: await checkout() };
    const root = await writeFactory(
      {
        ...(await readBuiltinFactoryFiles()),
        "factory.yaml":
          "schemaVersion: pwb/v1alpha1\nname: x\ndefaults:\n  pipeline: default\n",
        "projects/plain.yaml": "path: {{P}}\n",
        "projects/critical.yaml": "path: {{Q}}\npipeline: critical\n",
        "workers/plain/worker.md": "---\nproject: plain\n---\n",
        "workers/careful/worker.md":
          "---\nproject: critical\nrole: implement\n---\n",
      },
      vars,
    );
    const loaded = await loadFactory(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings).toEqual([]);

    const { compiled, errors } = compileFactory(loaded.factory!, {
      projectIdForPath: (realPath) => realPath,
    });
    expect(errors).toEqual([]);
    expect(compiled!.workers.map((worker) => worker.role)).toEqual([
      "implement",
      "implement",
    ]);
    expect(
      compiled!.projects.map((project) => [project.id, project.pipeline]),
    ).toEqual([
      ["critical", "critical"],
      ["plain", "default"],
    ]);

    const byId = Object.fromEntries(
      compiled!.pipelines.map((entry) => [entry.id, entry]),
    );
    expect(byId.default.start).toBe("implement");
    expect(
      byId.default.stages.map((stage) => [stage.id, stage.role, stage.to]),
    ).toEqual([
      ["implement", "implement", "review"],
      [
        "review",
        "pm",
        [
          { stage: "deliver", when: "No blocking findings." },
          { stage: "implement", when: "Blocking findings remain." },
        ],
      ],
    ]);
    expect(byId.critical.start).toBe("triage");
    expect(byId.critical.stages.map((stage) => stage.id)).toEqual([
      "triage",
      "spec",
      "implement",
      "verify",
      "review",
    ]);
    const stage = (id: string) =>
      byId.critical.stages.find((entry) => entry.id === id)!;
    expect(stage("spec").gate).toEqual({
      question: "Approve this spec?",
      options: [
        { id: "approve", label: "Approve", to: "implement" },
        { id: "changes", label: "Request changes", to: "spec" },
      ],
    });
    expect(stage("spec").to).toBeNull();
    expect(stage("review").session).toBe("fresh");
    expect(stage("implement").session).toBe("continue");
    expect(stage("verify").maxVisits).toBe(3);
    const files = await readBuiltinFactoryFiles();
    expect(stage("verify").prompt).toBe(files["roles/verify.md"].trim());
    // The default pipeline's PM review reads roles/review.md through `file`.
    expect(byId.default.stages[1].prompt).toBe(files["roles/review.md"].trim());
  });
});

describe("pipeline file checks", () => {
  it("accepts every stage field and compiles prompt, worker and layout", async () => {
    const loaded = await load({
      ...pipeline(`description: Everything
start: a
stages:
  a:
    role: implement
    worker: w
    prompt: Do the thing.
    session: fresh
    maxVisits: 5
    to: b
  b:
    role: review
    file: roles/review.md
    to: end
layout:
  a: { x: 0, y: 0 }
  end: { x: 200, y: 0 }
`),
    });
    expect(loaded.errors).toEqual([]);
    const { compiled } = compileFactory(loaded.factory!, {
      projectIdForPath: (realPath) => realPath,
    });
    expect(compiled!.pipelines).toEqual([
      {
        id: "flow",
        description: "Everything",
        start: "a",
        autonomy: null,
        stages: [
          {
            id: "a",
            role: "implement",
            worker: "w",
            prompt: "Do the thing.",
            session: "fresh",
            maxVisits: 5,
            gate: null,
            to: "b",
          },
          {
            id: "b",
            role: "review",
            worker: null,
            prompt: "Review.",
            session: "continue",
            maxVisits: 3,
            gate: null,
            to: "end",
          },
        ],
        layout: { a: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
      },
    ]);
  });

  it("unknown stage: in start, to, a to condition, a gate option and the layout", async () => {
    expect(
      await errorsOf(
        pipeline(`start: nope
stages:
  a:
    role: implement
    to: missing
  b:
    role: implement
    to:
      - { stage: ghost, when: Always. }
  c:
    role: implement
    gate:
      question: Go?
      options:
        - { id: yes, label: Yes, to: phantom }
layout:
  stray: { x: 0, y: 0 }
`),
      ),
    ).toEqual([
      'schema pipelines/flow.yaml:1 start: no stage "nope" (built-in: deliver, end, cancel)',
      'schema pipelines/flow.yaml:5 stages.a.to: no stage "missing" (built-in: deliver, end, cancel)',
      'schema pipelines/flow.yaml:9 stages.b.to.0.stage: no stage "ghost" (built-in: deliver, end, cancel)',
      'schema pipelines/flow.yaml:15 stages.c.gate.options.0.to: no stage "phantom" (built-in: deliver, end, cancel)',
      'schema pipelines/flow.yaml:17 layout.stray: no stage "stray" (built-in: deliver, end, cancel)',
    ]);
  });

  it("built-in stages: transitions may name them, start and stage ids may not", async () => {
    expect(
      await errorsOf(
        pipeline(`start: deliver
stages:
  end:
    role: implement
    to: cancel
`),
      ),
    ).toEqual([
      'schema pipelines/flow.yaml:1 start: "deliver" is built in; start at one of the pipeline\'s stages',
      'schema pipelines/flow.yaml:3 stages.end: "end" is a built-in stage; pick another id',
    ]);
  });

  it("gate option without to", async () => {
    expect(
      await errorsOf(
        pipeline(`start: a
stages:
  a:
    role: implement
    gate:
      question: Ship it?
      options:
        - { id: ship, label: Ship, to: deliver }
        - { id: wait, label: Wait }
        - { id: ship, label: Again, to: a }
`),
      ),
    ).toEqual([
      'schema pipelines/flow.yaml:9 stages.a.gate.options.1: Gate option "wait" needs to: the stage it leads to',
      'schema pipelines/flow.yaml:10 stages.a.gate.options.2.id: Duplicate gate option "ship"',
    ]);
  });

  it("unreachable stage", async () => {
    expect(
      await errorsOf(
        pipeline(`start: a
stages:
  a:
    role: implement
    to: deliver
  orphan:
    role: review
    to: a
`),
      ),
    ).toEqual([
      'schema pipelines/flow.yaml:6 stages.orphan: Unreachable: no transition from start "a" leads here',
    ]);
  });

  it("a stage needs exactly one of to and gate, and one of prompt and file", async () => {
    expect(
      await errorsOf(
        pipeline(`start: a
stages:
  a:
    role: implement
    to: b
  b:
    role: implement
    prompt: Inline.
    file: roles/review.md
    to: c
    gate:
      question: Sure?
      options: [{ id: ok, label: OK, to: deliver }]
  c:
    role: implement
`),
      ),
    ).toEqual([
      "schema pipelines/flow.yaml:9 stages.b.file: Use prompt or file, not both",
      "schema pipelines/flow.yaml:11 stages.b.gate: Use to or gate, not both: a gate's options name the next stage",
      "schema pipelines/flow.yaml:14 stages.c: Needs to or gate: where the task goes after this stage",
    ]);
  });

  it("schema: unknown keys, an unknown role, an empty pipeline", async () => {
    expect(
      await errorsOf(
        pipeline(`start: a
stages:
  a:
    role: tester
    goto: b
    to: deliver
`),
      ),
    ).toEqual([
      expect.stringMatching(/^schema pipelines\/flow\.yaml:4 stages\.a\.role:/),
      'schema pipelines/flow.yaml:5 stages.a: Unrecognized key: "goto"',
    ]);
    expect(
      pipelineFileSchema
        .safeParse({ start: "a", stages: {} })
        .error?.issues.map((issue) => issue.message),
    ).toEqual([
      "Define at least one stage",
      'no stage "a" (built-in: deliver, end, cancel)',
    ]);
  });
});

describe("pipeline references", () => {
  it("unknown pipeline: in a project and in defaults.pipeline", async () => {
    expect(
      await errorsOf({
        "factory.yaml":
          "schemaVersion: pwb/v1alpha1\nname: x\ndefaults:\n  pipeline: gone\n",
        "projects/p.yaml": "path: {{P}}\npipeline: missing\n",
      }),
    ).toEqual([
      "reference factory.yaml:4 defaults.pipeline: no pipelines/gone.yaml",
      "reference projects/p.yaml:2 pipeline: no pipelines/missing.yaml",
    ]);
  });

  it("a pipeline with schema errors is not also reported as missing", async () => {
    expect(await errorsOf(pipeline("start: a\nstages: {}\n"))).toEqual([
      "schema pipelines/flow.yaml:2 stages: Define at least one stage",
      'schema pipelines/flow.yaml:1 start: no stage "a" (built-in: deliver, end, cancel)',
    ]);
  });

  it("unknown pinned worker, missing stage file, missing role prompt", async () => {
    expect(
      await errorsOf({
        ...pipeline(`start: a
stages:
  a:
    role: implement
    worker: nobody
    to: b
  b:
    role: review
    file: roles/nothing.md
    to: c
  c:
    role: verify
    to: deliver
`),
      }),
    ).toEqual([
      "reference pipelines/flow.yaml:5 stages.a.worker: no workers/nobody/worker.md",
      "reference pipelines/flow.yaml:9 stages.b.file: no file roles/nothing.md in the factory",
      "reference pipelines/flow.yaml:12 stages.c: no roles/verify.md; add it or set prompt or file",
    ]);
  });

  it("role with no worker and no implement fallback", async () => {
    const flow = pipeline(`start: a
stages:
  a:
    role: implement
    to: b
  b:
    role: review
    to: deliver
`);
    // The project's only worker reviews: nobody implements.
    expect(await errorsOf(flow, "role: review\n")).toEqual([
      "reference projects/p.yaml:2 pipeline flow, stage a: no worker of this project has role implement (set worker: on the stage, or add a worker)",
    ]);
    // Pinning a worker on the stage settles it.
    const pinned = await load(
      pipeline(`start: a
stages:
  a:
    role: implement
    worker: w
    to: b
  b:
    role: review
    to: deliver
`),
      "role: review\n",
    );
    expect(pinned.errors).toEqual([]);
  });

  it("an implement worker runs the roles the project has no worker for; pm needs none", async () => {
    const loaded = await load(
      {
        "roles/triage.md": "Triage.\n",
        ...pipeline(`start: a
stages:
  a:
    role: triage
    to: b
  b:
    role: pm
    file: roles/review.md
    to: end
`),
      },
      "",
    );
    expect(loaded.errors).toEqual([]);
  });

  it("projects with no worker of their own use the workers with project: null", async () => {
    const flow = pipeline(`start: a
stages:
  a:
    role: verify
    to: deliver
`);
    const roles = { "roles/verify.md": "Verify.\n" };
    expect(
      await errorsOf({
        ...flow,
        ...roles,
        "workers/w/worker.md": "---\nproject: null\nrole: review\n---\n",
      }),
    ).toEqual([
      "reference projects/p.yaml:2 pipeline flow, stage a: no worker of this project has role verify or implement (set worker: on the stage, or add a worker)",
    ]);
    // A project no worker takes runs nothing, as today: nothing to check.
    const idle = await load({
      ...flow,
      ...roles,
      "workers/w/worker.md": "---\nproject: q\n---\n",
      "projects/q.yaml": "path: /nonexistent/q\npipeline: flow\n",
    });
    expect(idle.errors).toEqual([]);
  });

  it("roles/ takes only the stage roles", async () => {
    expect(
      await errorsOf({
        ...pipeline(
          "start: a\nstages:\n  a:\n    role: implement\n    to: deliver\n",
        ),
        "roles/tester.md": "x",
        "roles/pm.md": "PM procedure.\n",
      }),
    ).toEqual([
      "unknown-file roles/tester.md roles/ holds one <role>.md per role (triage, spec, implement, verify, review, pm)",
    ]);
  });
});

describe("stageRunner", () => {
  const workers: StageWorkerCandidate[] = [
    { id: "builder", project: "p", role: "implement" },
    { id: "checker", project: "p", role: "verify" },
    { id: "anyone", project: null, role: "review" },
  ];
  const own = projectWorkers("p", workers);

  it("picks pm, a pinned worker, the role's worker, else the implement worker", () => {
    expect(stageRunner({ role: "pm" }, own)).toEqual({ kind: "pm" });
    expect(stageRunner({ role: "verify", worker: "anyone" }, own)).toEqual({
      kind: "worker",
      workerId: "anyone",
      fallback: false,
    });
    expect(stageRunner({ role: "verify" }, own)).toEqual({
      kind: "worker",
      workerId: "checker",
      fallback: false,
    });
    expect(stageRunner({ role: "triage" }, own)).toEqual({
      kind: "worker",
      workerId: "builder",
      fallback: true,
    });
    expect(
      stageRunner({ role: "triage" }, projectWorkers("other", workers)),
    ).toBeNull();
  });

  it("projectWorkers: the project's own workers, else the project: null ones", () => {
    expect(own.map((worker) => worker.id)).toEqual(["builder", "checker"]);
    expect(projectWorkers("other", workers).map((worker) => worker.id)).toEqual(
      ["anyone"],
    );
  });
});
