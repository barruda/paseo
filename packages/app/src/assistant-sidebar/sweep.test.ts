// CUSTOM(assistant-sidebar)
import { describe, expect, it } from "vitest";
import { deskTabKey, layoutTabKey, planAssistantTabSweep, pruneKnownTabs } from "./sweep";

const isAssistant = (serverId: string, agentId: string) => serverId === "s1" && agentId === "chat";

describe("planAssistantTabSweep", () => {
  it("closes restored chat tabs without showing the sidebar", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [
        { id: "d1", serverId: "s1", target: { kind: "agent", agentId: "chat" } },
        { id: "d2", serverId: "s1", target: { kind: "agent", agentId: "other" } },
      ],
      layoutTabs: [
        { workspaceKey: "s1:ws", tabId: "t1", target: { kind: "agent", agentId: "chat" } },
        { workspaceKey: "s1:ws", tabId: "t2", target: { kind: "projects_assistant" } },
      ],
      isAssistant,
      known: new Set([deskTabKey("d1"), layoutTabKey("s1:ws", "t1")]),
    });
    expect(plan).toEqual({
      deskTabIds: ["d1"],
      layoutTabs: [{ workspaceKey: "s1:ws", tabId: "t1", agentId: "chat" }],
      reveal: null,
    });
  });

  it("turns a chat tab opened later into the sidebar tab", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [{ id: "new", serverId: "s1", target: { kind: "agent", agentId: "chat" } }],
      layoutTabs: [],
      isAssistant,
      known: new Set(),
    });
    expect(plan.deskTabIds).toEqual(["new"]);
    expect(plan.reveal).toEqual({ serverId: "s1", agentId: "chat" });
  });

  it("reads the server from the workspace key and leaves other servers alone", () => {
    const plan = planAssistantTabSweep({
      deskTabs: [{ id: "d", serverId: "s2", target: { kind: "agent", agentId: "chat" } }],
      layoutTabs: [
        { workspaceKey: "s2:ws", tabId: "t", target: { kind: "agent", agentId: "chat" } },
        { workspaceKey: "s1:ws:x", tabId: "u", target: { kind: "agent", agentId: "chat" } },
      ],
      isAssistant,
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
      deskTabs: [{ id: "restored", serverId: "s1", target: { kind: "agent", agentId: "chat" } }],
      layoutTabs: [],
    });
    expect([...next]).toEqual([deskTabKey("restored")]);
  });
});
