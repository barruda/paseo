import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
// CUSTOM(auto-archive-skip-pinned)
import { getUnpinnedAt, hasPinnedLabel, stampUnpin } from "@getpaseo/protocol/agent-labels";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  createAutoArchiveClosed,
  selectAgentsToAutoArchive,
  selectWorktreesToAutoArchive,
  type AutoArchiveRecord,
  type AutoArchiveWorkspace,
  type AutoArchiveWorkspaceAgent,
} from "./index.js";
import { isWorktreeSafeToArchive } from "./worktree-safety.js";

const DAY = 24 * 60 * 60_000;
const NOW = 100 * DAY;

function rec(id: string, patch: Partial<AutoArchiveRecord> & { ageDays?: number } = {}) {
  const { ageDays = 3, ...rest } = patch;
  return {
    id,
    parentAgentId: null,
    archived: false,
    live: false,
    hasOpenTab: false,
    prompted: true,
    pinned: false,
    unpinnedAt: null,
    updatedAt: NOW - ageDays * DAY,
    ...rest,
  } satisfies AutoArchiveRecord;
}

test("off selects nothing", () => {
  expect(selectAgentsToAutoArchive([rec("a", { ageDays: 90 })], NOW, 0)).toEqual([]);
});

// CUSTOM(archive-promptless)
test("an agent that never got a user message is selected as soon as it is closed", () => {
  expect(selectAgentsToAutoArchive([rec("p", { ageDays: 0, prompted: false })], NOW, 2)).toEqual([
    "p",
  ]);
});

// CUSTOM(archive-promptless)
test("a promptless agent that is live or open in a tab, or a young prompted one, is kept", () => {
  const records = [
    rec("live", { ageDays: 0, prompted: false, live: true }),
    rec("open", { ageDays: 0, prompted: false, hasOpenTab: true }),
    rec("young", { ageDays: 0 }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual([]);
});

// CUSTOM(archive-promptless)
test("off disables the promptless rule too", () => {
  expect(selectAgentsToAutoArchive([rec("p", { ageDays: 0, prompted: false })], NOW, 0)).toEqual(
    [],
  );
});

test("only agents idle for more than the threshold are selected", () => {
  const records = [
    rec("old", { ageDays: 2.5 }),
    rec("edge", { ageDays: 2 }),
    rec("new", { ageDays: 1 }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["old"]);
});

test("archived, live and open-tab agents are skipped", () => {
  const records = [
    rec("archived", { archived: true }),
    rec("live", { live: true }),
    rec("open", { hasOpenTab: true }),
    rec("ok"),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["ok"]);
});

test("a parent with a live, open or recent child is skipped, but quiet old children stand alone", () => {
  for (const child of [
    rec("c", { parentAgentId: "p", live: true }),
    rec("c", { parentAgentId: "p", hasOpenTab: true }),
    rec("c", { parentAgentId: "p", ageDays: 1 }),
  ]) {
    expect(selectAgentsToAutoArchive([rec("p"), child], NOW, 2)).toEqual([]);
  }
  const quietSibling = rec("quiet", { parentAgentId: "p" });
  const busy = rec("busy", { parentAgentId: "p", live: true });
  expect(selectAgentsToAutoArchive([rec("p"), busy, quietSibling], NOW, 2)).toEqual(["quiet"]);
});

test("a descendant two levels down blocks the root too", () => {
  const records = [
    rec("root"),
    rec("mid", { parentAgentId: "root" }),
    rec("leaf", { parentAgentId: "mid", live: true }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual([]);
});

test("an eligible parent is archived once; its old closed children ride the cascade", () => {
  const records = [
    rec("p"),
    rec("c1", { parentAgentId: "p" }),
    rec("c2", { parentAgentId: "c1", archived: false }),
    rec("done", { parentAgentId: "p", archived: true, live: true }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["p"]);
});

test("the sweep archives sequentially, reads days live and rechecks each agent", async () => {
  let days = 0;
  const archived: string[] = [];
  let active = 0;
  const auto = createAutoArchiveClosed({
    days: () => days,
    records: async () => [rec("a"), rec("b"), rec("c")],
    stillEligible: async (id) => id !== "b",
    archive: async (id) => {
      active++;
      expect(active).toBe(1);
      await Promise.resolve();
      archived.push(id);
      active--;
    },
    logger: createTestLogger(),
    now: () => NOW,
    initialDelayMs: 10 * DAY,
    intervalMs: 10 * DAY,
  });
  try {
    expect(await auto.sweep()).toBe(0);
    days = 2;
    expect(await auto.sweep()).toBe(2);
    expect(archived).toEqual(["a", "c"]);
  } finally {
    await auto.close();
  }
});

test("sweepSoon sweeps once after the delay, restarting the wait on each call", async () => {
  vi.useFakeTimers();
  try {
    let sweeps = 0;
    const auto = createAutoArchiveClosed({
      days: () => 2,
      records: async () => {
        sweeps++;
        return [];
      },
      stillEligible: async () => true,
      archive: async () => {},
      logger: createTestLogger(),
      now: () => NOW,
      initialDelayMs: 10 * DAY,
      intervalMs: 10 * DAY,
      soonDelayMs: 1000,
    });
    auto.sweepSoon();
    await vi.advanceTimersByTimeAsync(600);
    auto.sweepSoon();
    await vi.advanceTimersByTimeAsync(600);
    expect(sweeps).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(sweeps).toBe(1);
    await auto.close();
  } finally {
    vi.useRealTimers();
  }
});

// CUSTOM(auto-archive-worktrees)
function ws(id: string, patch: Partial<AutoArchiveWorkspace> = {}): AutoArchiveWorkspace {
  return { id, archived: false, kind: "worktree", paseoOwned: true, busy: false, ...patch };
}
function wsAgent(
  workspaceId: string,
  patch: Partial<AutoArchiveWorkspaceAgent> = {},
): AutoArchiveWorkspaceAgent {
  return { workspaceId, archived: true, live: false, hasOpenTab: false, pinned: false, ...patch };
}

test("a worktree whose agents are all archived is selected", () => {
  expect(selectWorktreesToAutoArchive([ws("w")], [wsAgent("w"), wsAgent("w")])).toEqual(["w"]);
});

test("a worktree is kept while an agent is unarchived, live or open in a tab", () => {
  expect(
    selectWorktreesToAutoArchive([ws("w")], [wsAgent("w"), wsAgent("w", { archived: false })]),
  ).toEqual([]);
  expect(selectWorktreesToAutoArchive([ws("w")], [wsAgent("w", { live: true })])).toEqual([]);
  expect(selectWorktreesToAutoArchive([ws("w")], [wsAgent("w", { hasOpenTab: true })])).toEqual([]);
});

// CUSTOM(auto-archive-skip-pinned)
test("a worktree with a pinned chat is kept, even when the chat is archived", () => {
  expect(
    selectWorktreesToAutoArchive([ws("w")], [wsAgent("w"), wsAgent("w", { pinned: true })]),
  ).toEqual([]);
});

test("a worktree with no agents is never selected", () => {
  expect(selectWorktreesToAutoArchive([ws("w")], [wsAgent("other")])).toEqual([]);
});

test("only active Paseo-owned worktrees that are not busy are selected", () => {
  const agents = ["a", "b", "c", "d", "e"].map((id) => wsAgent(id));
  const workspaces = [
    ws("a", { kind: "local_checkout" }),
    ws("b", { kind: "directory" }),
    ws("c", { archived: true }),
    ws("d", { paseoOwned: false }),
    ws("e", { busy: true }),
  ];
  expect(selectWorktreesToAutoArchive(workspaces, agents)).toEqual([]);
});

test("the sweep archives worktrees after the agent pass, only the safe ones", async () => {
  const order: string[] = [];
  const auto = createAutoArchiveClosed({
    days: () => 2,
    records: async () => [rec("a")],
    stillEligible: async () => true,
    archive: async (id) => {
      order.push(`agent:${id}`);
    },
    workspaces: {
      records: async () => ({
        workspaces: [ws("w1"), ws("w2")],
        agents: [wsAgent("w1"), wsAgent("w2")],
      }),
      safe: async (id) => id === "w1",
      archive: async (id) => {
        order.push(`workspace:${id}`);
      },
    },
    logger: createTestLogger(),
    now: () => NOW,
    initialDelayMs: 10 * DAY,
    intervalMs: 10 * DAY,
  });
  try {
    await auto.sweep();
    expect(order).toEqual(["agent:a", "workspace:w1"]);
  } finally {
    await auto.close();
  }
});

test("the workspace pass does not run when the agent sweep is off", async () => {
  const archive = vi.fn(async () => {});
  const auto = createAutoArchiveClosed({
    days: () => 0,
    records: async () => [],
    stillEligible: async () => true,
    archive: async () => {},
    workspaces: {
      records: async () => ({ workspaces: [ws("w")], agents: [wsAgent("w")] }),
      safe: async () => true,
      archive,
    },
    logger: createTestLogger(),
    now: () => NOW,
    initialDelayMs: 10 * DAY,
    intervalMs: 10 * DAY,
  });
  try {
    await auto.sweep();
    expect(archive).not.toHaveBeenCalled();
  } finally {
    await auto.close();
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

function withWorktree(run: (worktree: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "auto-archive-worktree-")));
    try {
      const repo = path.join(root, "repo");
      mkdirSync(repo);
      git(repo, "init", "-b", "main");
      writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", ".");
      git(repo, "commit", "-m", "init");
      const worktree = path.join(root, "wt");
      git(repo, "worktree", "add", "-b", "feature", worktree);
      await run(worktree);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test(
  "a clean worktree already in its base is safe",
  withWorktree(async (worktree) => {
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: "main" })).toBe(true);
  }),
);

test(
  "a worktree with an unmerged commit is not safe",
  withWorktree(async (worktree) => {
    writeFileSync(path.join(worktree, "b.txt"), "b\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "work");
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: "main" })).toBe(false);
  }),
);

test(
  "a worktree with an untracked file is not safe",
  withWorktree(async (worktree) => {
    writeFileSync(path.join(worktree, "scratch.txt"), "x\n");
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: "main" })).toBe(false);
  }),
);

test(
  "ignored node_modules do not make a worktree unsafe",
  withWorktree(async (worktree) => {
    mkdirSync(path.join(worktree, "node_modules"));
    writeFileSync(path.join(worktree, "node_modules", "x.js"), "x\n");
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: "main" })).toBe(true);
  }),
);

test(
  "a missing or unresolvable base, or a missing directory, is not safe",
  withWorktree(async (worktree) => {
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: null })).toBe(false);
    expect(await isWorktreeSafeToArchive({ worktreeRoot: worktree, baseRef: "nope" })).toBe(false);
    expect(
      await isWorktreeSafeToArchive({ worktreeRoot: path.join(worktree, "gone"), baseRef: "main" }),
    ).toBe(false);
  }),
);

// CUSTOM(auto-archive-skip-pinned)
test("a closed pinned agent older than the threshold is kept; an unpinned one is archived", () => {
  const records = [
    rec("pinned", { ageDays: 30, pinned: true }),
    rec("pinned-promptless", { ageDays: 0, prompted: false, pinned: true }),
    rec("plain", { ageDays: 30 }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual(["plain"]);
});

// CUSTOM(auto-archive-skip-pinned)
test("a pinned child keeps its parent out of the cascade", () => {
  const records = [
    rec("parent", { ageDays: 30 }),
    rec("child", { ageDays: 30, parentAgentId: "parent", pinned: true }),
  ];
  expect(selectAgentsToAutoArchive(records, NOW, 2)).toEqual([]);
});

// CUSTOM(auto-archive-skip-pinned)
test("unpinning restarts the clock: an old session is kept for the threshold after the unpin", () => {
  const justUnpinned = [
    rec("old", { ageDays: 30, unpinnedAt: NOW }),
    rec("promptless", { ageDays: 30, prompted: false, unpinnedAt: NOW - 1 * DAY }),
  ];
  expect(selectAgentsToAutoArchive(justUnpinned, NOW, 2)).toEqual([]);
  const unpinnedLongAgo = [rec("old", { ageDays: 30, unpinnedAt: NOW - 2.5 * DAY })];
  expect(selectAgentsToAutoArchive(unpinnedLongAgo, NOW, 2)).toEqual(["old"]);
});

// CUSTOM(auto-archive-skip-pinned)
test("the unpin stamp is set only when the last pin label goes", () => {
  const iso = new Date(NOW).toISOString();
  const pinnedTwice = { "paseo.pinned.desktop": "true", "paseo.pinned.phone": "true" };
  const oneLeft = stampUnpin(pinnedTwice, { ...pinnedTwice, "paseo.pinned.phone": "false" }, iso);
  expect(hasPinnedLabel(oneLeft)).toBe(true);
  expect(getUnpinnedAt(oneLeft)).toBeNull();
  const none = stampUnpin(oneLeft, { ...oneLeft, "paseo.pinned.desktop": "false" }, iso);
  expect(hasPinnedLabel(none)).toBe(false);
  expect(getUnpinnedAt(none)).toBe(NOW);
  expect(stampUnpin({}, { other: "x" }, iso)).toEqual({ other: "x" });
});
