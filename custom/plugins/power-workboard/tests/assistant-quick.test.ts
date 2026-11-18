import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickInbox, type QuickInboxDeps } from "../server/assistant/quick";
import { quickAckTool } from "../server/assistant/chat";
import {
  agentLink,
  classifyReply,
  normalizeAckStatus,
  quickPrompt,
  type QuickMessage,
} from "../shared/quick";
import {
  assistantTopic,
  conversationTarget,
  pickAssistantAgent,
  quickLabel,
  quickPollMs,
  quickVisual,
  type AssistantAgentEntry,
  type AssistantSummary,
} from "../client/assistant/quick-format";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(overrides: Partial<QuickInboxDeps> = {}) {
  const state = {
    activity: "running" as "idle" | "running" | "error" | null,
    reply: null as string | null,
  };
  const send = vi.fn(async (_id: string, _text: string) => undefined);
  const inbox = new QuickInbox({
    openChat: async () => "agent-1",
    send,
    activity: async () => state.activity,
    lastReply: async () => state.reply,
    serverId: () => "srv",
    pollMs: 1_000,
    startGraceMs: 5_000,
    ...overrides,
  });
  return { inbox, send, state };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("QuickInbox", () => {
  it("resolves ok as soon as the assistant acks, with the wrapped prompt sent", async () => {
    const { inbox, send } = setup();
    const asked = inbox.ask({ text: "do it", source: "app", waitMs: 20_000 });
    await settle();
    const [item] = inbox.list();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(quickPrompt(item.id, "do it", "app"));
    expect(send.mock.calls[0][1]).toContain(item.id);
    inbox.ack(item.id, "ok", "On it");
    const ack = await asked;
    expect(ack).toMatchObject({ id: item.id, status: "ok", message: "On it" });
    inbox.dispose();
  });

  it("returns pending after waitMs and stays pending", async () => {
    const { inbox } = setup();
    const asked = inbox.ask({ text: "x", source: "app", waitMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    const ack = await asked;
    expect(ack.status).toBe("pending");
    expect((await inbox.get(ack.id)).status).toBe("pending");
    inbox.dispose();
  });

  it("infers needs-input from a reply ending in a question", async () => {
    const { inbox, state } = setup();
    const asked = inbox.ask({ text: "x", source: "app", waitMs: 20_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    state.activity = "idle";
    state.reply = "Which project do you mean?";
    await vi.advanceTimersByTimeAsync(2_000);
    const ack = await asked;
    expect(ack.status).toBe("needs-input");
    expect(inbox.list()[0].inferred).toBe(true);
    inbox.dispose();
  });

  it("settles error when the chat errors or is gone", async () => {
    for (const activity of ["error", null] as const) {
      const { inbox, state } = setup();
      state.activity = activity;
      const asked = inbox.ask({ text: "x", source: "app", waitMs: 5_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await asked).status).toBe("error");
      inbox.dispose();
    }
  });

  it("settles error when openChat or send throws", async () => {
    for (const overrides of [
      { openChat: async () => Promise.reject(new Error("down")) },
      { send: async () => Promise.reject(new Error("down")) },
    ] as Partial<QuickInboxDeps>[]) {
      const { inbox } = setup(overrides);
      const ack = await inbox.ask({ text: "x", source: "app", waitMs: 0 });
      expect(ack.status).toBe("error");
      expect(ack.message).toContain("Could not reach the assistant");
      inbox.dispose();
    }
  });

  it("acks the newest pending without an id and throws on an unknown id", async () => {
    const { inbox } = setup();
    await inbox.ask({ text: "a", source: "app", waitMs: 0 });
    const second = await inbox.ask({ text: "b", source: "app", waitMs: 0 });
    expect(inbox.ack(undefined, "ok", "fine").id).toBe(second.id);
    expect(() => inbox.ack("nope", "ok", "x")).toThrow(/No quick message nope/);
    inbox.dispose();
  });

  it("lists newest first and keeps 30", async () => {
    const { inbox } = setup();
    for (let i = 0; i < 32; i++)
      await inbox.ask({ text: `m${i}`, source: "app", waitMs: 0 });
    const items = inbox.list();
    expect(items).toHaveLength(30);
    expect(items[0].text).toBe("m31");
    inbox.dispose();
  });

  it("builds the link from the server id", async () => {
    const known = setup();
    const ack = await known.inbox.ask({ text: "x", source: "app", waitMs: 0 });
    expect(ack.link).toBe("paseo://h/srv/agent/agent-1");
    known.inbox.dispose();
    const unknown = setup({ serverId: () => null });
    expect(
      (await unknown.inbox.ask({ text: "x", source: "app", waitMs: 0 })).link,
    ).toBeNull();
    unknown.inbox.dispose();
    expect(agentLink("s", null)).toBeNull();
  });
});

describe("shared/quick", () => {
  it("classifies replies", () => {
    expect(classifyReply("Which project should it go in?").status).toBe(
      "needs-input",
    );
    expect(classifyReply("Não consigo acessar o projeto.").status).toBe(
      "error",
    );
    expect(classifyReply("It failed to start.").status).toBe("error");
    expect(classifyReply("Created the task. More later.")).toEqual({
      status: "ok",
      message: "Created the task.",
    });
    expect(
      classifyReply("<report>Is this ok?</report>\n\nDone, moved it."),
    ).toEqual({ status: "ok", message: "Done, moved it." });
  });

  it("normalizes ack statuses", () => {
    expect(normalizeAckStatus("needs_input")).toBe("needs-input");
    expect(normalizeAckStatus("Needs Input")).toBe("needs-input");
    expect(normalizeAckStatus("failed")).toBe("error");
    expect(normalizeAckStatus("ack")).toBe("ok");
    expect(normalizeAckStatus("banana")).toBeNull();
  });
});

describe("quick-format", () => {
  const item = (patch: Partial<QuickMessage> = {}): QuickMessage => ({
    id: "q-1",
    text: "hi",
    source: "app",
    sentAt: "2026-01-01T00:00:00.000Z",
    agentId: "a1",
    status: "pending",
    message: null,
    ackedAt: null,
    inferred: false,
    ...patch,
  });

  it("maps statuses to icons and colors", () => {
    expect(quickVisual("ok")).toEqual({
      icon: "CircleCheck",
      color: "statusSuccess",
    });
    expect(quickVisual("needs-input")).toEqual({
      icon: "TriangleAlert",
      color: "statusWarning",
    });
    expect(quickVisual("error")).toEqual({
      icon: "CircleX",
      color: "statusDanger",
    });
    expect(quickVisual("pending")).toEqual({
      icon: "Clock",
      color: "foregroundMuted",
    });
  });

  it("labels the row", () => {
    const s = { pending: "Waiting", idle: "Idle" };
    expect(quickLabel(null, s)).toBe("Idle");
    expect(quickLabel(item(), s)).toBe("Waiting");
    expect(quickLabel(item({ status: "ok", message: "On it" }), s)).toBe(
      "On it",
    );
  });

  it("routes a press to the message", () => {
    expect(conversationTarget(item())).toEqual({
      agentId: "a1",
      turnStartedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(conversationTarget(item({ agentId: null }))).toBeNull();
  });

  it("polls faster while something is pending", () => {
    expect(quickPollMs([item()])).toBe(2_000);
    expect(quickPollMs([item({ status: "ok" })])).toBe(15_000);
    expect(quickPollMs([])).toBe(15_000);
  });
});

// CUSTOM(status-bar)
describe("status bar assistant topic", () => {
  const summary = (
    patch: Partial<AssistantSummary> = {},
  ): AssistantSummary => ({
    request: "Check the board",
    status: "Reading tasks",
    ...patch,
  });

  it("breadcrumbs the first topic and the current one", () => {
    expect(assistantTopic(undefined)).toBeNull();
    expect(assistantTopic(summary())).toBe("Check the board");
    expect(assistantTopic(summary({ firstTopic: "Board" }))).toBe("Board");
    expect(
      assistantTopic(summary({ topic: "Ready", firstTopic: "Ready" })),
    ).toBe("Ready");
    expect(
      assistantTopic(summary({ topic: "Status bar", firstTopic: "Board" })),
    ).toBe("Board › Status bar");
  });

  it("picks the newest unarchived chat agent", () => {
    const label = "pwb/assistant-chat";
    const agents: AssistantAgentEntry[] = [
      { id: "old", updatedAt: "2026-01-01", labels: { [label]: "true" } },
      { id: "new", updatedAt: "2026-01-03", labels: { [label]: "true" } },
      {
        id: "archived",
        updatedAt: "2026-01-05",
        archivedAt: "2026-01-05",
        labels: { [label]: "true" },
      },
      { id: "other", updatedAt: "2026-01-09", labels: {} },
    ];
    expect(pickAssistantAgent(agents, label)?.id).toBe("new");
    expect(pickAssistantAgent([], label)).toBeNull();
  });
});

describe("quickAckTool", () => {
  it("acks with the normalized status", async () => {
    const ack = vi.fn(() => ({ id: "q-1" }) as QuickMessage);
    const tool = quickAckTool({ ack });
    const result = await tool.execute({
      id: "q-1",
      status: "Needs Input",
      message: "Which one?",
    });
    expect(result.text).toBe("Acknowledged q-1: needs-input.");
    expect(ack).toHaveBeenCalledWith("q-1", "needs-input", "Which one?");
  });

  it("rejects an unknown status", async () => {
    const ack = vi.fn();
    const result = await quickAckTool({ ack }).execute({
      status: "banana",
      message: "x",
    });
    expect(result.isError).toBe(true);
    expect(ack).not.toHaveBeenCalled();
  });
});
