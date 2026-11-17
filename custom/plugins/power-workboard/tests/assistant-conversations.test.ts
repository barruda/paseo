import { describe, expect, it } from "vitest";
import type { Tree } from "../shared/assistant";
import {
  agentLabel,
  attemptDuration,
  attemptLabel,
  filterTree,
  firstRunningAgent,
  formatDuration,
  locate,
  mergeItems,
  pollInterval,
  relativeTime,
  splitFences,
} from "../client/assistant/conversations-format";
import { conversationsStrings } from "../client/assistant/conversations-strings";

const t = conversationsStrings("en");
const agent = (agentId: string, status = "idle") => ({
  agentId,
  title: null,
  status,
  attempt: 1,
  current: false,
});
const task = (
  taskId: string,
  title: string,
  agents = [agent(`${taskId}-a`)],
) => ({
  taskId,
  title,
  projectName: "p",
  column: "Doing",
  deliveryStage: null,
  updatedAt: "2026-01-01T00:00:00Z",
  agents,
});
const tree: Tree = {
  orchestrators: [
    {
      id: "o1",
      name: "O1",
      projectName: "p",
      active: true,
      tasks: [
        task("t1", "Fix login"),
        task("t2", "Add Search", [agent("run", "running")]),
      ],
    },
    {
      id: null,
      name: "Manual",
      projectName: null,
      active: false,
      tasks: [task("t3", "Docs")],
    },
  ],
};

describe("splitFences", () => {
  it("splits text and code", () => {
    expect(splitFences("a\n```ts\nx = 1\n```\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "code", text: "x = 1" },
      { kind: "text", text: "b" },
    ]);
  });
  it("runs an unclosed fence to the end and keeps plain text whole", () => {
    expect(splitFences("```\ncode")).toEqual([{ kind: "code", text: "code" }]);
    expect(splitFences("one\n\ntwo")).toEqual([
      { kind: "text", text: "one\n\ntwo" },
    ]);
  });
});

describe("tree helpers", () => {
  it("filters tasks by title and drops empty orchestrators", () => {
    const out = filterTree(tree, " search ");
    expect(out.orchestrators).toHaveLength(1);
    expect(out.orchestrators[0].tasks.map((x) => x.taskId)).toEqual(["t2"]);
    expect(filterTree(tree, "")).toBe(tree);
    expect(filterTree(tree, "zzz").orchestrators).toEqual([]);
  });
  it("finds the first running agent and locates agents", () => {
    expect(firstRunningAgent(tree)).toEqual({ agentId: "run", taskId: "t2" });
    expect(locate(tree, "t3-a", null)).toEqual({
      orchestratorKey: "__manual__",
      taskId: "t3",
    });
    expect(locate(tree, null, "t1")).toEqual({
      orchestratorKey: "o1",
      taskId: "t1",
    });
    expect(locate(tree, "nope", null)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
    expect(formatDuration(-1)).toBe("");
  });
  it("labels attempts and agents", () => {
    expect(attemptLabel({ index: 2, trigger: "feedback" }, t)).toBe(
      "Attempt 2 · feedback",
    );
    expect(attemptLabel({ index: 3, trigger: "auto-fix" }, t)).toBe(
      "Attempt 3 · auto-fix",
    );
    expect(agentLabel({ title: " Hi ", attempt: 1 }, 0, t)).toBe("Hi");
    expect(agentLabel({ title: null, attempt: null }, 1, t)).toBe("Attempt 2");
  });
  it("measures attempt duration", () => {
    const base = {};
    expect(
      attemptDuration(
        {
          ...base,
          startedAt: "2026-01-01T00:00:00Z",
          finishedAt: "2026-01-01T00:01:30Z",
        },
        0,
      ),
    ).toBe("1m 30s");
    const start = Date.parse("2026-01-01T00:00:00Z");
    expect(
      attemptDuration(
        { ...base, startedAt: "2026-01-01T00:00:00Z", finishedAt: null },
        start + 5000,
      ),
    ).toBe("5s");
  });
  it("formats relative time and poll interval", () => {
    const now = Date.parse("2026-01-02T00:00:00Z");
    expect(relativeTime("2026-01-01T23:59:50Z", now, t)).toBe("now");
    expect(relativeTime("2026-01-01T23:30:00Z", now, t)).toBe("30m ago");
    expect(relativeTime("2025-12-30T00:00:00Z", now, t)).toBe("3d ago");
    expect(pollInterval("running")).toBe(3000);
    expect(pollInterval("idle")).toBe(15000);
  });
  it("merges items without duplicates", () => {
    const item = (id: string) => ({
      id,
      at: null,
      kind: "user" as const,
      text: id,
      toolName: null,
      toolStatus: null,
    });
    expect(
      mergeItems([item("a"), item("b")], [item("b"), item("c")]).map(
        (i) => i.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });
});
