// CUSTOM(assistant-desk)
import { describe, expect, it } from "vitest";
import { AGENT_REPLACES_LABEL } from "@/task-navigation/agent-successor";
import {
  ASSISTANT_CHAT_LABEL,
  isAssistantChatAgent,
  isLiveAssistantChatAgent,
  resolveAssistantChat,
  type AssistantAgentFacts,
} from "./model";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const ARCHIVED = new Date("2026-11-19T12:00:00Z");

function servers(
  entries: Record<string, Record<string, AssistantAgentFacts>>,
): Map<string, Map<string, AssistantAgentFacts>> {
  return new Map(
    Object.entries(entries).map(([serverId, agents]) => [
      serverId,
      new Map(Object.entries(agents)),
    ]),
  );
}

describe("isAssistantChatAgent", () => {
  it("needs the chat label set to true", () => {
    expect(isAssistantChatAgent({ labels: CHAT })).toBe(true);
    expect(isAssistantChatAgent({ labels: { [ASSISTANT_CHAT_LABEL]: "false" } })).toBe(false);
    expect(isAssistantChatAgent({ labels: {} })).toBe(false);
    expect(isAssistantChatAgent(undefined)).toBe(false);
  });
});

describe("isLiveAssistantChatAgent", () => {
  it("is the labeled chat only until it is archived", () => {
    expect(isLiveAssistantChatAgent({ labels: CHAT })).toBe(true);
    expect(isLiveAssistantChatAgent({ labels: CHAT, archivedAt: ARCHIVED })).toBe(false);
    expect(isLiveAssistantChatAgent({ labels: {} })).toBe(false);
    expect(isLiveAssistantChatAgent(null)).toBe(false);
  });
});

describe("resolveAssistantChat", () => {
  it("keeps the remembered chat while it is live", () => {
    const chat = resolveAssistantChat({
      remembered: { serverId: "s1", agentId: "a" },
      agentsByServer: servers({ s1: { a: { labels: CHAT }, b: { labels: CHAT } } }),
      preferredServerId: "s1",
    });
    expect(chat).toEqual({ serverId: "s1", agentId: "a" });
  });

  it("keeps a remembered chat while the session has not loaded its agents", () => {
    const chat = resolveAssistantChat({
      remembered: { serverId: "s1", agentId: "new" },
      agentsByServer: servers({ s1: { old: { labels: CHAT } } }),
      preferredServerId: "s1",
      hydratedServerIds: new Set(),
    });
    expect(chat).toEqual({ serverId: "s1", agentId: "new" });
  });

  it("after a restart, leaves a chat the loaded session no longer lists for the live one", () => {
    const chat = resolveAssistantChat({
      remembered: { serverId: "s1", agentId: "gone" },
      agentsByServer: servers({ s1: { fresh: { labels: CHAT } } }),
      preferredServerId: "s1",
      hydratedServerIds: new Set(["s1"]),
    });
    expect(chat).toEqual({ serverId: "s1", agentId: "fresh" });
  });

  it("picks the newest live chat by creation, not by the order of the map", () => {
    const older = new Date("2026-11-19T10:00:00Z");
    const newer = new Date("2026-11-19T11:00:00Z");
    const forgot = {
      remembered: { serverId: "s1", agentId: "gone" },
      preferredServerId: "s1",
      hydratedServerIds: new Set(["s1"]),
    };
    expect(
      resolveAssistantChat({
        ...forgot,
        agentsByServer: servers({
          s1: { new: { labels: CHAT, createdAt: newer }, old: { labels: CHAT, createdAt: older } },
        }),
      }),
    ).toEqual({ serverId: "s1", agentId: "new" });
    expect(
      resolveAssistantChat({
        ...forgot,
        agentsByServer: servers({
          s1: { old: { labels: CHAT, createdAt: older }, new: { labels: CHAT, createdAt: newer } },
        }),
      }),
    ).toEqual({ serverId: "s1", agentId: "new" });
  });

  it("follows a compaction to the chat that replaces the archived one", () => {
    const chat = resolveAssistantChat({
      remembered: { serverId: "s1", agentId: "old" },
      agentsByServer: servers({
        s1: {
          old: { labels: CHAT, archivedAt: ARCHIVED },
          other: { labels: CHAT },
          next: { labels: { ...CHAT, [AGENT_REPLACES_LABEL]: "old" } },
        },
      }),
      preferredServerId: "s1",
    });
    expect(chat).toEqual({ serverId: "s1", agentId: "next" });
  });

  it("falls back to a live chat on the remembered server after a restart", () => {
    const chat = resolveAssistantChat({
      remembered: { serverId: "s2", agentId: "old" },
      agentsByServer: servers({
        s1: { x: { labels: CHAT } },
        s2: { old: { labels: CHAT, archivedAt: ARCHIVED }, fresh: { labels: CHAT } },
      }),
      preferredServerId: "s1",
    });
    expect(chat).toEqual({ serverId: "s2", agentId: "fresh" });
  });

  it("without a remembered chat, prefers the workspace's server", () => {
    const agentsByServer = servers({
      s1: { a: { labels: CHAT } },
      s2: { b: { labels: CHAT }, plain: { labels: {} } },
    });
    expect(
      resolveAssistantChat({ remembered: null, agentsByServer, preferredServerId: "s2" }),
    ).toEqual({ serverId: "s2", agentId: "b" });
    expect(
      resolveAssistantChat({ remembered: null, agentsByServer, preferredServerId: "s1" }),
    ).toEqual({ serverId: "s1", agentId: "a" });
  });

  it("shows the archived chat when no live chat exists, and nothing without any", () => {
    const remembered = { serverId: "s1", agentId: "old" };
    const agentsByServer = servers({ s1: { old: { labels: CHAT, archivedAt: ARCHIVED } } });
    expect(resolveAssistantChat({ remembered, agentsByServer, preferredServerId: "s1" })).toEqual(
      remembered,
    );
    expect(
      resolveAssistantChat({ remembered: null, agentsByServer, preferredServerId: "s1" }),
    ).toBeNull();
  });
});
