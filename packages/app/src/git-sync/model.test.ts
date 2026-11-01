import { describe, expect, it } from "vitest";
import {
  bringLabel,
  buildBringWorktreeCommand,
  buildResolveConflictsPrompt,
  describeIncoming,
  resolveTrailingGitChips,
  resolveWorktreeChipConflicts,
  type GitConflicts,
  type GitSyncStatus,
} from "./model";

const conflicts: GitConflicts = {
  dir: "/repo",
  operation: "merge",
  currentBranch: "trunk",
  incoming: "feature",
  files: ["a.txt", "dir/b.cs"],
};

const incoming = { path: "/mnt/disk/repo-wt1", branch: "feature", ahead: 3, dirty: false };

function status(overrides: Partial<GitSyncStatus>): GitSyncStatus {
  return {
    linkedWorktree: false,
    conflicts: null,
    mainConflicts: null,
    incoming: [],
    ...overrides,
  };
}

describe("resolveTrailingGitChips", () => {
  it("shows nothing without a status", () => {
    expect(resolveTrailingGitChips(null)).toEqual({ kind: "none" });
  });

  it("brings worktrees into a main checkout", () => {
    expect(resolveTrailingGitChips(status({ incoming: [incoming] }))).toEqual({
      kind: "bring",
      incoming: [incoming],
    });
  });

  it("puts conflicts before bringing more in", () => {
    expect(resolveTrailingGitChips(status({ conflicts, incoming: [incoming] }))).toEqual({
      kind: "resolve",
      conflicts,
    });
  });

  it("leaves a linked worktree's conflicts to its Worktree chip", () => {
    expect(resolveTrailingGitChips(status({ linkedWorktree: true, conflicts }))).toEqual({
      kind: "none",
    });
  });
});

describe("resolveWorktreeChipConflicts", () => {
  it("prefers the worktree's own conflicts, then the main checkout's", () => {
    const main = { ...conflicts, dir: "/main" };
    expect(
      resolveWorktreeChipConflicts(
        status({ linkedWorktree: true, conflicts, mainConflicts: main }),
      ),
    ).toBe(conflicts);
    expect(
      resolveWorktreeChipConflicts(status({ linkedWorktree: true, mainConflicts: main })),
    ).toBe(main);
    expect(resolveWorktreeChipConflicts(status({ conflicts }))).toBeNull();
  });
});

describe("bring chip", () => {
  it("names the worktree folder and what it has", () => {
    expect(bringLabel(incoming)).toBe("Trazer do repo-wt1");
    expect(describeIncoming(incoming)).toBe("3 commits");
    expect(describeIncoming({ ...incoming, ahead: 1, dirty: true })).toBe(
      "1 commit + mudanças não commitadas",
    );
  });

  it("commits the worktree's changes, then merges its branch here", () => {
    expect(buildBringWorktreeCommand({ ...incoming, path: "/it's here" })).toBe(
      [
        `git -C '/it'\\''s here' add -A`,
        `{ git -C '/it'\\''s here' diff --cached --quiet || git -C '/it'\\''s here' commit -m 'wip'; }`,
        `echo "Trazendo feature para $(git rev-parse --abbrev-ref HEAD)"`,
        `git merge --no-edit 'feature'`,
      ].join(" && "),
    );
  });
});

describe("buildResolveConflictsPrompt", () => {
  it("names the operation, the checkout, the files and how to finish", () => {
    const prompt = buildResolveConflictsPrompt(conflicts);
    expect(prompt).toContain("um merge de `feature` em `trunk` no checkout `/repo`");
    expect(prompt).toContain("Arquivos em conflito (2):\n- `a.txt`\n- `dir/b.cs`");
    expect(prompt).toContain("HEAD...MERGE_HEAD");
    expect(prompt).toContain("`git commit --no-edit`");
    expect(prompt.endsWith("\n")).toBe(false);
  });

  it("continues a rebase and handles conflicts without an operation", () => {
    expect(
      buildResolveConflictsPrompt({ ...conflicts, operation: "rebase", incoming: "trunk" }),
    ).toContain("`git rebase --continue`");
    const loose = buildResolveConflictsPrompt({ ...conflicts, operation: null, incoming: null });
    expect(loose).toContain("`git stash pop`");
    expect(loose).toContain("sem commitar");
  });
});
