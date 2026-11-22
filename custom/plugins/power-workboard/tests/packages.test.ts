// CUSTOM(packages): the pure package logic: tiers, gate resolution, risk globs, progress, the
// bisect and the prompt section.
import { describe, expect, it } from "vitest";
import {
  effectiveTestTier,
  findFirstFailing,
  gateRunForMerge,
  matchesRiskPath,
  missingGateEnv,
  nextPackageColor,
  packageMergeTarget,
  packageProgress,
  packageViews,
  resolvePackageGate,
  riskyPaths,
  testSectionFor,
} from "../shared/packages";
import {
  DEFAULT_GROUPS,
  dataSchema,
  packageRunSchema,
  packageSchema,
  type Finish,
  type Task,
} from "../shared/model";
import { projectPolicySchema } from "../shared/assistant";
import { orchestratorPrompt } from "../server/orchestrator";

const task = (
  id: string,
  packageId: string | null,
  tier: "restricted" | "gate" | "full" | null = null,
): Task => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  workspaceId: null,
  title: id,
  description: "",
  descriptionLength: 0,
  descriptionRevision: 0,
  projectId: "p",
  projectName: "Project",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  draftStage: "backlog",
  lastStage: "backlog",
  lastConversationAt: null,
  conversationStatus: "none",
  conversationDisplayEvidence: "none",
  conversationGateAt: null,
  conversationGateEvidence: "unknown",
  conversationReason: null,
  conversationAgents: [],
  mergedDrafts: [],
  issue: null,
  archived: null,
  orchestratorId: null,
  timing: null,
  packageId,
  testTier: tier
    ? {
        tier,
        reason: "because",
        by: "pm" as const,
        at: "2026-01-01T00:00:00Z",
      }
    : null,
  binding: null,
});

const policy = (overrides: Record<string, unknown> = {}) =>
  projectPolicySchema.parse(overrides);

const pkg = (overrides: Record<string, unknown> = {}) =>
  packageSchema.parse({
    id: "pkg-1",
    name: "Auth",
    projectId: "p",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

describe("test tiers", () => {
  it("is full without a package and restricted inside one", () => {
    expect(effectiveTestTier(task("t1", null))).toBe("full");
    expect(effectiveTestTier(task("t2", "pkg-1"))).toBe("restricted");
    expect(effectiveTestTier(task("t3", "pkg-1", "gate"))).toBe("gate");
  });

  it("builds the prompt section only inside a package", () => {
    expect(testSectionFor(task("t1", null), policy(), "Auth")).toBe("");
    const restricted = testSectionFor(
      task("t2", "pkg-1"),
      policy({ verifyCommand: "npm test" }),
      "Auth",
    );
    expect(restricted).toContain("Tests — restricted");
    expect(restricted).toContain("npm test");
    expect(restricted).toContain("Do not run the full suite");
    expect(restricted).toContain("replaces any test instruction above");
    const gate = testSectionFor(
      task("t3", "pkg-1", "gate"),
      policy({ tests: { gateCommand: "npm run gate" } }),
      "Auth",
    );
    expect(gate).toContain("Tests — gate");
    expect(gate).toContain("npm run gate");
    expect(gate).toContain("runs automatically after your turn");
  });

  it("keeps a ticket without a package on exactly today's prompt", () => {
    const without = orchestratorPrompt(
      { title: task("t1", null).title, body: "" },
      "Do it.",
    );
    expect(without).not.toContain("## Tests");
    const withPackage = orchestratorPrompt(
      { title: task("t2", "pkg-1").title, body: "" },
      "Do it.",
      false,
      testSectionFor(task("t2", "pkg-1"), policy(), "Auth"),
    );
    expect(withPackage).toContain("## Tests — restricted");
  });
});

describe("gate resolution", () => {
  it("prefers the package override, then the project's tests, then verify", () => {
    expect(
      resolvePackageGate(
        pkg({ gate: { command: "package gate" } }),
        policy({
          verifyCommand: "verify",
          tests: { gateCommand: "project gate" },
        }),
      ).command,
    ).toBe("package gate");
    expect(
      resolvePackageGate(
        pkg(),
        policy({
          verifyCommand: "verify",
          tests: { gateCommand: "project gate" },
        }),
      ).command,
    ).toBe("project gate");
    expect(
      resolvePackageGate(pkg(), policy({ verifyCommand: "verify" })).command,
    ).toBe("verify");
  });

  it("fails when a required env is missing, even if the suite would skip", () => {
    const gate = resolvePackageGate(
      pkg(),
      policy({ tests: { gateRequiredEnv: ["DB_URL", "DB_FLAG"] } }),
    );
    expect(missingGateEnv(gate, { DB_URL: "postgres://x" })).toEqual([
      "DB_FLAG",
    ]);
    expect(missingGateEnv(gate, { DB_URL: "x", DB_FLAG: "1" })).toEqual([]);
    const withEnv = resolvePackageGate(
      pkg({ gate: { env: { DB_FLAG: "1" } } }),
      policy({ tests: { gateRequiredEnv: ["DB_FLAG"] } }),
    );
    expect(missingGateEnv(withEnv, {})).toEqual([]);
  });
});

describe("risk rule", () => {
  it("matches ** across folders and * inside one segment", () => {
    expect(matchesRiskPath("db/migrations/0006.sql", "**/migrations/**")).toBe(
      true,
    );
    expect(matchesRiskPath("src/auth/login.ts", "src/auth/*.ts")).toBe(true);
    expect(matchesRiskPath("src/auth/deep/login.ts", "src/auth/*.ts")).toBe(
      false,
    );
    expect(matchesRiskPath("src/ui/button.ts", "**/migrations/**")).toBe(false);
    // A double star before the slash matches zero folders, so a root folder matches too.
    expect(matchesRiskPath("migrations/001.sql", "**/migrations/**")).toBe(
      true,
    );
    expect(matchesRiskPath("auth/login.ts", "**/auth/**")).toBe(true);
    expect(matchesRiskPath("security/policy.ts", "**/security/**")).toBe(true);
    expect(matchesRiskPath("protocol/wire.ts", "**/protocol/**")).toBe(true);
  });

  it("returns only the paths a rule escalates", () => {
    expect(
      riskyPaths(
        ["src/ui/a.ts", "db/migrations/1.sql", "src/auth/login.ts"],
        ["**/migrations/**", "src/auth/**"],
      ),
    ).toEqual(["db/migrations/1.sql", "src/auth/login.ts"]);
    expect(riskyPaths(["src/ui/a.ts"], [])).toEqual([]);
  });
});

describe("progress and views", () => {
  const finishes: Record<string, Finish> = {
    t1: {
      running: null,
      committedAt: null,
      mergedAt: "2026-01-02T00:00:00Z",
      mergeCommit: "abc",
      mergeTarget: null,
      prTitle: null,
      prBody: null,
      error: null,
    },
  };

  it("counts merged and canceled tickets", () => {
    const data = dataSchema.parse({
      packages: [pkg()],
      settings: {
        groups: [
          ...DEFAULT_GROUPS,
          {
            id: "canceled",
            kind: "canceled",
            name: null,
            label: "pwb:canceled",
          },
        ],
      },
      tasks: [
        task("t1", "pkg-1"),
        { ...task("t2", "pkg-1"), lastStage: "canceled" },
        task("t3", null),
      ],
      finishes,
    });
    expect(
      packageProgress(data.tasks, data.finishes, data.settings.groups),
    ).toEqual({
      total: 3,
      merged: 1,
      canceled: 1,
    });
    const view = packageViews(data, [{ id: "p", name: "Project" }])[0];
    expect(view.gate).not.toHaveProperty("env");
    expect(view).toMatchObject({
      name: "Auth",
      projectName: "Project",
      total: 2,
      merged: 1,
      canceled: 1,
      lastRun: null,
    });
  });

  it("keeps the last run and its suspect in the view", () => {
    const run = packageRunSchema.parse({
      id: "run-1",
      packageId: "pkg-1",
      trigger: "manual",
      status: "failed",
      startedAt: "2026-01-03T00:00:00Z",
      suspectTaskId: "t2",
    });
    const data = dataSchema.parse({
      packages: [pkg()],
      tasks: [task("t1", "pkg-1"), task("t2", "pkg-1")],
      packageRuns: [run],
    });
    const view = packageViews(data, [])[0];
    expect(view.lastRun?.id).toBe("run-1");
    expect(view.suspectTaskIds).toEqual(["t2"]);
  });
});

describe("bisect", () => {
  it("finds the first failing item with a monotonic history", async () => {
    const items = ["a", "b", "c", "d"];
    const seen: string[] = [];
    const index = await findFirstFailing(items, async (item) => {
      seen.push(item);
      return item !== "c" && item !== "d";
    });
    expect(index).toBe(2);
    expect(seen).toEqual(["b", "c"]);
  });

  it("returns null when everything passes", async () => {
    expect(await findFirstFailing([1, 2, 3], async () => true)).toBeNull();
  });
});

describe("package defaults", () => {
  it("assigns the least used color", () => {
    expect(nextPackageColor([])).toBe("gray");
    expect(
      nextPackageColor([
        pkg({ id: "a", color: "gray" }),
        pkg({ id: "b", color: "gray" }),
      ]),
    ).not.toBe("gray");
  });

  it("merges into the package branch when set, else the project's base", () => {
    expect(packageMergeTarget(pkg(), policy({ baseBranch: "main" }))).toBe(
      "main",
    );
    expect(
      packageMergeTarget(
        pkg({ branch: "pkg/auth" }),
        policy({ baseBranch: "main" }),
      ),
    ).toBe("pkg/auth");
  });

  // CUSTOM(packages): the package detail shows the gate result that covered each merge.
  it("finds the first gate run after a merge, and none before the first run", () => {
    const runs = [
      packageRunSchema.parse({
        id: "r2",
        packageId: "pkg-1",
        trigger: "manual",
        status: "passed",
        startedAt: "2026-01-03T00:00:00Z",
      }),
      packageRunSchema.parse({
        id: "r1",
        packageId: "pkg-1",
        trigger: "close",
        status: "failed",
        startedAt: "2026-01-02T00:00:00Z",
      }),
    ];
    expect(gateRunForMerge("2026-01-01T00:00:00Z", runs)?.id).toBe("r1");
    expect(gateRunForMerge("2026-01-02T12:00:00Z", runs)?.id).toBe("r2");
    expect(gateRunForMerge("2026-01-04T00:00:00Z", runs)).toBeNull();
    expect(gateRunForMerge(null, runs)).toBeNull();
  });
});
