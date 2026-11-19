import { expect, it } from "vitest";
import { cardAgentId } from "../client/board-utils";

const agent = (id: string, archived = false) => ({
  id,
  title: id,
  activity: "idle" as const,
  archived,
});

it("the orchestrated agent wins, whatever its state or the task's column", () => {
  const card = {
    workspaceId: "ws",
    agents: [agent("manual"), agent("orchestrated", true)],
  };
  expect(cardAgentId(card, { agentId: "orchestrated" })).toBe("orchestrated");
});

it("a task back in Backlog keeps the last attempt's agent, even archived", () => {
  const card = { workspaceId: "ws", agents: [agent("old", true)] };
  expect(cardAgentId(card, { agentId: "old" })).toBe("old");
  expect(cardAgentId(card, undefined)).toBe("old");
});

it("a restart with no agent yet, or a task started by hand, links the workspace's agent, a live one first", () => {
  const card = {
    workspaceId: "ws",
    agents: [agent("archived", true), agent("live")],
  };
  expect(cardAgentId(card, { agentId: null })).toBe("live");
  expect(cardAgentId(card, undefined)).toBe("live");
});

it("no agent, no link", () => {
  expect(cardAgentId({ workspaceId: "ws", agents: [] }, undefined)).toBeNull();
  expect(
    cardAgentId({ workspaceId: null, agents: [agent("stray")] }, undefined),
  ).toBeNull();
  expect(
    cardAgentId({ workspaceId: "ws", agents: [] }, { agentId: null }),
  ).toBeNull();
});
