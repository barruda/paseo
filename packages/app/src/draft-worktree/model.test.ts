import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveDraftWorktreeNames,
  resolveDraftWorktreeRequest,
  useDraftWorktreeStore,
} from "./model";

describe("resolveDraftWorktreeNames", () => {
  it("slugs a typed name into both the directory and the branch", () => {
    expect(resolveDraftWorktreeNames("Login Fix!")).toEqual({
      worktreeSlug: "login-fix",
      branchName: "login-fix",
    });
  });

  it("leaves the branch to the daemon when no name is typed", () => {
    expect(resolveDraftWorktreeNames("  ", () => "dazzling-yak")).toEqual({
      worktreeSlug: "dazzling-yak",
    });
  });
});

describe("useDraftWorktreeStore", () => {
  beforeEach(() => useDraftWorktreeStore.setState({ byDraftId: {} }));

  it("picks the worktree as soon as a name is typed", () => {
    useDraftWorktreeStore.getState().setName("d1", "auth");
    expect(useDraftWorktreeStore.getState().byDraftId.d1).toEqual({
      isolation: "worktree",
      name: "auth",
      baseBranch: null,
    });
  });

  it("keeps the picked worktree when the name is cleared", () => {
    const store = useDraftWorktreeStore.getState();
    store.setIsolation("d1", "worktree");
    store.setName("d1", "");
    expect(useDraftWorktreeStore.getState().byDraftId.d1?.isolation).toBe("worktree");
  });
});

describe("resolveDraftWorktreeRequest", () => {
  const source = { projectId: "p1", currentBranch: "custom" };
  beforeEach(() => useDraftWorktreeStore.setState({ byDraftId: {} }));

  it("starts in the draft's own checkout while Local is picked", () => {
    expect(resolveDraftWorktreeRequest("d1", source)).toBeNull();
  });

  it("branches off the checkout's current branch by default", () => {
    useDraftWorktreeStore.getState().setName("d1", "teste-novo");
    expect(resolveDraftWorktreeRequest("d1", source)).toEqual({
      projectId: "p1",
      name: "teste-novo",
      baseBranch: "custom",
    });
  });

  it("uses an edited branch, and editing it picks the worktree", () => {
    useDraftWorktreeStore.getState().setBaseBranch("d1", "main");
    expect(resolveDraftWorktreeRequest("d1", source)).toEqual({
      projectId: "p1",
      name: "",
      baseBranch: "main",
    });
  });

  it("leaves the base to the daemon when the branch is unknown and untouched", () => {
    useDraftWorktreeStore.getState().setIsolation("d1", "worktree");
    expect(resolveDraftWorktreeRequest("d1", { projectId: "p1", currentBranch: null })).toEqual({
      projectId: "p1",
      name: "",
    });
  });
});
