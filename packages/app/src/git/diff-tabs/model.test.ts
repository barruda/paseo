import { describe, expect, it } from "vitest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { findDiffTabToReuse } from "./model";

const fileDiff: WorkspaceTabTarget = {
  kind: "working_diff",
  focusPath: "src/b.ts",
  focusRequestId: 2,
};
const tabs = [
  { id: "agent", target: { kind: "agent", agentId: "a1" } as WorkspaceTabTarget },
  { id: "diff", target: { kind: "working_diff", focusPath: "src/a.ts", focusRequestId: 1 } },
] satisfies { id: string; target: WorkspaceTabTarget }[];

describe("findDiffTabToReuse", () => {
  it("reuses the open diff tab when Open in different tabs is off", () => {
    expect(findDiffTabToReuse({ tabs, target: fileDiff, openInNewTabs: false })?.id).toBe("diff");
  });

  it("opens a new tab when Open in different tabs is on", () => {
    expect(findDiffTabToReuse({ tabs, target: fileDiff, openInNewTabs: true })).toBeNull();
  });

  it("opens a new tab when no diff tab is open", () => {
    expect(
      findDiffTabToReuse({ tabs: tabs.slice(0, 1), target: fileDiff, openInNewTabs: false }),
    ).toBeNull();
  });

  it("leaves other targets and the whole-diff tab alone", () => {
    const file: WorkspaceTabTarget = { kind: "file", path: "src/a.ts" };
    const wholeDiff: WorkspaceTabTarget = { kind: "working_diff" };
    expect(findDiffTabToReuse({ tabs, target: file, openInNewTabs: false })).toBeNull();
    expect(findDiffTabToReuse({ tabs, target: wholeDiff, openInNewTabs: false })).toBeNull();
  });
});
