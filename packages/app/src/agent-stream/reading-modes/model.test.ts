import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  buildReadingTurns,
  filterCompactStream,
  type ReadingTurn,
  selectCompactItemIds,
} from "./model";

const timestamp = new Date(0);

function user(id: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp };
}

function assistant(id: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp };
}

function thought(id: string): StreamItem {
  return { kind: "thought", id, text: id, timestamp, status: "ready" };
}

function tool(id: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp,
    payload: {
      source: "orchestrator",
      data: { toolCallId: id, toolName: "read", arguments: {}, status: "completed" },
    },
  };
}

function plugin(id: string): StreamItem {
  return {
    kind: "plugin",
    id,
    timestamp,
    pluginId: "usage",
    pluginItemId: id,
    itemKind: "usage",
    version: 1,
    data: null,
  };
}

function notification(id: string): StreamItem {
  return {
    kind: "notification",
    sourceType: "error",
    id,
    timestamp,
    level: "error",
    message: id,
  };
}

describe("selectCompactItemIds", () => {
  it("keeps prompts and the text after each response's last step", () => {
    const items = [
      user("u1"),
      assistant("a1"),
      tool("t1"),
      thought("th1"),
      assistant("a2"),
      tool("t2"),
      assistant("a3"),
      assistant("a4"),
      user("u2"),
      assistant("a5"),
    ];
    expect([...selectCompactItemIds(items)]).toEqual(["u1", "a3", "a4", "u2", "a5"]);
  });

  it("keeps the last step of a response that has no final text yet", () => {
    const items = [user("u1"), assistant("a1"), tool("t1"), tool("t2")];
    expect([...selectCompactItemIds(items)]).toEqual(["u1", "t2"]);
  });

  it("keeps notifications wherever they fall", () => {
    const items = [user("u1"), tool("t1"), notification("n1"), tool("t2"), assistant("a1")];
    expect([...selectCompactItemIds(items)]).toEqual(["u1", "n1", "a1"]);
  });
});

describe("plugin rows after the answer", () => {
  it("keeps the answer and the plugin row", () => {
    const items = [user("u1"), tool("t1"), assistant("a1"), plugin("p1")];
    expect([...selectCompactItemIds(items)]).toEqual(["u1", "a1", "p1"]);
    expect(buildReadingTurns(items).map(summarizeTurn)).toEqual([
      { prompt: "u1", answer: ["a1"], hidden: 1, jump: "u1" },
    ]);
  });
});

describe("filterCompactStream", () => {
  it("reads the live head as the end of the tail's response", () => {
    const result = filterCompactStream(
      [user("u1"), assistant("a1"), tool("t1")],
      [assistant("a2")],
    );
    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head?.map((item) => item.id)).toEqual(["a2"]);
  });
});

function summarizeTurn(turn: ReadingTurn) {
  return {
    prompt: turn.prompt?.id ?? null,
    answer: turn.answer.map((item) => item.id),
    hidden: turn.hiddenStepCount,
    jump: turn.jumpMessageId,
  };
}

describe("buildReadingTurns", () => {
  it("pairs each prompt with its final answer and counts what was left out", () => {
    const turns = buildReadingTurns([
      assistant("a0"),
      user("u1"),
      assistant("a1"),
      tool("t1"),
      assistant("a2"),
      user("u2"),
      tool("t2"),
    ]);
    expect(turns.map(summarizeTurn)).toEqual([
      { prompt: null, answer: ["a0"], hidden: 0, jump: "a0" },
      { prompt: "u1", answer: ["a2"], hidden: 2, jump: "u1" },
      { prompt: "u2", answer: [], hidden: 1, jump: "u2" },
    ]);
  });
});
