import { describe, expect, it } from "vitest";
import { getPinLabelWrites, selectPinnedAgentIds } from "./pinned-task-labels";

const LABEL = "paseo.pinned.client";
const agent = (labels: Record<string, string> = {}, archived = false) => ({
  labels,
  archivedAt: archived ? new Date() : null,
});

describe("selectPinnedAgentIds", () => {
  it("groups by server and splits at the last colon", () => {
    const pinned = selectPinnedAgentIds(["home:a", "home:b", "host:with:colons:c", "bad"]);
    expect([...pinned.get("home")!]).toEqual(["a", "b"]);
    expect([...pinned.get("host:with:colons")!]).toEqual(["c"]);
    expect(pinned.size).toBe(2);
  });
});

describe("getPinLabelWrites", () => {
  const run = (
    pinned: string[],
    agents: [string, ReturnType<typeof agent>][],
    pending?: string[],
  ) =>
    getPinLabelWrites({
      label: LABEL,
      pinnedAgentIds: new Set(pinned),
      agents: new Map(agents),
      pending: pending ? new Set(pending) : undefined,
    });

  it("writes true for a pinned agent that is not marked", () => {
    expect(run(["a"], [["a", agent()]])).toEqual([{ agentId: "a", value: "true" }]);
  });

  it("writes false for an unpinned agent marked true", () => {
    expect(run([], [["a", agent({ [LABEL]: "true" })]])).toEqual([
      { agentId: "a", value: "false" },
    ]);
  });

  it("does not write for an unpinned agent without the label", () => {
    expect(run([], [["a", agent()]])).toEqual([]);
  });

  it("releases an archived pinned agent marked true", () => {
    expect(run(["a"], [["a", agent({ [LABEL]: "true" }, true)]])).toEqual([
      { agentId: "a", value: "false" },
    ]);
  });

  it("does not write for an archived pinned agent without the label", () => {
    expect(run(["a"], [["a", agent({}, true)]])).toEqual([]);
  });

  it("skips writes already pending", () => {
    expect(run(["a"], [["a", agent()]], ["a:true"])).toEqual([]);
  });
});
