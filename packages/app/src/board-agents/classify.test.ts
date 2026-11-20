// CUSTOM(sidebar-agent-tabs)
import { describe, expect, it } from "vitest";
import { classifySidebarAgent, type SidebarClassifiableAgent } from "./classify";

const PARENT = "paseo.parent-agent-id";

function lookup(table: Record<string, SidebarClassifiableAgent>) {
  return (id: string) => table[id];
}

describe("classifySidebarAgent", () => {
  it("puts an agent the user created in User Agents", () => {
    expect(classifySidebarAgent({ labels: {} }, lookup({}))).toBe("user");
  });

  it("puts the agent the board starts for a task in Orchestrators", () => {
    expect(classifySidebarAgent({ labels: { "paseo.board-agent": "true" } }, lookup({}))).toBe(
      "orchestrators",
    );
  });

  it("puts the assistant chat in Orchestrators", () => {
    expect(classifySidebarAgent({ labels: { "pwb/assistant-chat": "true" } }, lookup({}))).toBe(
      "orchestrators",
    );
  });

  it("puts the refinement chat in Orchestrators, by label or by its old title", () => {
    expect(classifySidebarAgent({ labels: { "pwb/refinement-chat": "true" } }, lookup({}))).toBe(
      "orchestrators",
    );
    expect(classifySidebarAgent({ labels: {}, title: "Refine: cache" }, lookup({}))).toBe(
      "orchestrators",
    );
  });

  it("puts a subagent of a board agent in Workers", () => {
    const agents = {
      run: { labels: { "paseo.board-agent": "true" } },
    };
    expect(
      classifySidebarAgent({ labels: { [PARENT]: "run" }, parentAgentId: "run" }, lookup(agents)),
    ).toBe("workers");
  });

  it("keeps a board-labeled child in Workers even when its parent is not loaded", () => {
    expect(
      classifySidebarAgent(
        { labels: { "paseo.board-agent": "true", [PARENT]: "gone" }, parentAgentId: "gone" },
        lookup({}),
      ),
    ).toBe("workers");
  });

  it("puts the ship agent, a child of the assistant chat, in Workers", () => {
    const agents = { chat: { labels: { "pwb/assistant-chat": "true" } } };
    expect(
      classifySidebarAgent({ labels: { [PARENT]: "chat" }, parentAgentId: "chat" }, lookup(agents)),
    ).toBe("workers");
  });

  it("puts a worker of a worker in Workers", () => {
    const agents = {
      run: { labels: { "paseo.board-agent": "true" } },
      worker: { labels: { [PARENT]: "run" } },
    };
    expect(
      classifySidebarAgent(
        { labels: { [PARENT]: "worker" }, parentAgentId: "worker" },
        lookup(agents),
      ),
    ).toBe("workers");
  });

  it("keeps a subagent of a user agent in User Agents", () => {
    const agents = { mine: { labels: {} } };
    expect(
      classifySidebarAgent({ labels: { [PARENT]: "mine" }, parentAgentId: "mine" }, lookup(agents)),
    ).toBe("user");
  });

  it("does not loop on a parent cycle", () => {
    const agents = {
      a: { labels: { [PARENT]: "b" } },
      b: { labels: { [PARENT]: "a" } },
    };
    expect(
      classifySidebarAgent({ labels: { [PARENT]: "a" }, parentAgentId: "a" }, lookup(agents)),
    ).toBe("user");
  });
});
