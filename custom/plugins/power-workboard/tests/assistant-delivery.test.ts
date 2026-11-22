import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  dependencyRefusal,
  inPlaceCommitPlan,
  newDependencyPaths,
  porcelainPaths,
} from "../server/assistant/delivery";

it("finds new dependency folders and symlinks in porcelain status lines", () => {
  expect(
    newDependencyPaths([
      "?? node_modules",
      "?? packages/app/node_modules/",
      "A  .venv",
      '?? "web/node_modules"',
      "?? tools/venv/bin/python",
    ]),
  ).toEqual([
    "node_modules",
    "packages/app/node_modules",
    ".venv",
    "web/node_modules",
    "tools/venv/bin/python",
  ]);
});

it("ignores tracked changes and look-alike names", () => {
  expect(
    newDependencyPaths([
      " M node_modules",
      " D packages/node_modules/x.js",
      "?? docs/node_modules.md",
      "?? src/venv-setup.ts",
      "?? notes.md",
    ]),
  ).toEqual([]);
});

it("the refusal names the paths, or is null when nothing would be committed", () => {
  expect(dependencyRefusal(["?? notes.md"])).toBeNull();
  const refusal = dependencyRefusal(
    Array.from({ length: 7 }, (_, i) => `?? p${i}/node_modules`),
  );
  expect(refusal).toContain("p0/node_modules, p1/node_modules");
  expect(refusal).toContain("and 2 more");
});

// CUSTOM(orchestrator-in-place)
it("reads the paths of porcelain lines, renames and quoted names included", () => {
  expect(porcelainPaths(" M src/a.ts")).toEqual(["src/a.ts"]);
  expect(porcelainPaths("?? new dir/")).toEqual(["new dir/"]);
  expect(porcelainPaths("R  old.ts -> new.ts")).toEqual(["old.ts", "new.ts"]);
  expect(porcelainPaths('R  "a b.ts" -> "c\\"d.ts"')).toEqual([
    "a b.ts",
    'c"d.ts',
  ]);
  expect(porcelainPaths('?? "caf\\303\\251.txt"')).toEqual(["café.txt"]);
});

it("an in-place commit plan keeps the paths that were dirty before the task out", () => {
  const plan = inPlaceCommitPlan({
    current: [
      " M ProjectSettings/a.asset",
      "?? Assets/Resources/",
      "R  user-old.ts -> moved.ts",
      " M src/task.ts",
      "?? src/new.ts",
    ],
    initialDirty: [
      " M ProjectSettings/a.asset",
      "?? Assets/Resources/",
      " M user-old.ts",
      " M gone.ts",
    ],
    filesChanged: [],
    directory: "/repo",
  });
  expect(plan.paths).toEqual(["src/task.ts", "src/new.ts"]);
  expect(plan.lines).toEqual([" M src/task.ts", "?? src/new.ts"]);
  expect(plan.leftOut).toEqual([
    "ProjectSettings/a.asset",
    "Assets/Resources/",
    "user-old.ts",
  ]);
  expect(plan.overlap).toEqual([]);
});

it("an in-place commit plan flags dirty-before paths the report also changed", () => {
  const plan = inPlaceCommitPlan({
    current: [" M ProjectSettings/a.asset", "?? Assets/Resources/", " M b.ts"],
    initialDirty: [" M ProjectSettings/a.asset", "?? Assets/Resources/"],
    filesChanged: [
      "/repo/ProjectSettings/a.asset",
      "./Assets/Resources/new.json",
      "b.ts",
    ],
    directory: "/repo/",
  });
  expect(plan.overlap).toEqual([
    "ProjectSettings/a.asset",
    "Assets/Resources/",
  ]);
  expect(plan.paths).toEqual(["b.ts"]);
});

it("plans from real git status output with spaces and non-ASCII names", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pwb-in-place-plan-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" });
  const status = () =>
    git("status", "--porcelain")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(path.join(directory, "user file.txt"), "one\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    writeFileSync(path.join(directory, "user file.txt"), "two\n");
    mkdirSync(path.join(directory, "drafts"));
    writeFileSync(path.join(directory, "drafts", "x.md"), "x\n");
    const initialDirty = status();
    writeFileSync(path.join(directory, "relatório.md"), "task\n");
    writeFileSync(path.join(directory, "drafts", "y.md"), "y\n");
    const plan = inPlaceCommitPlan({
      current: status(),
      initialDirty,
      filesChanged: ["relatório.md"],
      directory,
    });
    expect(plan.paths).toEqual(["relatório.md"]);
    expect(plan.leftOut.sort()).toEqual(["drafts/", "user file.txt"]);
    expect(plan.overlap).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
