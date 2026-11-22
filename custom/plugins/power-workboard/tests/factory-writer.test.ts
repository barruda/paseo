// CUSTOM(factory): the factory writer (docs/factory.md, ticket 10). It edits commented YAML and
// Markdown frontmatter through the `yaml` Document API, keeps the comments and commits
// `ui: <what changed>`; any top-level key works, so new fields (e.g. `autonomy`) need no code.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeEdits,
  editFrontmatter,
  editYaml,
  writeFactoryKeys,
} from "../server/factory/writer";
import { diffFields } from "../shared/factory/edits";

const PROJECT = `# yaml-language-server: $schema=../.schema/project.json
# The paseo checkout.
path: ~/projetos/paseo
pipeline: default # the usual flow
delivery:
  action: review # the PM reviews first
  baseBranch: custom
`;

const PM = `---
# The Project Manager.
model: claude/claude-opus-5-5
thinking: high # keep it sharp
---

You are the Project Manager.
`;

async function factory() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwb-writer-"));
  await mkdir(path.join(root, "projects"));
  await mkdir(path.join(root, "pm"));
  await writeFile(path.join(root, "projects", "paseo.yaml"), PROJECT);
  await writeFile(path.join(root, "pm", "worker.md"), PM);
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
  return { root, git };
}

describe("factory writer: generic keys", () => {
  it("adds and removes a new key in a commented project file and commits each change", async () => {
    const { root, git } = await factory();
    const file = path.join(root, "projects", "paseo.yaml");
    const added = await writeFactoryKeys(root, "projects/paseo.yaml", {
      autonomy: "cautious",
    });
    expect(added.files).toEqual(["projects/paseo.yaml"]);
    expect(await readFile(file, "utf8")).toBe(`${PROJECT}autonomy: cautious\n`);
    expect(added.commit).toBe(git("rev-parse", "HEAD"));
    expect(git("log", "-1", "--format=%s")).toBe("ui: projects/paseo autonomy");
    expect(git("status", "--porcelain")).toBe("");

    await writeFactoryKeys(root, "projects/paseo.yaml", { autonomy: null });
    expect(await readFile(file, "utf8")).toBe(PROJECT);
    expect(git("log", "--format=%s").split("\n")).toEqual([
      "ui: projects/paseo autonomy",
      "ui: projects/paseo autonomy",
      "fixture",
    ]);
  });

  it("adds and removes a frontmatter key of pm/worker.md and keeps its body", async () => {
    const { root, git } = await factory();
    const file = path.join(root, "pm", "worker.md");
    await writeFactoryKeys(root, "pm/worker.md", { autonomy: "autonomous" });
    expect(await readFile(file, "utf8")).toBe(
      PM.replace(
        "keep it sharp\n---",
        "keep it sharp\nautonomy: autonomous\n---",
      ),
    );
    expect(git("log", "-1", "--format=%s")).toBe("ui: pm autonomy");
    await writeFactoryKeys(root, "pm/worker.md", { autonomy: null });
    expect(await readFile(file, "utf8")).toBe(PM);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("changes nothing and commits nothing when the value is already there", async () => {
    const { root, git } = await factory();
    const result = await writeFactoryKeys(root, "projects/paseo.yaml", {
      pipeline: "default",
      missing: null,
    });
    expect(result).toEqual({ files: [], commit: null });
    expect(git("log", "--format=%s")).toBe("fixture");
  });
});

describe("factory writer: YAML edits", () => {
  it("keeps the comment and quotes of a scalar it changes", () => {
    const text = 'night: { start: "23:00", end: "05:00" } # the window\n';
    expect(editYaml(text, [{ path: ["night", "start"], value: "21:30" }])).toBe(
      'night: { start: "21:30", end: "05:00" } # the window\n',
    );
    expect(editYaml("a: 1 # one\n", [{ path: ["a"], value: 2 }])).toBe(
      "a: 2 # one\n",
    );
  });

  it("writes an inherited block whole from the target", () => {
    const target = {
      housekeeping: { autoArchive: false, archiveAfterDays: 0 },
    };
    expect(
      editYaml(
        "# board\npools: []\n",
        [{ path: ["housekeeping", "autoArchive"], value: false }],
        target,
      ),
    ).toBe(
      "# board\npools: []\nhousekeeping:\n  autoArchive: false\n  archiveAfterDays: 0\n",
    );
    // A list item is set in place; a missing parent without a target becomes maps.
    expect(
      editYaml("columns:\n  - id: a # first\n  - id: b\n", [
        { path: ["columns", 1, "name"], value: "B" },
      ]),
    ).toBe("columns:\n  - id: a # first\n  - id: b\n    name: B\n");
    expect(
      editYaml("{}\n", [{ path: ["wake", "delaySeconds"], value: 5 }]),
    ).toBe("{ wake: { delaySeconds: 5 } }\n");
  });

  it("replaces a Markdown body and keeps the frontmatter as it is", () => {
    expect(editFrontmatter(PM, [], "New prompt.")).toBe(
      PM.replace("You are the Project Manager.", "New prompt."),
    );
  });

  it("diffs key by key, item by item, and replaces anything else whole", () => {
    expect(
      diffFields(
        { a: 1, b: { c: 2, d: 3 }, list: [{ x: 1 }], gone: true },
        { a: 1, b: { c: 4, d: 3 }, list: [{ x: 2 }], added: [1] },
      ),
    ).toEqual([
      { path: ["b", "c"], value: 4 },
      { path: ["list", 0, "x"], value: 2 },
      { path: ["gone"], remove: true },
      { path: ["added"], value: [1] },
    ]);
  });

  it("names the files and keys it changed in the commit subject", () => {
    expect(
      describeEdits(
        [
          { file: "workers/paseo/worker.md", fields: [{ path: ["model"] }] },
          { file: "workers/paseo/worker.md", body: "x" },
          { file: "board.yaml", fields: [{ path: ["night", "start"] }] },
          { file: "workers/old", removeFolder: true },
          { file: "workers/new/worker.md", create: "---\n---\n" },
        ],
        ["workers/new/worker.md"],
      ),
    ).toBe(
      "ui: workers/paseo model, prompt; board night; remove workers/old; add workers/new",
    );
    const long = describeEdits(
      Array.from({ length: 20 }, (_, index) => ({
        file: `projects/project-${index}.yaml`,
        fields: [{ path: ["delivery"] }],
      })),
    );
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
  });
});
