// CUSTOM(background-tools): stopBackgroundTask stops only tasks Claude reported live.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { asInternals } from "../../../test-utils/class-mocks.js";
import { ClaudeAgentClient } from "./agent.js";

const sdkQueryFactory = vi.fn();

interface StopInternals {
  translateMessageToEvents(message: unknown): Promise<unknown[]>;
}

function createQueryMock() {
  return {
    next: vi.fn(() => new Promise<never>(() => {})),
    interrupt: vi.fn(async () => undefined),
    return: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    getContextUsage: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => []),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    stopTask: vi.fn(async () => undefined),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function createClient() {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory: sdkQueryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });
}

async function startSessionWithTask(queryMock: ReturnType<typeof createQueryMock>) {
  sdkQueryFactory.mockImplementation(() => queryMock);
  const session = await createClient().createSession({ provider: "claude", cwd: process.cwd() });
  await session.startTurn("go");
  await asInternals<StopInternals>(session).translateMessageToEvents({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [{ task_id: "t1", task_type: "local_bash", description: "dev server" }],
  });
  return session;
}

beforeEach(() => sdkQueryFactory.mockReset());
afterEach(() => sdkQueryFactory.mockReset());

test("a known task is stopped through the query", async () => {
  const queryMock = createQueryMock();
  const session = await startSessionWithTask(queryMock);
  await expect(session.stopBackgroundTask?.("t1")).resolves.toBe(true);
  expect(queryMock.stopTask).toHaveBeenCalledWith("t1");
  await session.close();
});

test("an unknown task id is rejected", async () => {
  const queryMock = createQueryMock();
  const session = await startSessionWithTask(queryMock);
  await expect(session.stopBackgroundTask?.("nope")).resolves.toBe(false);
  expect(queryMock.stopTask).not.toHaveBeenCalled();
  await session.close();
});

test("a failing stop returns false", async () => {
  const queryMock = createQueryMock();
  queryMock.stopTask.mockRejectedValueOnce(new Error("boom"));
  const session = await startSessionWithTask(queryMock);
  await expect(session.stopBackgroundTask?.("t1")).resolves.toBe(false);
  await session.close();
});

// CUSTOM(shell-row-loading): the tool call that started a task travels with it, whichever of
// task_started and background_tasks_changed lands first.
test("background tools carry the tool call that started them", async () => {
  sdkQueryFactory.mockImplementation(() => createQueryMock());
  const session = await createClient().createSession({ provider: "claude", cwd: process.cwd() });
  await session.startTurn("go");
  const internals = asInternals<StopInternals>(session);
  await internals.translateMessageToEvents({
    type: "assistant",
    message: {
      id: "m1",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_build",
          name: "Bash",
          input: { command: "npm run build", run_in_background: true },
        },
      ],
    },
    parent_tool_use_id: null,
    uuid: "a1",
  });
  const changed = {
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [{ task_id: "t1", task_type: "local_bash", description: "Build" }],
  };
  await expect(internals.translateMessageToEvents(changed)).resolves.toEqual([
    {
      type: "background_tasks_changed",
      provider: "claude",
      tasks: [{ id: "t1", kind: "shell", description: "Build" }],
    },
  ]);
  await expect(
    internals.translateMessageToEvents({
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      tool_use_id: "toolu_build",
      task_type: "local_bash",
      description: "Build",
    }),
  ).resolves.toContainEqual({
    type: "background_tasks_changed",
    provider: "claude",
    tasks: [
      {
        id: "t1",
        kind: "shell",
        description: "Build",
        command: "npm run build",
        toolCallId: "toolu_build",
      },
    ],
  });
  await expect(internals.translateMessageToEvents({ ...changed, tasks: [] })).resolves.toEqual([
    { type: "background_tasks_changed", provider: "claude", tasks: [] },
  ]);
  await session.close();
});

test("without a query nothing is stopped", async () => {
  const session = await createClient().createSession({ provider: "claude", cwd: process.cwd() });
  await expect(session.stopBackgroundTask?.("t1")).resolves.toBe(false);
  await session.close();
});
