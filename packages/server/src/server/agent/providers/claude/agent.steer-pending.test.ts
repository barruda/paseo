// CUSTOM(steer-pending): which steers the Claude session reports as pending, and cancelSteer.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { asInternals } from "../../../test-utils/class-mocks.js";
import { ClaudeAgentClient } from "./agent.js";

const sdkQueryFactory = vi.fn();

interface SteerInternals {
  unstartedMessageUuids: Set<string>;
  translateMessageToEvents(message: unknown): Promise<unknown[]>;
  finishForegroundTurn(event: { type: "turn_completed"; provider: "claude" }): void;
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
    cancelAsyncMessage: vi.fn(async () => true),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/** A session with one active turn and one steer queued behind it. */
async function startSteeredSession(queryMock: ReturnType<typeof createQueryMock>) {
  sdkQueryFactory.mockImplementation(() => queryMock);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory: sdkQueryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  const changes: string[][] = [];
  session.subscribePendingSteers?.(() => changes.push(session.getPendingSteerMessageIds!()));
  const { turnId } = await session.startTurn("long task");
  const input = sdkQueryFactory.mock.calls[0]?.[0].prompt as AsyncIterable<{ uuid?: string }>;
  const iterator = input[Symbol.asyncIterator]();
  await iterator.next();
  await session.steerActiveTurn!("also this", { expectedTurnId: turnId, clientMessageId: "c1" });
  const steerUuid = (await iterator.next()).value?.uuid as string;
  return { session, changes, steerUuid, internal: asInternals<SteerInternals>(session) };
}

beforeEach(() => sdkQueryFactory.mockReset());
afterEach(() => sdkQueryFactory.mockReset());

test("a steer is pending until Claude reports its lifecycle started", async () => {
  const queryMock = createQueryMock();
  const { session, changes, steerUuid, internal } = await startSteeredSession(queryMock);
  expect(session.getPendingSteerMessageIds?.()).toEqual(["c1"]);
  expect(changes).toEqual([["c1"]]);

  await internal.translateMessageToEvents({
    type: "command_lifecycle",
    command_uuid: steerUuid,
    state: "queued",
  });
  expect(session.getPendingSteerMessageIds?.()).toEqual(["c1"]);

  await internal.translateMessageToEvents({
    type: "command_lifecycle",
    command_uuid: steerUuid,
    state: "started",
  });
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  expect(changes).toEqual([["c1"], []]);
  await session.close();
});

test("the CLI echoing the steer's user message counts as started", async () => {
  const queryMock = createQueryMock();
  const { session, steerUuid, internal } = await startSteeredSession(queryMock);
  await internal.translateMessageToEvents({
    type: "user",
    uuid: steerUuid,
    message: { role: "user", content: "also this" },
  });
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  await session.close();
});

test("cancelSteer withdraws a queued steer and reports it", async () => {
  const queryMock = createQueryMock();
  const { session, steerUuid, internal } = await startSteeredSession(queryMock);

  await expect(session.cancelSteer?.("c1")).resolves.toBe(true);

  expect(queryMock.cancelAsyncMessage).toHaveBeenCalledWith(steerUuid);
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  expect(internal.unstartedMessageUuids.has(steerUuid)).toBe(false);
  await expect(session.cancelSteer?.("c1")).resolves.toBe(false);
  await session.close();
});

test("cancelSteer is false once Claude dequeued the steer, and delivery is left alone", async () => {
  const queryMock = createQueryMock();
  queryMock.cancelAsyncMessage.mockImplementation(async () => false);
  const { session, steerUuid, internal } = await startSteeredSession(queryMock);

  await expect(session.cancelSteer?.("c1")).resolves.toBe(false);

  // No longer cancellable, so no longer pending; still withdrawable on interrupt until started.
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  expect(internal.unstartedMessageUuids.has(steerUuid)).toBe(true);
  await internal.translateMessageToEvents({
    type: "command_lifecycle",
    command_uuid: steerUuid,
    state: "started",
  });
  expect(internal.unstartedMessageUuids.has(steerUuid)).toBe(false);
  await session.close();
});

test("an unknown clientMessageId cancels nothing", async () => {
  const queryMock = createQueryMock();
  const { session } = await startSteeredSession(queryMock);
  await expect(session.cancelSteer?.("nope")).resolves.toBe(false);
  expect(queryMock.cancelAsyncMessage).not.toHaveBeenCalled();
  expect(session.getPendingSteerMessageIds?.()).toEqual(["c1"]);
  await session.close();
});

test("the end of the turn clears pending steers", async () => {
  const queryMock = createQueryMock();
  const { session, internal } = await startSteeredSession(queryMock);
  internal.finishForegroundTurn({ type: "turn_completed", provider: "claude" });
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  await session.close();
});

test("an interrupt clears pending steers", async () => {
  const queryMock = createQueryMock();
  const { session, steerUuid } = await startSteeredSession(queryMock);
  await session.interrupt();
  await vi.waitFor(() => expect(session.getPendingSteerMessageIds?.()).toEqual([]));
  await vi.waitFor(() => expect(queryMock.cancelAsyncMessage).toHaveBeenCalledWith(steerUuid));
  await session.close();
});

test("a steer submitted without a clientMessageId is not reported", async () => {
  const queryMock = createQueryMock();
  sdkQueryFactory.mockImplementation(() => queryMock);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory: sdkQueryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  const { turnId } = await session.startTurn("long task");
  await session.steerActiveTurn!("anonymous", { expectedTurnId: turnId });
  expect(session.getPendingSteerMessageIds?.()).toEqual([]);
  await session.close();
});
