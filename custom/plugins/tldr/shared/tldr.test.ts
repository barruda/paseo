import { describe, expect, it } from "vitest";
import { tldrPillWorkspace } from "./tldr";

describe("tldrPillWorkspace", () => {
  it("returns the workspace of an open agent", () => {
    expect(tldrPillWorkspace({ id: "a", workspaceId: "w", status: "idle" })).toBe("w");
  });

  it("skips agents without a workspace, archived, or closed", () => {
    expect(tldrPillWorkspace({ id: "a", workspaceId: null, status: "idle" })).toBeNull();
    expect(
      tldrPillWorkspace({ id: "a", workspaceId: "w", status: "idle", archivedAt: "2026-10-19" }),
    ).toBeNull();
    expect(tldrPillWorkspace({ id: "a", workspaceId: "w", status: "closed" })).toBeNull();
  });
});
