import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_LABEL, BOARD_AGENT_LABEL, isBoardAgent } from "./board-agents.js";

const PARENT = "paseo.parent-agent-id";

function lookup(table: Record<string, Record<string, unknown>>) {
  return (id: string) => table[id];
}

describe("isBoardAgent", () => {
  it("is true for the agent's own board label", () => {
    expect(isBoardAgent({ [BOARD_AGENT_LABEL]: "true" }, lookup({}))).toBe(true);
  });

  it("is false when the label value is not 'true'", () => {
    expect(isBoardAgent({ [BOARD_AGENT_LABEL]: "false" }, lookup({}))).toBe(false);
  });

  it("is true for a child of a board agent", () => {
    const get = lookup({ p: { [BOARD_AGENT_LABEL]: "true" } });
    expect(isBoardAgent({ [PARENT]: "p" }, get)).toBe(true);
  });

  it("is true for a grandchild of a board agent", () => {
    const get = lookup({ p: { [PARENT]: "g" }, g: { [BOARD_AGENT_LABEL]: "true" } });
    expect(isBoardAgent({ [PARENT]: "p" }, get)).toBe(true);
  });

  it("is true for a child of the assistant chat", () => {
    const get = lookup({ chat: { [ASSISTANT_CHAT_LABEL]: "true" } });
    expect(isBoardAgent({ [PARENT]: "chat" }, get)).toBe(true);
  });

  it("is false for the assistant chat itself", () => {
    expect(isBoardAgent({ [ASSISTANT_CHAT_LABEL]: "true" }, lookup({}))).toBe(false);
  });

  it("is false for a plain agent", () => {
    expect(isBoardAgent({}, lookup({}))).toBe(false);
    expect(isBoardAgent(null, lookup({}))).toBe(false);
  });

  it("is false when the parent is unknown", () => {
    expect(isBoardAgent({ [PARENT]: "missing" }, lookup({}))).toBe(false);
  });

  it("terminates on a parent cycle", () => {
    const get = lookup({ a: { [PARENT]: "b" }, b: { [PARENT]: "a" } });
    expect(isBoardAgent({ [PARENT]: "a" }, get)).toBe(false);
  });
});
