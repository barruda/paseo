// CUSTOM(factory): the Project Manager's autonomy presets and the PM transition rule (docs/factory.md,
// ticket 12): the preset data, its resolution and compile errors, and the texts generated from it.
import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SEED_PROMPT,
  AUTONOMY_RULE,
  CHAT_RULES,
  chatTools,
  pipelineTools,
} from "../server/assistant/chat";
import { loadFactory } from "../server/factory/loader";
import { WAKE_INSTRUCTIONS, Workboard } from "../server/workboard";
import {
  AUTONOMY_PRESETS,
  AUTONOMY_PRESET_IDS,
  USER_ONLY_REASONS,
  USER_ONLY_REASON_TEXT,
  autonomyBreakerMs,
  autonomyProjectRule,
  autonomyRulesText,
  mergeNeedsUser,
  userOnlyRefusal,
  type AutonomyPresetId,
  type UserOnlyReason,
} from "../shared/autonomy";
import { compileFactory } from "../shared/factory/compile";
import { PIPELINE_CHOICE_RULE } from "../shared/factory/engine";
import type { FactoryIssue } from "../shared/factory/schema";
import { MINIMAL_FACTORY, writeFactory } from "./factory-fixtures";
import { fixture } from "./fixtures";

/** What each preset lets go to the user, on a default project and on a critical one. */
const ACCEPTED: Record<
  AutonomyPresetId,
  { default: UserOnlyReason[]; critical: UserOnlyReason[] }
> = {
  autonomous: {
    default: ["product", "irreversible"],
    critical: ["product", "irreversible"],
  },
  standard: {
    default: ["product", "irreversible"],
    critical: ["fresh-agent", "product", "irreversible"],
  },
  cautious: {
    default: ["merge", "data-migration", "product", "irreversible"],
    critical: [
      "merge",
      "fresh-agent",
      "data-migration",
      "product",
      "irreversible",
    ],
  },
};

describe("autonomy presets", () => {
  it.each(AUTONOMY_PRESET_IDS)(
    "%s: refuses and accepts each reason, on a default and a critical project",
    (preset) => {
      for (const critical of [false, true]) {
        const accepted = USER_ONLY_REASONS.filter(
          (reason) => userOnlyRefusal(preset, critical, reason) === null,
        );
        expect(accepted).toEqual(
          [...ACCEPTED[preset][critical ? "critical" : "default"]].sort(
            (a, b) =>
              USER_ONLY_REASONS.indexOf(a) - USER_ONLY_REASONS.indexOf(b),
          ),
        );
      }
      expect(userOnlyRefusal(preset, false, "merge") ?? "").toMatch(
        preset === "cautious" ? /^$/ : /This decision is yours/,
      );
    },
  );

  it("the breaker's deadline: 15 min in Padrão and Autônomo, off in Cauteloso", () => {
    expect(autonomyBreakerMs("standard")).toBe(15 * 60_000);
    expect(autonomyBreakerMs("autonomous")).toBe(15 * 60_000);
    expect(autonomyBreakerMs("cautious")).toBeNull();
    // No preset anywhere is Padrão.
    expect(autonomyBreakerMs(null)).toBe(15 * 60_000);
    expect(autonomyBreakerMs(undefined)).toBe(15 * 60_000);
  });

  it("who merges: Padrão gives the user only a critical merge; Cauteloso every merge", () => {
    expect(mergeNeedsUser("autonomous", true)).toBe(false);
    expect(mergeNeedsUser("standard", true)).toBe(true);
    expect(mergeNeedsUser("standard", false)).toBe(false);
    expect(mergeNeedsUser("cautious", false)).toBe(true);
    expect(mergeNeedsUser(undefined, true)).toBe(true);
  });

  it("the prompt says the merge is the user's on a critical project in Padrão and the PM's on a default one", () => {
    expect(autonomyProjectRule("standard", true)).toContain(
      "the merge ok is the user's",
    );
    expect(autonomyProjectRule("standard", false)).toContain(
      "the merge is yours after an approved review",
    );
    expect(autonomyProjectRule("cautious", false)).toContain(
      "the merge ok is the user's",
    );
    expect(autonomyProjectRule("autonomous", true)).toContain(
      "the merge is yours",
    );
  });

  it("the prompt text is generated from the preset data", () => {
    expect(AUTONOMY_RULE).toBe(autonomyRulesText());
    for (const preset of Object.values(AUTONOMY_PRESETS)) {
      expect(AUTONOMY_RULE).toContain(`${preset.label} (${preset.id})`);
      for (const reason of preset.userDecides)
        expect(AUTONOMY_RULE).toContain(
          `${USER_ONLY_REASON_TEXT[reason]} [${reason}]`,
        );
    }
    for (const reason of AUTONOMY_PRESETS.standard.userDecides)
      expect(autonomyProjectRule("standard", true)).toContain(
        reason === "fresh-agent"
          ? "merge ok is the user's"
          : USER_ONLY_REASON_TEXT[reason],
      );
  });
});

describe("the rules reach the Project Manager", () => {
  const tools = [
    ...chatTools(() => ({}) as any, { list: async () => null } as any),
    ...pipelineTools(() => ({}) as any, { append: async () => null } as any),
  ];
  const description = (name: string) =>
    tools.find((tool) => tool.name === name)!.description;

  it("the pipeline choice rule is in the seed prompt, CHAT_RULES, the wake and the tool descriptions", () => {
    for (const text of [
      ASSISTANT_SEED_PROMPT,
      CHAT_RULES,
      WAKE_INSTRUCTIONS,
      description("board_pipeline_advance"),
      description("board_pipeline_ask"),
    ])
      expect(text).toContain(PIPELINE_CHOICE_RULE);
  });

  it("the preset rule replaces the open list: seed prompt, CHAT_RULES, board_pipeline_ask and pm_card_create", () => {
    for (const text of [
      ASSISTANT_SEED_PROMPT,
      CHAT_RULES,
      description("board_pipeline_ask"),
      description("pm_card_create"),
    ])
      expect(text).toContain(AUTONOMY_RULE);
    for (const text of [CHAT_RULES, WAKE_INSTRUCTIONS, ASSISTANT_SEED_PROMPT])
      expect(text).not.toContain("risky or hard to undo");
  });
});

// ---------------------------------------------------------------------------------------------

const checkout = async () =>
  realpath(await mkdtemp(path.join(os.tmpdir(), "pwb-autonomy-")));

const full = (issue: FactoryIssue) =>
  `${issue.kind} ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`;

/** Project `p` (pipeline `flow`) with worker `w`, a project-less worker `any`, plus `files`. */
async function compileWith(files: Record<string, string>) {
  const root = await writeFactory(
    {
      ...MINIMAL_FACTORY,
      "factory.yaml":
        "schemaVersion: pwb/v1alpha1\nname: m\ndefaults:\n  pipeline: flow\n",
      "roles/implement.md": "Implement.\n",
      "pipelines/flow.yaml":
        "start: a\nstages:\n  a: { role: implement, to: deliver }\n",
      "pipelines/other.yaml":
        "autonomy: cautious\nstart: a\nstages:\n  a: { role: implement, to: deliver }\n",
      "projects/p.yaml": "path: {{P}}\npipeline: flow\n",
      "workers/w/worker.md": "---\nproject: p\n---\n",
      "workers/any/worker.md": "---\nproject: null\n---\n",
      ...files,
    },
    { P: await checkout() },
  );
  const loaded = await loadFactory(root);
  const compiled = loaded.factory
    ? compileFactory(loaded.factory, { projectIdForPath: (real) => real })
        .compiled
    : null;
  return { loaded, compiled };
}

const pm = (autonomy: string) => ({
  "pm/worker.md": `---\nautonomy: ${autonomy}\n---\n\nPM.\n`,
});

describe("autonomy resolution: project > pipeline > pm > standard", () => {
  it("no autonomy anywhere is standard", async () => {
    const { compiled } = await compileWith({});
    expect(compiled!.autonomy).toBe("standard");
    expect(compiled!.projects[0]!.autonomy).toBe("standard");
    expect(compiled!.pipelines.map((p) => p.autonomy)).toEqual([
      null,
      "cautious",
    ]);
    expect(compiled!.workers.map((w) => w.autonomy)).toEqual([
      "standard",
      "standard",
    ]);
  });

  it("pm/worker.md sets the board's", async () => {
    const { compiled } = await compileWith(pm("autonomous"));
    expect(compiled!.autonomy).toBe("autonomous");
    expect(compiled!.projects[0]!.autonomy).toBe("autonomous");
  });

  it("the pipeline wins over pm/worker.md, for its projects and for projects with no file", async () => {
    const { compiled } = await compileWith({
      ...pm("autonomous"),
      "pipelines/flow.yaml":
        "autonomy: cautious\nstart: a\nstages:\n  a: { role: implement, to: deliver }\n",
    });
    // defaults.pipeline is flow: a project with no file runs it.
    expect(compiled!.autonomy).toBe("cautious");
    expect(compiled!.projects[0]!.autonomy).toBe("cautious");
  });

  it("the project wins over its pipeline; its workers hash its preset", async () => {
    const { compiled } = await compileWith({
      ...pm("cautious"),
      "projects/p.yaml": "path: {{P}}\npipeline: other\nautonomy: autonomous\n",
    });
    expect(compiled!.projects[0]!.autonomy).toBe("autonomous");
    expect(compiled!.autonomy).toBe("cautious");
    const byId = Object.fromEntries(
      compiled!.workers.map((w) => [w.id, w.autonomy]),
    );
    expect(byId).toEqual({ w: "autonomous", any: "cautious" });
  });

  it.each([
    ["pm/worker.md", pm("yolo"), "schema pm/worker.md:2 autonomy"],
    [
      "projects/p.yaml",
      { "projects/p.yaml": "path: {{P}}\npipeline: flow\nautonomy: brave\n" },
      "schema projects/p.yaml:3 autonomy",
    ],
    [
      "pipelines/flow.yaml",
      {
        "pipelines/flow.yaml":
          "start: a\nautonomy: Padrão\nstages:\n  a: { role: implement, to: deliver }\n",
      },
      "schema pipelines/flow.yaml:2 autonomy",
    ],
  ])(
    "an invalid value in %s is an error with the file and line",
    async (_file, files, expected) => {
      const { loaded } = await compileWith(files);
      expect(loaded.factory).toBeNull();
      // A broken project file also breaks the worker's reference to it.
      expect(loaded.errors.map(full)).toContainEqual(
        expect.stringContaining(expected),
      );
    },
  );
});

describe("outside active mode", () => {
  it("every project is standard, as before presets: only a fresh-agent project's merge is the user's", async () => {
    const setup = fixture({
      assistant: { settings: { reviews: { dream: "fresh-agent" } } },
    } as any);
    await setup.store.load();
    const board = new Workboard(setup.host, setup.store, () => Date.now());
    try {
      expect(board.projectAutonomy("p")).toBe("standard");
      expect(board.requiresUserMergeOk("dream")).toBe(true);
      expect(board.requiresUserMergeOk("p")).toBe(false);
      expect(board.autonomyRule("dream")).toContain(
        "the merge ok is the user's",
      );
      expect(board.userOnlyRefusal("dream", "fresh-agent")).toBeNull();
      expect(board.userOnlyRefusal("p", "fresh-agent")).toMatch(
        /the project is not critical/,
      );
    } finally {
      board.dispose();
    }
  });
});
