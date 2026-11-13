// CUSTOM(task-provider-subagents)
import { describe, expect, it } from "vitest";
import type { ProviderSubagentRow } from "@/subagents/select";
import type { TaskNode } from "./model";
import {
  buildProviderSubagentRows,
  equalProviderSubagentGroups,
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

  it("shows only the toggle row when collapsed", () => {
    const result = buildProviderSubagentRows({ node, depth: 1, subagents: rows, expanded: false });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "provider-subagents-toggle",
      depth: 2,
      expanded: false,
      label: "3 subagents · 1 working · 1 failed",
    });
  });

  it("uses the singular and omits the working part when none run", () => {
    const result = buildProviderSubagentRows({
      node,
      depth: 0,
      subagents: [sub("a", "completed", "2026-11-13T00:00:01Z")],
      expanded: false,
    });
    expect(result[0]).toMatchObject({ label: "1 subagent" });
  });

  it("lists subagents oldest first with labels and buckets when expanded", () => {
    const result = buildProviderSubagentRows({ node, depth: 0, subagents: rows, expanded: true });
    expect(result.map((row) => row.kind)).toEqual([
      "provider-subagents-toggle",
      "provider-subagent",
      "provider-subagent",
      "provider-subagent",
    ]);
    const items = result.slice(1);
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
    expect(items[2]).toMatchObject({ label: "general-purpose", subtitle: "haiku", depth: 2 });
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
