import { describe, expect, it } from "vitest";
import { limitSidebarWorkspaces, type SidebarWorkspaceLimit } from "./model";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

function run(input: {
  ages: Record<string, number | null>;
  limit?: SidebarWorkspaceLimit;
  keep?: string[];
  expanded?: string[];
}) {
  const keys = Object.keys(input.ages);
  return limitSidebarWorkspaces({
    projects: [{ viewKey: "p", workspaces: keys.map((workspaceKey) => ({ workspaceKey })) }],
    enteredAtByKey: new Map(
      keys.map((key) => {
        const age = input.ages[key];
        return [key, age === null || age === undefined ? null : new Date(NOW - age * HOUR)];
      }),
    ),
    limit: input.limit ?? { maxPerProject: 3, maxAgeHours: 12 },
    now: NOW,
    keepWorkspaceKeys: new Set(input.keep ?? []),
    expandedProjectKeys: new Set(input.expanded ?? []),
  });
}

describe("limitSidebarWorkspaces", () => {
  it("hides workspaces older than the age limit", () => {
    const result = run({ ages: { a: 1, b: 13, c: 20 } });
    expect([...result.hiddenWorkspaceKeys]).toEqual(["b", "c"]);
    expect(result.limitedProjectKeys.has("p")).toBe(true);
  });

  it("caps recent workspaces at the per-project count, keeping the most recent", () => {
    const result = run({ ages: { a: 5, b: 1, c: 4, d: 2, e: 3 } });
    expect([...result.hiddenWorkspaceKeys].sort()).toEqual(["a", "c"]);
  });

  it("applies both rules together", () => {
    const result = run({ ages: { a: 1, b: 2, c: 3, d: 4, e: 30 } });
    expect([...result.hiddenWorkspaceKeys].sort()).toEqual(["d", "e"]);
  });

  it("always keeps the open workspace without counting it", () => {
    const result = run({ ages: { a: 1, b: 2, c: 3, old: 48 }, keep: ["old"] });
    expect(result.hiddenWorkspaceKeys.size).toBe(0);
    expect(result.limitedProjectKeys.size).toBe(0);
  });

  it("never hides a workspace for its age when it has no timestamp", () => {
    const result = run({ ages: { a: null, b: 1 } });
    expect(result.hiddenWorkspaceKeys.size).toBe(0);
    expect([...run({ ages: { a: null, b: 1, c: 2, d: 3 } }).hiddenWorkspaceKeys]).toEqual(["a"]);
  });

  it("hides nothing in an expanded project but still marks it as limited", () => {
    const result = run({ ages: { a: 1, b: 30 }, expanded: ["p"] });
    expect(result.hiddenWorkspaceKeys.size).toBe(0);
    expect(result.limitedProjectKeys.has("p")).toBe(true);
  });

  it("hides nothing without limits", () => {
    const result = run({
      ages: { a: 100, b: 200, c: 1, d: 2 },
      limit: { maxPerProject: null, maxAgeHours: null },
    });
    expect(result.hiddenWorkspaceKeys.size).toBe(0);
  });
});
