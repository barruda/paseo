// CUSTOM(assistant-desk)
import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_LABEL, type AssistantAgentFacts } from "./model";
import { ASSISTANT_DESK_ID } from "@/task-navigation/desks-store";
import { deskTabKey, layoutTabKey, planAssistantTabSweep, pruneKnownTabs } from "./sweep";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const ARCHIVED = new Date("2026-11-19T12:00:00Z");

const liveChat = (): AssistantAgentFacts => ({ labels: CHAT });
const archivedChat = (): AssistantAgentFacts => ({ labels: CHAT, archivedAt: ARCHIVED });
const otherAgent = (): AssistantAgentFacts => ({ labels: {} });

const agentFor = (serverId: string, agentId: string) =>
  serverId === "s1" && agentId === "chat" ? liveChat() : otherAgent();

describe("planAssistantTabSweep", () => {
  it("closes restored chat tabs, and old Explorer assistant tabs, silently", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        { deskId: "primary", id: "d1", serverId: "s1", target: { kind: "agent", agentId: "chat" } },
        {
          deskId: "primary",
          id: "d2",
          serverId: "s1",
          target: { kind: "agent", agentId: "other" },
        },
      ],
      layoutTabs: [
        { workspaceKey: "s1:ws", tabId: "t1", target: { kind: "agent", agentId: "chat" } },
        { workspaceKey: "s1:ws", tabId: "t2", target: { kind: "projects_assistant" } },
      ],
      agentFor,
      known: new Set([deskTabKey("d1"), layoutTabKey("s1:ws", "t1")]),
    });
    expect(plan).toEqual({
      deskTabIds: ["d1"],
      layoutTabs: [
        { workspaceKey: "s1:ws", tabId: "t1", agentId: "chat" },
        { workspaceKey: "s1:ws", tabId: "t2", agentId: null },
      ],
      reveal: null,
    });
  });

  it("asks to open the assistant Desk for a chat tab opened later", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        {
          deskId: "primary",
          id: "new",
          serverId: "s1",
          target: { kind: "agent", agentId: "chat" },
        },
      ],
      layoutTabs: [],
      agentFor,
      known: new Set(),
    });
    expect(plan.deskTabIds).toEqual(["new"]);
    expect(plan.reveal).toEqual({ serverId: "s1", agentId: "chat" });
  });

  it("never sweeps a tab inside the assistant Desk", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        {
          deskId: ASSISTANT_DESK_ID,
          id: "keep",
          serverId: "s1",
          target: { kind: "agent", agentId: "chat" },
        },
        {
          deskId: "primary",
          id: "other",
          serverId: "s1",
          target: { kind: "agent", agentId: "chat" },
        },
      ],
      layoutTabs: [],
      agentFor,
      known: new Set(),
    });
    expect(plan.deskTabIds).toEqual(["other"]);
  });

  it("leaves chat tabs alone when told there is no assistant Desk", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        { deskId: "primary", id: "d", serverId: "s1", target: { kind: "agent", agentId: "chat" } },
      ],
      layoutTabs: [],
      agentFor,
      known: new Set(),
      sweepChats: false,
    });
    expect(plan).toEqual({ deskTabIds: [], layoutTabs: [], reveal: null });
  });

  it("leaves an archived chat's tab where the user opened it", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        {
          deskId: "primary",
          id: "old",
          serverId: "s1",
          target: { kind: "agent", agentId: "chat" },
        },
      ],
      layoutTabs: [
        { workspaceKey: "s1:ws", tabId: "t", target: { kind: "agent", agentId: "chat" } },
      ],
      agentFor: (serverId, agentId) =>
        serverId === "s1" && agentId === "chat" ? archivedChat() : otherAgent(),
      known: new Set(),
    });
    expect(plan).toEqual({ deskTabIds: [], layoutTabs: [], reveal: null });
  });

  it("reads the server from the workspace key and leaves other servers alone", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        { deskId: "primary", id: "d", serverId: "s2", target: { kind: "agent", agentId: "chat" } },
      ],
      layoutTabs: [
        { workspaceKey: "s2:ws", tabId: "t", target: { kind: "agent", agentId: "chat" } },
        { workspaceKey: "s1:ws:x", tabId: "u", target: { kind: "agent", agentId: "chat" } },
      ],
      agentFor,
      known: new Set(),
    });
    expect(plan.deskTabIds).toEqual([]);
    expect(plan.layoutTabs).toEqual([{ workspaceKey: "s1:ws:x", tabId: "u", agentId: "chat" }]);
    expect(plan.reveal).toEqual({ serverId: "s1", agentId: "chat" });
  });
});

describe("pruneKnownTabs", () => {
  it("drops tabs that are gone so the set cannot grow forever", () => {
    const known = new Set([
      deskTabKey("restored"),
      deskTabKey("closed"),
      layoutTabKey("s1:ws", "t"),
    ]);
    const next = pruneKnownTabs(known, {
      deskTabs: [
        {
          deskId: "primary",
          id: "restored",
          serverId: "s1",
          target: { kind: "agent", agentId: "chat" },
        },
      ],
      layoutTabs: [],
    });
    expect([...next]).toEqual([deskTabKey("restored")]);
  });
});
