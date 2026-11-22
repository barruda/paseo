// CUSTOM(factory): the pipeline editor's writes (docs/factory.md, ticket 14): Save writes
// pipelines/<id>.yaml through the factory writer and commits; the autonomy comboboxes set or
// remove `autonomy` in pipelines/<id>.yaml and projects/<id>.yaml.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autonomyOfChoice,
  autonomyOptions,
  autonomySummary,
  INHERIT_AUTONOMY,
  pipelineInheritedAutonomy,
  projectInheritedAutonomy,
} from "../client/pipeline-view";
import { pipelineStrings } from "../client/pipeline-strings";
import {
  FACTORY_CHANGED_ERROR,
  FACTORY_PIPELINE_MISSING_ERROR,
} from "../server/factory/shadow";
import { factoryPipelinesView } from "../shared/factory/active";
import {
  moveNode,
  renameStage,
  startDraft,
  updateStage,
  type PipelineDraft,
} from "../shared/factory/pipeline-edit";
import { factoryPipelineSaveRpc, factoryPipelinesRpc } from "../shared/rpc";
import {
  boot,
  disposeBooted,
  gitLog,
  gitOut,
  readRoot,
  temp,
  type Booted,
} from "./factory-boot";

afterEach(disposeBooted);

const FLOW = `# yaml-language-server: $schema=../.schema/pipeline.json
description: The fixture's two-step flow
start: implement
stages:
  # Write the code.
  implement:
    role: implement
    prompt: Implement it.
    to: check # then the checks
  check:
    role: verify # evidence, always
    to:
      - stage: deliver
        when: Every check passed.
      - stage: implement
        when: A check failed.
# Editor positions only.
layout:
  implement: { x: 0, y: 0 }
  check: { x: 0, y: 128 }
  deliver: { x: 0, y: 256 }
`;

const PM_STANDARD = `---
model: claude/claude-sonnet-5-5
thinking: high
autonomy: cautious # the board's preset
---

You are the factory's Project Manager.
`;

const bootFlow = () =>
  boot({
    files: {
      "pipelines/flow.yaml": FLOW,
      "pm/worker.md": PM_STANDARD,
      "roles/verify.md": "Verify it, with evidence.\n",
    },
  });

const view = (s: Booted) =>
  factoryPipelinesRpc.output.parse(factoryPipelinesView(s.factory.applied()!));

const draftOf = (s: Booted) => startDraft(view(s).pipelines.flow!);
const save = (s: Booted, draft: PipelineDraft) => {
  const input = factoryPipelineSaveRpc.input.parse({
    id: "flow",
    base: draft.base,
    pipeline: draft.pipeline,
    renames: draft.renames,
  });
  return s.factory.writePipeline(
    input.id,
    input.base,
    input.pipeline,
    input.renames,
  );
};
const ok = (result: PipelineDraft | { error: string }): PipelineDraft => {
  if ("error" in result) throw new Error(result.error);
  return result;
};

describe("pipeline editor: Save", () => {
  it("writes the edits into the commented YAML, renames keys in place, and commits", async () => {
    const s = await bootFlow();
    let draft = ok(renameStage(draftOf(s), "check", "verify"));
    draft = updateStage(draft, "verify", { session: "fresh", maxVisits: 4 });
    draft = moveNode(
      draft,
      "implement",
      { x: 40, y: 0 },
      draft.pipeline.layout!,
    );
    await save(s, draft);

    expect(await readRoot(s.root, "pipelines/flow.yaml"))
      .toBe(`# yaml-language-server: $schema=../.schema/pipeline.json
description: The fixture's two-step flow
start: implement
stages:
  # Write the code.
  implement:
    role: implement
    prompt: Implement it.
    to: verify # then the checks
  verify:
    role: verify # evidence, always
    to:
      - stage: deliver
        when: Every check passed.
      - stage: implement
        when: A check failed.
    session: fresh
    maxVisits: 4
# Editor positions only.
layout:
  implement: { x: 40, y: 0 }
  verify: { x: 0, y: 128 }
  deliver: { x: 0, y: 256 }
`);
    expect(gitLog(s.root)[0]).toBe("ui: pipelines/flow stages, layout");
    expect(gitOut(s.root, "status", "--porcelain")).toBe("");
    // The reply already reads the new pipeline.
    expect(view(s).pipelines.flow!.stages.verify).toMatchObject({
      role: "verify",
      session: "fresh",
    });
  });

  it("writes nothing and commits nothing when the draft is unchanged", async () => {
    const s = await bootFlow();
    await save(s, draftOf(s));
    expect(gitLog(s.root)).toEqual(["fixture"]);
  });

  it("refuses a draft whose base is no longer the file", async () => {
    const s = await bootFlow();
    const draft = draftOf(s);
    const stale = {
      ...draft,
      base: { ...draft.base, description: "Older" },
      pipeline: { ...draft.pipeline, description: "Mine" },
    };
    await expect(save(s, stale)).rejects.toThrow(FACTORY_CHANGED_ERROR);
    await expect(
      s.factory.writePipeline("gone", draft.base, draft.pipeline, {}),
    ).rejects.toThrow(FACTORY_PIPELINE_MISSING_ERROR);
    expect(gitLog(s.root)).toEqual(["fixture"]);
  });

  it("undoes an edit the factory rejects across files (a pinned worker that does not exist)", async () => {
    const s = await bootFlow();
    const draft = updateStage(draftOf(s), "check", { worker: "ghost" });
    await expect(save(s, draft)).rejects.toThrow(
      /The factory edit is invalid: pipelines\/flow\.yaml/,
    );
    expect(await readRoot(s.root, "pipelines/flow.yaml")).toBe(FLOW);
    expect(gitLog(s.root)).toEqual(["fixture"]);
  });

  it("keeps an autonomy set meanwhile: Save never writes the key", async () => {
    const s = await bootFlow();
    const draft = updateStage(draftOf(s), "implement", { session: "fresh" });
    await s.factory.setAutonomy("pipeline", "flow", "autonomous");
    await save(s, draft);
    const text = await readRoot(s.root, "pipelines/flow.yaml");
    expect(text).toContain("autonomy: autonomous");
    expect(text).toContain("    session: fresh\n");
  });
});

describe("pipeline editor: autonomy", () => {
  const s_ = pipelineStrings("pt");

  it("shows the inherited value: pipeline from pm/worker.md, project from its pipeline", async () => {
    const s = await bootFlow();
    let current = view(s);
    expect(current.pmAutonomy).toBe("cautious");
    expect(pipelineInheritedAutonomy(current)).toBe("cautious");
    // Project p runs `simple`, which sets none: it inherits pm/worker.md's.
    expect(projectInheritedAutonomy(current, "p")).toBe("cautious");
    expect(
      autonomyOptions(projectInheritedAutonomy(current, "p"), s_)[0],
    ).toEqual({
      value: INHERIT_AUTONOMY,
      label: "Herdar (Cauteloso)",
    });
    await s.factory.setAutonomy("pipeline", "simple", "autonomous");
    current = view(s);
    expect(projectInheritedAutonomy(current, "p")).toBe("autonomous");
    expect(
      autonomyOptions(projectInheritedAutonomy(current, "p"), s_)[0].label,
    ).toBe("Herdar (Autônomo)");
    // With nothing set anywhere, Padrão.
    expect(pipelineInheritedAutonomy({ ...current, pmAutonomy: null })).toBe(
      "standard",
    );
  });

  it("a pipeline preset is written and committed; Herdar removes the key", async () => {
    const s = await bootFlow();
    await s.factory.setAutonomy("pipeline", "flow", "standard");
    expect(await readRoot(s.root, "pipelines/flow.yaml")).toContain(
      "\nautonomy: standard\n",
    );
    expect(gitLog(s.root)[0]).toBe("ui: pipelines/flow autonomy");
    expect(view(s).pipelines.flow!.autonomy).toBe("standard");

    await s.factory.setAutonomy(
      "pipeline",
      "flow",
      autonomyOfChoice("inherit"),
    );
    expect(await readRoot(s.root, "pipelines/flow.yaml")).toBe(FLOW);
    expect(gitLog(s.root).slice(0, 2)).toEqual([
      "ui: pipelines/flow autonomy",
      "ui: pipelines/flow autonomy",
    ]);
    expect(view(s).pipelines.flow!.autonomy).toBeUndefined();
    // Inherit again is no edit.
    await s.factory.setAutonomy("pipeline", "flow", null);
    expect(gitLog(s.root)).toHaveLength(3);
  });

  it("a project preset goes to its projects/<id>.yaml, keeping its comments", async () => {
    const s = await bootFlow();
    await s.factory.setAutonomy("project", "p", "autonomous");
    const text = await readRoot(s.root, "projects/proj.yaml");
    expect(text).toContain("# The fixture project.");
    expect(text).toContain("  action: review # the PM reviews first");
    expect(text).toContain("\nautonomy: autonomous\n");
    expect(gitLog(s.root)[0]).toBe("ui: projects/proj autonomy");
    expect(view(s).projectAutonomy).toEqual({ p: "autonomous" });
    expect(s.factory.applied()!.compiled.projects[0]!.autonomy).toBe(
      "autonomous",
    );

    await s.factory.setAutonomy("project", "p", null);
    expect(await readRoot(s.root, "projects/proj.yaml")).not.toContain(
      "autonomy",
    );
    expect(view(s).projectAutonomy).toEqual({});
    expect(gitLog(s.root)).toHaveLength(3);
  });

  it("a project with no file gets one with its path and the preset", async () => {
    const s = await bootFlow();
    const other = path.join(await temp("pwb-editor-"), "other-app");
    await mkdir(other);
    s.inventory.projects.push({
      id: "q",
      name: "Other",
      directory: other,
      isGit: false,
    });
    await s.board.refresh();
    await s.factory.setAutonomy("project", "q", null);
    expect(gitLog(s.root)).toEqual(["fixture"]);
    await s.factory.setAutonomy("project", "q", "cautious");
    const text = await readRoot(s.root, "projects/other-app.yaml");
    expect(text).toContain(`path: ${JSON.stringify(other)}`);
    expect(text).toContain("autonomy: cautious");
    expect(gitLog(s.root)[0]).toBe("ui: add projects/other-app");
    expect(view(s).projectAutonomy).toMatchObject({ q: "cautious" });
  });

  it("the summary line comes from the preset's data", () => {
    expect(autonomySummary("autonomous", s_)).toBe(
      "O usuário decide: decisões de produto; ações sem backup e sem volta. Disjuntor: 15 min.",
    );
    expect(autonomySummary("cautious", s_)).toMatch(/Disjuntor: desligado\.$/);
    expect(autonomySummary("standard", pipelineStrings("en"))).toBe(
      "The user decides: the merge ok of a critical project; product decisions; actions with no backup and no revert. Breaker: 15 min.",
    );
  });
});
