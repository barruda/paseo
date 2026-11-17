// CUSTOM(task-provider-subagents)
import { describe, expect, it } from "vitest";
import type { ProviderSubagentRow } from "@/subagents/select";
import type { TaskNode } from "./model";
import {
  buildProviderSubagentRows,
  equalProviderSubagentGroups,
  providerSubagentsToggleLabel,
  runningParentKeys,
} from "./provider-subagent-rows";

const node = {
  key: "s1:parent",
  agent: { serverId: "s1", id: "parent" },
  workspace: { workspaceId: "w1" },
} as unknown as TaskNode;

function sub(
  id: string,
  status: ProviderSubagentRow["status"],
  createdAt: string,
  description: string | null = id,
): ProviderSubagentRow {
  return {
    kind: "provider",
    id,
    parentAgentId: "parent",
    provider: "claude",
    title: "general-purpose",
    description,
    subtitle: "haiku",
    status,
    requiresAttention: status === "failed",
    createdAt: new Date(createdAt),
  };
}

const rows = [
  sub("b", "running", "2026-11-13T00:00:02Z"),
  sub("a", "completed", "2026-11-13T00:00:01Z"),
  sub("c", "failed", "2026-11-13T00:00:03Z", null),
];

describe("buildProviderSubagentRows", () => {
  it("adds nothing without subagents", () => {
    expect(
      buildProviderSubagentRows({ node, depth: 0, subagents: undefined, expanded: true }),
    ).toEqual([]);
    expect(buildProviderSubagentRows({ node, depth: 0, subagents: [], expanded: true })).toEqual(
      [],
    );
  });

  it("adds no rows when collapsed (the toggle is on the task row)", () => {
    expect(buildProviderSubagentRows({ node, depth: 1, subagents: rows, expanded: false })).toEqual(
      [],
    );
  });

  it("lists subagents oldest first with labels and buckets when expanded", () => {
    const result = buildProviderSubagentRows({ node, depth: 0, subagents: rows, expanded: true });
    expect(result.map((row) => row.kind)).toEqual([
      "provider-subagent",
      "provider-subagent",
      "provider-subagent",
    ]);
    const items = result;
    expect(items.map((row) => (row.kind === "provider-subagent" ? row.subagentId : ""))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(items.map((row) => (row.kind === "provider-subagent" ? row.bucket : ""))).toEqual([
      "done",
      "running",
      "failed",
    ]);
    expect(items[2]).toMatchObject({
      label: "general-purpose",
      subtitle: "Claude subagent · haiku",
      depth: 2,
    });
  });
});

describe("providerSubagentsToggleLabel", () => {
  it("is undefined without subagents", () => {
    expect(providerSubagentsToggleLabel(undefined)).toBeUndefined();
    expect(providerSubagentsToggleLabel([])).toBeUndefined();
  });

  it("counts, with working and failed parts", () => {
    expect(providerSubagentsToggleLabel(rows)).toBe("3 subagents · 1 working · 1 failed");
    expect(providerSubagentsToggleLabel([sub("a", "completed", "2026-11-13T00:00:01Z")])).toBe(
      "1 subagent",
    );
  });
});

describe("runningParentKeys", () => {
  it("lists parents with a running subagent", () => {
    const grouped = new Map([
      ["s1:parent", rows],
      ["s1:other", [sub("z", "completed", "2026-11-13T00:00:01Z")]],
    ]);
    expect([...runningParentKeys(grouped)]).toEqual(["s1:parent"]);
  });
});

describe("equalProviderSubagentGroups", () => {
  it("sees a new subagent, so the list updates after its first, empty value", () => {
    expect(equalProviderSubagentGroups(new Map(), new Map([["s:parent", rows]]))).toBe(false);
  });

  it("sees a status change", () => {
    const before = new Map([["s:parent", [sub("b", "running", "2026-11-13T00:00:02Z")]]]);
    const after = new Map([["s:parent", [sub("b", "completed", "2026-11-13T00:00:02Z")]]]);
    expect(equalProviderSubagentGroups(before, after)).toBe(false);
  });

  it("keeps equal groups equal", () => {
    expect(
      equalProviderSubagentGroups(new Map([["s:parent", rows]]), new Map([["s:parent", rows]])),
    ).toBe(true);
  });
});
