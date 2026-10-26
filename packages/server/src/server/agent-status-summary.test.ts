import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatusSummaryPayload } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";
import type { AgentManagerEvent, AgentSubscriber, ManagedAgent } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import {
  AgentStatusSummaries,
  buildStatusSummaryPrompt,
  collectStatusSummaryInput,
  parseStatusSummaryReply,
  tidyGeneratedTitle,
} from "./agent-status-summary.js";

const user = (text: string): AgentTimelineItem => ({ type: "user_message", text });
const assistant = (text: string): AgentTimelineItem => ({ type: "assistant_message", text });

describe("collectStatusSummaryInput", () => {
  it("returns null before the first user message", () => {
    expect(collectStatusSummaryInput([assistant("hello")])).toBeNull();
  });

  it("keeps the first and the last three user messages and the activity after the last", () => {
    const input = collectStatusSummaryInput([
      user("first"),
      assistant("a1"),
      user("second"),
      user("third"),
      user("fourth"),
      user("fifth"),
      assistant("working on fifth"),
    ]);
    expect(input?.userMessages).toEqual(["first", "third", "fourth", "fifth"]);
    expect(input?.activity).toContain("working on fifth");
    expect(input?.activity).not.toContain("a1");
  });
});

describe("buildStatusSummaryPrompt", () => {
  it("includes the previous card, the state and the messages", () => {
    const prompt = buildStatusSummaryPrompt({
      summaryInput: { userMessages: ["fix the login"], activity: "" },
      lifecycle: "running",
      previous: { request: "old goal", status: "old status", updatedAt: "2026-10-20T00:00:00Z" },
    });
    expect(prompt).toContain("Agent state: running.");
    expect(prompt).toContain("request: old goal");
    expect(prompt).toContain("<user>\nfix the login\n</user>");
    expect(prompt).toContain("(nothing yet)");
  });
});

describe("tidyGeneratedTitle", () => {
  it("drops connector words a four-word cut leaves at the end", () => {
    expect(tidyGeneratedTitle("Pesquisa de modelos low poly")).toBe("Pesquisa de modelos low");
    expect(tidyGeneratedTitle("Abas do World e Árvores")).toBe("Abas do World");
    expect(tidyGeneratedTitle("PowerEditor: Seguir seleção por aba")).toBe(
      "PowerEditor: Seguir seleção",
    );
    expect(tidyGeneratedTitle("Fix of the")).toBe("Fix");
  });

  it("keeps a complete title and drops trailing punctuation", () => {
    expect(tidyGeneratedTitle("Login fix.")).toBe("Login fix");
    expect(tidyGeneratedTitle("  ")).toBeUndefined();
  });
});

describe("parseStatusSummaryReply", () => {
  it("reads the JSON object even inside a code fence", () => {
    expect(
      parseStatusSummaryReply('```json\n{"request":"Fix login","status":"Done"}\n```'),
    ).toEqual({ request: "Fix login", status: "Done" });
  });

  it("keeps the short topic", () => {
    expect(
      parseStatusSummaryReply('{"topic":"Login fix","request":"Fix login","status":"Done"}'),
    ).toEqual({ topic: "Login fix", request: "Fix login", status: "Done" });
  });

  it("throws when there is no JSON", () => {
    expect(() => parseStatusSummaryReply("sorry")).toThrow("No JSON");
  });
});

class FakeManager {
  subscriber: AgentSubscriber | null = null;
  timeline: AgentTimelineItem[] = [user("fix the login")];
  summaries = new Map<string, AgentStatusSummaryPayload>();
  agent = { id: "a1", cwd: "/repo", lifecycle: "running", internal: false } as ManagedAgent;

  subscribe(callback: AgentSubscriber) {
    this.subscriber = callback;
    return () => {
      this.subscriber = null;
    };
  }
  getAgent(id: string) {
    return id === this.agent.id ? this.agent : null;
  }
  getTimeline() {
    return this.timeline;
  }
  setStatusSummary(agentId: string, summary: AgentStatusSummaryPayload) {
    this.summaries.set(agentId, summary);
  }
  getStatusSummary(agentId: string) {
    return this.summaries.get(agentId) ?? null;
  }
  title: string | null = "fix the login";
  async setTitle(_agentId: string, title: string) {
    this.title = title;
  }
  emit(type: "turn_started" | "turn_completed" | "timeline") {
    const event =
      type === "timeline"
        ? { type, provider: "claude", item: assistant("progress") }
        : { type, provider: "claude" };
    this.subscriber?.({ type: "agent_stream", agentId: "a1", event } as AgentManagerEvent);
  }
}

describe("AgentStatusSummaries", () => {
  let manager: FakeManager;
  let generate: ReturnType<typeof vi.fn>;
  let service: AgentStatusSummaries;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
    manager = new FakeManager();
    generate = vi.fn(async () => ({ request: "Fix the login", status: "Reading the auth module" }));
    service = new AgentStatusSummaries({
      agentManager: manager,
      agentStorage: {
        get: async () => ({ title: manager.title }) as Awaited<ReturnType<AgentStorage["get"]>>,
      },
      generate,
      logger: pino({ level: "silent" }),
    });
    service.start();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it("summarizes a few seconds after a turn starts and stores the result", async () => {
    manager.emit("turn_started");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(manager.summaries.get("a1")).toEqual({
      request: "Fix the login",
      status: "Reading the auth module",
      updatedAt: "2026-10-20T10:00:04.000Z",
    });
  });

  it("skips the model when nothing changed since the last summary", async () => {
    manager.emit("turn_completed");
    await vi.advanceTimersByTimeAsync(3_000);
    manager.emit("turn_completed");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("refreshes a long turn only after a few minutes of activity", async () => {
    manager.emit("turn_started");
    await vi.advanceTimersByTimeAsync(5_000);
    manager.timeline = [...manager.timeline, assistant("step one")];
    manager.emit("timeline");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    manager.emit("timeline");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  describe("auto-rename", () => {
    beforeEach(() => {
      generate.mockResolvedValue({ title: "Login fix", request: "Fix login", status: "Done" });
    });

    it("renames the session from its first summary", async () => {
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(manager.title).toBe("Login fix");
    });

    it("follows the summary while the title is the one it wrote", async () => {
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      generate.mockResolvedValue({ title: "Signup flow", request: "Signup", status: "Done" });
      manager.timeline = [...manager.timeline, user("now the signup")];
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(manager.title).toBe("Signup flow");
    });

    it("keeps a title set by hand", async () => {
      manager.title = "My name";
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(manager.title).toBe("My name");
    });

    it("keeps a title renamed by hand after an auto-rename", async () => {
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      manager.title = "My name";
      generate.mockResolvedValue({ title: "Signup flow", request: "Signup", status: "Done" });
      manager.timeline = [...manager.timeline, user("now the signup")];
      manager.emit("turn_completed");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(manager.title).toBe("My name");
    });
  });

  it("ignores internal agents", async () => {
    manager.agent = { ...manager.agent, internal: true } as ManagedAgent;
    manager.emit("turn_completed");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(generate).not.toHaveBeenCalled();
  });
});
