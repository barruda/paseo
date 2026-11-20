import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { Workboard } from "../server/workboard";
import {
  CHAT_INSTRUCTIONS,
  CHAT_LABEL,
  attachChatTools,
  chatTools,
} from "../server/assistant/chat";
import { Store } from "../server/store";
import { settingsSchema } from "../shared/model";
import { fixture, workspace } from "./fixtures";

const project = {
  id: "p",
  name: "Project",
  directory: "/fixture",
  isGit: true,
};

async function chat(options: { settings?: unknown } = {}) {
  const directory = path.join(
    mkdtempSync(path.join(os.tmpdir(), "pwb-chat-")),
    "chat",
  );
  const setup = fixture({
    defaultOrchestratorSeeded: true,
    ...(options.settings
      ? { settings: settingsSchema.parse(options.settings) }
      : {}),
  });
  setup.inventory.projects.push(project);
  const board = new Workboard(setup.host, setup.store, setup.now, 60000, {
    chatDirectory: directory,
  });
  await board.start();
  const events: any[] = [];
  const history = {
    list: vi.fn(async () => ({
      events: [
        {
          at: "2026-09-23T00:00:00Z",
          kind: "merged",
          taskId: "t1",
          taskTitle: "Task",
          text: "Merged",
        },
      ],
      nextCursor: null,
    })),
  };
  const tools = chatTools(() => board, history as any);
  const run = (name: string, input: Record<string, unknown> = {}) =>
    tools.find((t) => t.name === name)!.execute(input);
  return { ...setup, board, directory, tools, run, history, events };
}
const create = async (c: Awaited<ReturnType<typeof chat>>, input = {}) => {
  const result = await c.run("board_create_task", {
    title: "Fix it",
    description: "Goal",
    projectId: "p",
    ...input,
  });
  expect(result.isError).toBeUndefined();
  expect(result).not.toHaveProperty("structuredContent");
  const match = /^Created (\S+) ".*" in .* \((\S+)\)/.exec(result.text ?? "");
  if (!match) throw new Error(`Unexpected create result: ${result.text}`);
  return { taskId: match[1], column: match[2] };
};

// CUSTOM(assistant-restart-pill)
it("chat.open with fresh and archivePrevious archives the replaced chat; plain fresh does not", async () => {
  const c = await chat();
  try {
    const first = await c.board.openChat(false);
    const plain = await c.board.openChat(true);
    expect(plain.agentId).not.toBe(first.agentId);
    expect(c.host.archiveAgent).not.toHaveBeenCalled();

    const restarted = await c.board.openChat(true, true);
    expect(restarted.created).toBe(true);
    expect(restarted.agentId).not.toBe(plain.agentId);
    expect(c.store.current.assistant.chatAgentId).toBe(restarted.agentId);
    expect(c.host.archiveAgent).toHaveBeenCalledTimes(1);
    expect(c.host.archiveAgent).toHaveBeenCalledWith(plain.agentId);
    expect(await c.host.agentAlive(plain.agentId)).toBe(false);
    expect(await c.host.agentAlive(restarted.agentId)).toBe(true);
  } finally {
    c.board.dispose();
  }
});

it("chat.open creates the chat agent once, reuses it, and recreates it when archived, gone or fresh", async () => {
  const c = await chat();
  try {
    const first = await c.board.openChat(false);
    expect(first.created).toBe(true);
    expect(existsSync(c.directory)).toBe(true);
    const [cwd, start] = (c.host.startAgentIn as any).mock.calls[0];
    expect(cwd).toBe(c.directory);
    expect(start).toMatchObject({
      provider: "claude/claude-opus-5-5",
      thinkingOptionId: "high",
      modeId: null,
      title: "Projects Assistant",
      labels: { [CHAT_LABEL]: "true" },
      prompt: expect.stringContaining(CHAT_INSTRUCTIONS),
      unattended: true, // CUSTOM(unattended-automation)
    });
    // CUSTOM(hidden-board-agents): the chat itself is not a hidden board agent.
    expect(start.labels).toEqual({ [CHAT_LABEL]: "true" });
    expect(CHAT_INSTRUCTIONS).toContain('"paseo.board-agent": "true"');
    expect(
      start.prompt.startsWith("Call board_overview, then reply in one line"), // CUSTOM(agent-profiles): the role is the system prompt now
    ).toBe(true);
    expect(c.store.current.assistant.chatAgentId).toBe(first.agentId);

    expect(await c.board.openChat(false)).toEqual({
      agentId: first.agentId,
      created: false,
    });
    expect(c.host.startAgentIn).toHaveBeenCalledTimes(1);

    c.inventory.agents.find((a) => a.id === first.agentId)!.archivedAt =
      "2026-09-23T00:00:00Z";
    const second = await c.board.openChat(false);
    expect(second.created).toBe(true);
    expect(second.agentId).not.toBe(first.agentId);

    const third = await c.board.openChat(true);
    expect(third.created).toBe(true);
    expect(c.store.current.assistant.chatAgentId).toBe(third.agentId);

    c.inventory.agents.length = 0; // gone
    expect((await c.board.openChat(false)).created).toBe(true);
    expect(c.host.startAgentIn).toHaveBeenCalledTimes(4);
  } finally {
    c.board.dispose();
  }
});

it("the session_open hook attaches the tools only to the chat agent's own sessions", async () => {
  const c = await chat();
  try {
    const base = {
      agentId: "a",
      purpose: "interactive",
      tools: [] as unknown[],
    };
    const labeled = { ...base, labels: { [CHAT_LABEL]: "true" } };
    const result = attachChatTools(labeled, c.tools)!;
    expect(result.tools.map((t: any) => t.name)).toEqual([
      "board_overview",
      "board_list_tasks",
      "board_get_task",
      "board_task_diff",
      "board_create_task",
      "board_update_task",
      "board_move_task",
      "board_task_action",
      "board_set_project_policy",
      "board_set_default_action",
      "board_run_orchestrator",
      "board_reload_plugin",
      "board_history",
      "board_read_agent",
    ]);
    expect(attachChatTools({ ...base, labels: {} }, c.tools)).toBeUndefined();
    expect(
      attachChatTools({ ...base, labels: { [CHAT_LABEL]: "false" } }, c.tools),
    ).toBeUndefined();
    expect(
      attachChatTools({ ...labeled, purpose: "history" }, c.tools),
    ).toBeUndefined();
  } finally {
    c.board.dispose();
  }
});

it("create_task goes to the Backlog by default and to Ready to start with start: true", async () => {
  const c = await chat();
  try {
    const draft = await create(c);
    expect(draft.column).toBe("backlog");
    const started = await create(c, { title: "Now", start: true });
    expect(started.column).toBe("ready");
    const cards = c.board.snapshot().cards;
    expect(cards.find((x) => x.id === draft.taskId)).toMatchObject({
      title: "Fix it",
      description: "Goal",
      projectId: "p",
    });
    const list = await c.run("board_list_tasks", { column: "ready" });
    expect(list.text).toContain("Now");
    expect(list.text).not.toContain("Fix it");
    const overview = await c.run("board_overview");
    expect(overview.text).toContain("p | Project | git");
    expect(overview.text).toContain("backlog");
  } finally {
    c.board.dispose();
  }
});

it("update_task and move_task go through the board's own mutations", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    expect(
      (await c.run("board_update_task", { taskId, title: "Renamed" })).isError,
    ).toBeUndefined();
    expect(c.board.snapshot().cards[0]).toMatchObject({
      title: "Renamed",
      description: "Goal",
    });
    expect(
      (await c.run("board_move_task", { taskId, column: "ready" })).text,
    ).toContain("Moved");
    expect(c.board.snapshot().cards[0].stage).toBe("ready");
    // The board refuses a task without a workspace in In progress; the tool says so as text.
    const refused = await c.run("board_move_task", {
      taskId,
      column: "in-progress",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^Error: /);
    expect(
      (await c.run("board_move_task", { taskId, column: "nowhere" })).text,
    ).toContain("No column");
    const detail = await c.run("board_get_task", { taskId });
    expect(detail.text).toContain("Renamed");
    expect(detail.text).toContain("Delivery: none");
  } finally {
    c.board.dispose();
  }
});

it("task_action reuses the assistant actions; run_orchestrator and history work", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    const none = await c.run("board_task_action", { taskId, type: "dismiss" });
    expect(none.isError).toBe(true);
    await c.store.update((data) => {
      data.assistant.deliveries[taskId] = {
        stage: "needs-you",
        action: "notify",
        observe: false,
        attempt: 1,
        report: null,
        reason: "notify",
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        conflictFixes: 0,
        dirtyRetries: 0,
        startedAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
      };
    });
    expect(
      (await c.run("board_task_action", { taskId, type: "dismiss" })).text,
    ).toContain("dismiss");
    expect(c.store.current.assistant.deliveries[taskId].stage).toBe(
      "dismissed",
    );
    expect(
      (await c.run("board_task_action", { taskId, type: "merge-now" })).isError,
    ).toBe(true);
    expect(
      (await c.run("board_run_orchestrator", { orchestratorId: "missing" }))
        .isError,
    ).toBe(true);
    const events = await c.run("board_history", { limit: 5, taskId: "t1" });
    expect(events.text).toContain("merged | Task (t1) | Merged");
    expect(c.history.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, taskId: "t1" }),
    );
  } finally {
    c.board.dispose();
  }
});

it("read_agent refuses agents the board did not start", async () => {
  const c = await chat();
  try {
    const refused = await c.run("board_read_agent", { agentId: "stranger" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("not managed");
    await c.store.update((data) => {
      data.assistant.attempts.t = [
        {
          index: 1,
          agentId: "mine",
          orchestratorId: null,
          startedAt: "2026-09-23T00:00:00Z",
          finishedAt: null,
          outcome: "running",
          trigger: "start",
          feedback: null,
          retries: 0,
        },
      ];
    });
    const allowed = await c.run("board_read_agent", { agentId: "mine" });
    expect(allowed.text ?? "").not.toContain("not managed");
  } finally {
    c.board.dispose();
  }
});

it("no board tool returns structuredContent and board_overview text carries everything", async () => {
  const c = await chat();
  try {
    const { taskId } = await create(c);
    await c.store.update((data) => {
      data.assistant.deliveries[taskId] = {
        stage: "needs-you",
        action: "notify",
        observe: false,
        attempt: 2,
        report: null,
        reason: "notify",
        detail: null,
        verifyOutput: null,
        fixesUsed: 0,
        conflictFixes: 0,
        dirtyRetries: 0,
        startedAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
      };
    });
    for (const [name, input] of [
      ["board_overview", {}],
      ["board_list_tasks", {}],
      ["board_get_task", { taskId }],
      ["board_history", {}],
    ] as const) {
      expect(await c.run(name, input)).not.toHaveProperty("structuredContent");
    }
    const overview = (await c.run("board_overview")).text!;
    expect(overview).toContain("Projects:");
    expect(overview).toContain("Orchestrators:");
    expect(overview).toContain("Columns:");
    expect(overview).toContain("Assistant:");
    expect(overview).toMatch(
      new RegExp(`${taskId} \\| Fix it \\|.*attempt: 2.*since: .*can merge: `),
    );
    expect(overview).toContain("agent: ");
  } finally {
    c.board.dispose();
  }
});

it("project and orchestrator references resolve by id or name; unknown ones list the choices", async () => {
  const c = await chat();
  try {
    const byName = await create(c, { projectId: "project" });
    const byDirectory = await create(c, { projectId: "FIXTURE" });
    const cards = () => c.board.snapshot().cards;
    expect(cards().find((x) => x.id === byName.taskId)?.projectId).toBe("p");
    expect(cards().find((x) => x.id === byDirectory.taskId)?.projectId).toBe(
      "p",
    );

    const bad = await c.run("board_create_task", {
      title: "Lost",
      projectId: "nope",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("p (Project)");
    expect(cards().some((x) => x.title === "Lost")).toBe(false);

    await c.board.mutate({
      action: "orchestrator-save",
      orchestrator: { name: "Night Shift", enabled: false },
    } as any);
    const orchestrator = c.board.snapshot().orchestrators[0];
    expect(orchestrator.name).toBe("Night Shift");
    const badOrchestrator = await c.run("board_create_task", {
      title: "Lost",
      orchestratorId: "nope",
    });
    expect(badOrchestrator.isError).toBe(true);
    expect(badOrchestrator.text).toContain(
      `${orchestrator.id} (${orchestrator.name})`,
    );
    const named = await c.run("board_create_task", {
      title: "Named",
      orchestratorId: orchestrator.name.toUpperCase(),
    });
    expect(named.isError).toBeUndefined();

    const { taskId } = await create(c, { projectId: undefined });
    expect(
      (await c.run("board_update_task", { taskId, projectId: "Project" }))
        .isError,
    ).toBeUndefined();
    expect(cards().find((x) => x.id === taskId)?.projectId).toBe("p");
    const refused = await c.run("board_update_task", {
      taskId,
      projectId: "power-workspace",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("p (Project)");
    expect(cards().find((x) => x.id === taskId)?.projectId).toBe("p");
    await c.run("board_update_task", { taskId, projectId: null });
    expect(cards().find((x) => x.id === taskId)?.projectId).toBeNull();

    const list = await c.run("board_list_tasks", { projectId: "project" });
    expect(list.text).toContain(byName.taskId);
    expect(
      (await c.run("board_list_tasks", { projectId: "nope" })).isError,
    ).toBe(true);
  } finally {
    c.board.dispose();
  }
});

it("board_overview counts only the tasks that are not archived, like board_list_tasks", async () => {
  const c = await chat();
  try {
    const kept = await create(c, { title: "Kept" });
    const gone = await create(c, { title: "Gone" });
    expect(gone.column).toBe(kept.column);
    await c.store.update((data) => {
      data.tasks.find((t) => t.id === gone.taskId)!.archived = {
        operationId: "op",
        status: "archived",
        kind: "draft",
        stage: gone.column,
        group: null,
        startedAt: "2026-09-23T00:00:00Z",
        archivedAt: "2026-09-23T00:00:00Z",
        lastConversationAt: null,
        detail: "Draft archived",
      };
    });
    const overview = (await c.run("board_overview")).text!;
    expect(overview).toMatch(new RegExp(`- ${kept.column} \\|.*\\| 1 tasks`));
    const listed = (await c.run("board_list_tasks", { column: kept.column }))
      .text!;
    expect(listed).toContain(kept.taskId);
    expect(listed).not.toContain(gone.taskId);
  } finally {
    c.board.dispose();
  }
});

/** A repo on `task`, one commit ahead of `main`, with an uncommitted edit and a new file. */
function taskRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pwb-task-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(root, "a.txt"), "one\n");
  writeFileSync(path.join(root, "b.txt"), "two\n");
  git("add", "a.txt", "b.txt");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "task");
  writeFileSync(path.join(root, "a.txt"), "one\nmore\n");
  git("commit", "-q", "-am", "task: change a");
  writeFileSync(path.join(root, "b.txt"), "two\nedited\n");
  writeFileSync(
    path.join(root, "new.txt"),
    Array.from({ length: 400 }, (_, i) => `new line ${i}`).join("\n") + "\n",
  );
  // What the daemon writes when it creates a worktree.
  mkdirSync(path.join(root, ".git", "paseo"));
  writeFileSync(
    path.join(root, ".git", "paseo", "worktree.json"),
    JSON.stringify({
      version: 2,
      baseRefName: "main",
      baseRef: "refs/heads/main",
    }),
  );
  return { root, git };
}

async function taskWithWorktree(c: Awaited<ReturnType<typeof chat>>) {
  const repo = taskRepo();
  const { taskId } = await create(c);
  c.inventory.workspaces.push({
    ...workspace("wgit"),
    workspaceDirectory: repo.root,
    projectKind: "git",
    workspaceKind: "worktree",
  });
  await c.store.update((data) => {
    data.tasks.find((t) => t.id === taskId)!.workspaceId = "wgit";
  });
  await c.board.refresh();
  return { taskId, repo };
}

it("board_get_task shows the worktree, branch, base, commits ahead and the diffstat", async () => {
  const c = await chat();
  try {
    const bare = await create(c, { title: "No workspace" });
    expect((await c.run("board_get_task", bare)).text).toContain(
      "Worktree: none",
    );
    const { taskId, repo } = await taskWithWorktree(c);
    const info = (await c.run("board_get_task", { taskId })).text!;
    expect(info).toContain(`Worktree: ${repo.root}`);
    expect(info).toContain("Branch: task");
    expect(info).toContain("Base: main (worktree metadata)");
    expect(info).toMatch(
      /Commits ahead of base: 1 \(behind: 0\)\n- \w+ task: change a/,
    );
    expect(info).toContain("Uncommitted: 2 files");
    expect(info).toContain("- a.txt | +1 -0");
    expect(info).toContain("- b.txt | +1 -0");
    expect(info).toContain("- new.txt | +400 -0 (new, untracked)");

    // The project's base branch policy wins over the worktree's own base.
    repo.git("branch", "release", "task~1");
    await c.store.update((data) => {
      data.assistant.settings.projects.p = {
        ...(data.assistant.settings.projects.p ?? {
          action: data.assistant.settings.defaultAction,
        }),
        baseBranch: "release",
      } as any;
    });
    expect((await c.run("board_get_task", { taskId })).text).toContain(
      "Base: release (project policy)",
    );
  } finally {
    c.board.dispose();
  }
});

// CUSTOM(assistant-review-policy)
it("review policies are saved, loaded back and shown per project in board_overview", async () => {
  const c = await chat();
  try {
    const initial = c.board.assistantSettings().settings;
    expect(initial.reviews).toMatchObject({
      prj_1b497e9066c32377: "fresh-agent",
      prj_dc85fecbbf8a290e: "fresh-agent",
    });
    let overview = (await c.run("board_overview")).text!;
    expect(overview).toContain("- p | Project | git | /fixture | review: self");
    expect(overview).toContain(
      "review per project: prj_1b497e9066c32377=fresh-agent, prj_dc85fecbbf8a290e=fresh-agent, the rest self",
    );

    await c.board.setAssistantSettings({
      ...initial,
      reviews: { p: "fresh-agent", prj_1b497e9066c32377: "self" },
    });
    const reloaded = new Store(c.backing);
    await reloaded.load();
    expect(reloaded.current.assistant.settings.reviews).toEqual({
      p: "fresh-agent",
      prj_1b497e9066c32377: "self",
    });

    overview = (await c.run("board_overview")).text!;
    expect(overview).toContain(
      "- p | Project | git | /fixture | review: fresh-agent",
    );
    expect(overview).toContain(
      "review per project: Project (p)=fresh-agent, the rest self",
    );
  } finally {
    c.board.dispose();
  }
});

it("board_task_diff returns the diff against the base, truncates with a notice and never touches the worktree", async () => {
  const c = await chat();
  try {
    const bare = await create(c, { title: "No workspace" });
    expect((await c.run("board_task_diff", bare)).text).toContain(
      "Worktree: none",
    );
    const { taskId, repo } = await taskWithWorktree(c);
    const indexFile = path.join(repo.root, ".git", "index");
    const before = {
      status: repo.git("status", "--porcelain=v1", "--untracked-files=all"),
      head: repo.git("rev-parse", "HEAD"),
      index: readFileSync(indexFile),
    };

    const full = (await c.run("board_task_diff", { taskId, maxBytes: 100000 }))
      .text!;
    expect(full).toContain("Branch: task");
    expect(full).toContain("+++ b/a.txt");
    expect(full).toContain("+more");
    expect(full).toContain("+edited");
    expect(full).toContain("+++ b/new.txt");
    expect(full).toContain("+new line 399");
    expect(full).not.toContain("[Truncated");

    const cut = (await c.run("board_task_diff", { taskId, maxBytes: 1000 }))
      .text!;
    expect(cut).toContain("[Truncated: showed ");
    expect(cut).toContain("with path set to one file or folder");
    expect(cut).not.toContain("+new line 399");

    const one = (await c.run("board_task_diff", { taskId, path: "b.txt" }))
      .text!;
    expect(one).toContain("Path filter: b.txt");
    expect(one).toContain("+edited");
    expect(one).not.toContain("+++ b/a.txt");
    expect(one).not.toContain("new.txt");

    expect(repo.git("status", "--porcelain=v1", "--untracked-files=all")).toBe(
      before.status,
    );
    expect(repo.git("rev-parse", "HEAD")).toBe(before.head);
    expect(readFileSync(indexFile).equals(before.index)).toBe(true);
  } finally {
    c.board.dispose();
  }
});

// CUSTOM(assistant-autonomy): policy tools and merge-now with wait.
it("board_set_project_policy creates a policy from the default action and updates it by name", async () => {
  const c = await chat();
  try {
    const created = await c.run("board_set_project_policy", {
      project: "Project",
      baseBranch: "main",
    });
    expect(created.isError).toBeUndefined();
    expect(created).not.toHaveProperty("structuredContent");
    expect(created.text).toContain("action review");
    expect(created.text).toContain("base branch main");
    expect(c.store.current.assistant.settings.projects.p).toMatchObject({
      action: "review",
      baseBranch: "main",
    });
    const updated = await c.run("board_set_project_policy", {
      project: "p",
      action: "merge",
      verifyCommand: "npm test",
      autoFixes: 2,
      observe: true,
      review: "fresh-agent",
    });
    expect(updated.text).toContain("action merge (observe)");
    expect(updated.text).toContain("review fresh-agent");
    expect(c.store.current.assistant.settings.projects.p).toEqual({
      action: "merge",
      observe: true,
      verifyCommand: "npm test",
      autoFixes: 2,
      baseBranch: "main",
    });
    expect(c.store.current.assistant.settings.reviews.p).toBe("fresh-agent");
  } finally {
    c.board.dispose();
  }
});

it("board_set_project_policy refuses fresh-agent to self, and unknown projects list the valid ones", async () => {
  const c = await chat();
  try {
    await c.run("board_set_project_policy", {
      project: "p",
      review: "fresh-agent",
    });
    const refused = await c.run("board_set_project_policy", {
      project: "p",
      review: "self",
      action: "merge",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("only the user changes that, in Settings");
    expect(c.store.current.assistant.settings.reviews.p).toBe("fresh-agent");
    expect(c.store.current.assistant.settings.projects.p).toBeUndefined();
    const unknown = await c.run("board_set_project_policy", {
      project: "nope",
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("p (Project)");
    // self to fresh-agent and self to self are allowed.
    const c2 = await chat();
    try {
      expect(
        (
          await c2.run("board_set_project_policy", {
            project: "p",
            review: "self",
          })
        ).isError,
      ).toBeUndefined();
    } finally {
      c2.board.dispose();
    }
  } finally {
    c.board.dispose();
  }
});

it("board_set_default_action saves a default and refuses merge", async () => {
  const c = await chat();
  try {
    const result = await c.run("board_set_default_action", {
      action: "notify",
    });
    expect(result.text).toBe("Default action: notify.");
    expect(c.store.current.assistant.settings.defaultAction).toBe("notify");
    expect(
      (await c.run("board_set_default_action", { action: "merge" })).isError,
    ).toBe(true);
    expect(c.store.current.assistant.settings.defaultAction).toBe("notify");
  } finally {
    c.board.dispose();
  }
});

it("board_task_action merge-now with wait returns the final stage; without it, the background note", async () => {
  const stages = ["committing", "merging", "delivered"] as const;
  let step = 0;
  let deliveryNow: any = null;
  const fake = {
    assistantAction: vi.fn(async () => {
      deliveryNow = { stage: "committing", reason: null, detail: null };
    }),
    assistantSource: () => ({
      data: { assistant: { deliveries: { t: deliveryNow } } },
    }),
  };
  const tools = chatTools(() => fake as any, { list: vi.fn() } as any);
  const run = (input: Record<string, unknown>) =>
    tools.find((t) => t.name === "board_task_action")!.execute(input);
  const timer = setInterval(() => {
    if (deliveryNow)
      deliveryNow = { ...deliveryNow, stage: stages[Math.min(++step, 2)] };
  }, 250);
  try {
    const waited = await run({ taskId: "t", type: "merge-now", wait: true });
    expect(waited.text).toBe("merge-now for t ended at stage delivered.");
    deliveryNow = null;
    const plain = await run({ taskId: "t", type: "merge-now" });
    expect(plain.text).toContain("runs in the background");
    // A delivery that ends in needs-you reports its reason and detail.
    fake.assistantAction.mockImplementationOnce(async () => {
      deliveryNow = {
        stage: "needs-you",
        reason: "merge-conflict",
        detail: "CONFLICT in a.ts",
      };
    });
    const failed = await run({ taskId: "t", type: "merge-now", wait: true });
    expect(failed.text).toBe(
      "merge-now for t ended at stage needs-you, reason merge-conflict (CONFLICT in a.ts).",
    );
  } finally {
    clearInterval(timer);
  }
});

it("the assistant's Permissions field decides unattended; the ship agent stays unattended", async () => {
  const c = await chat();
  try {
    await c.store.update((data) => {
      data.assistant.settings.chat.modeId = "default";
    });
    await c.board.openChat(true);
    const start = (c.host.startAgentIn as any).mock.calls.at(-1)[1];
    expect(start).toMatchObject({ modeId: "default", unattended: false });
    expect(start.systemPrompt).toContain('"unattended": true');
  } finally {
    c.board.dispose();
  }
  const o = await chat();
  try {
    await o.store.update((data) => {
      data.assistant.settings.chat.provider = "opencode/deepseek/deepseek-v4";
      data.assistant.settings.chat.autoAccept = false;
    });
    await o.board.openChat(true);
    const start = (o.host.startAgentIn as any).mock.calls.at(-1)[1];
    expect(start.unattended).toBe(false);
  } finally {
    o.board.dispose();
  }
});
