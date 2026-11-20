// CUSTOM(packages): the gate runner and its bisect, without touching git or the real checkout.
import { expect, it, vi } from "vitest";
import { packageSchema, type Finish, type Task } from "../shared/model";
import { projectPolicySchema } from "../shared/assistant";
import {
  bisectPackage,
  packageMerges,
  runPackageGate,
  type GitExec,
} from "../server/package-gate";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: true,
};

const pkg = (overrides: Record<string, unknown> = {}) =>
  packageSchema.parse({
    id: "pkg-1",
    name: "Auth",
    projectId: "p",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

const task = (id: string, number: number): Task => ({
  id,
  number,
  workspaceId: null,
  title: id,
  description: "",
  projectId: "p",
  projectName: "Project",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  draftStage: "done",
  lastStage: "done",
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
  packageId: "pkg-1",
  testTier: null,
  binding: null,
});

const finish = (commit: string, at: string): Finish => ({
  running: null,
  committedAt: null,
  mergedAt: at,
  mergeCommit: commit,
  prTitle: null,
  prBody: null,
  error: null,
});

it("fails without running when a required environment variable is missing", async () => {
  const run = vi.fn();
  const result = await runPackageGate({
    pkg: pkg({
      gate: { command: "npm run gate", requiredEnv: ["DB_URL"] },
    }),
    project,
    policy: projectPolicySchema.parse({}),
    tasks: [],
    finishes: {},
    trigger: "manual",
    run,
    exec: vi.fn(),
  });
  expect(result.status).toBe("missing-deps");
  expect(result.output).toContain("DB_URL");
  expect(run).not.toHaveBeenCalled();
});

it("fails when the gate command is not configured", async () => {
  const result = await runPackageGate({
    pkg: pkg(),
    project,
    policy: projectPolicySchema.parse({}),
    tasks: [],
    finishes: {},
    trigger: "manual",
    run: vi.fn(),
    exec: vi.fn(),
  });
  expect(result.status).toBe("error");
  expect(result.output).toContain("not configured");
});

it("runs the gate with its env and passes", async () => {
  const run = vi.fn(async () => ({ passed: true, output: "ok" }));
  const result = await runPackageGate({
    pkg: pkg({
      gate: {
        command: "npm run gate",
        env: { STRICT: "1" },
        runIn: "checkout",
      },
    }),
    project,
    policy: projectPolicySchema.parse({}),
    tasks: [],
    finishes: {},
    trigger: "manual",
    run,
    exec: vi.fn(async () => "head\n"),
  });
  expect(result.status).toBe("passed");
  expect(run).toHaveBeenCalledWith(
    "npm run gate",
    "/fixture",
    expect.objectContaining({ env: expect.objectContaining({ STRICT: "1" }) }),
  );
});

it("bisects a failed gate to the first suspect merge", async () => {
  const tasks = [task("t1", 1), task("t2", 2)];
  const finishes = {
    t1: finish("good", "2026-01-02T00:00:00Z"),
    t2: finish("bad", "2026-01-03T00:00:00Z"),
  };
  let current = "bad";
  const exec: GitExec = async (args) => {
    if (args.includes("rev-parse")) return "bad\n";
    if (args.includes("checkout")) current = args.at(-1)!;
    if (args.includes("worktree") && args.includes("add"))
      current = args.at(-1)!;
    return "";
  };
  const run = vi.fn(async () => ({
    passed: current === "good",
    output: current,
  }));
  const result = await runPackageGate({
    pkg: pkg({ gate: { command: "gate" } }),
    project,
    policy: projectPolicySchema.parse({}),
    tasks,
    finishes,
    trigger: "manual",
    run,
    exec,
    gateDirectory: "/tmp/paseo-package-gate-test",
  });
  expect(result.status).toBe("failed");
  expect(result.suspectTaskId).toBe("t2");
  expect(result.suspectCommit).toBe("bad");
  expect(result.output).toContain("First failing merge: #2");
});

it("orders the package's merges by merge time", () => {
  const tasks = [task("t1", 1), task("t2", 2), task("t3", 3)];
  const finishes = {
    t1: finish("c1", "2026-01-03T00:00:00Z"),
    t2: finish("c2", "2026-01-02T00:00:00Z"),
    t3: finish("c3", "2026-01-04T00:00:00Z"),
  };
  expect(packageMerges(tasks, finishes, "pkg-1").map((m) => m.taskId)).toEqual([
    "t2",
    "t1",
    "t3",
  ]);
});

it("stops the bisect on an error instead of blaming a merge", async () => {
  const merges = [
    { taskId: "t1", number: 1, commit: "a", mergedAt: "2026-01-01" },
    { taskId: "t2", number: 2, commit: "b", mergedAt: "2026-01-02" },
  ];
  const result = await bisectPackage(merges, async () => "error");
  expect(result.suspect).toBeNull();
  expect(result.error).toContain("could not run");
});
