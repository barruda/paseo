import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  newWorkspaceTerminalScopeKey,
  pickTerminalWorkspace,
  resolveNewWorkspaceTerminalStep,
  useNewWorkspaceTerminalStore,
} from "./bottom-terminal";

function workspace(
  id: string,
  workspaceDirectory: string,
  extra: Partial<WorkspaceDescriptor> = {},
): WorkspaceDescriptor {
  return {
    id,
    workspaceDirectory,
    archivingAt: null,
    statusEnteredAt: null,
    ...extra,
  } as WorkspaceDescriptor;
}

describe("pickTerminalWorkspace", () => {
  it("picks the most recently active workspace in the folder", () => {
    const picked = pickTerminalWorkspace(
      [
        workspace("old", "/repo", { statusEnteredAt: new Date(1_000) }),
        workspace("tree", "/repo-wt", { statusEnteredAt: new Date(9_000) }),
        workspace("new", "/repo/", { statusEnteredAt: new Date(5_000) }),
      ],
      "/repo",
    );
    expect(picked?.id).toBe("new");
  });

  it("skips workspaces being archived, and returns null when none is left", () => {
    expect(
      pickTerminalWorkspace([workspace("gone", "/repo", { archivingAt: "2026-10-11" })], "/repo"),
    ).toBeNull();
  });
});

describe("resolveNewWorkspaceTerminalStep", () => {
  const base = {
    workspaceId: "ws",
    liveTerminalIds: [] as string[] | null,
    rememberedId: null as string | null,
    shownId: null as string | null,
    creating: false,
  };

  it("creates a terminal in the workspace, once", () => {
    expect(resolveNewWorkspaceTerminalStep({ ...base, liveTerminalIds: null })).toEqual({
      kind: "create",
      workspaceId: "ws",
    });
    expect(resolveNewWorkspaceTerminalStep({ ...base, creating: true }).kind).toBe("wait");
  });

  it("says so when the folder has no workspace", () => {
    expect(resolveNewWorkspaceTerminalStep({ ...base, workspaceId: null }).kind).toBe(
      "no-workspace",
    );
  });

  it("reuses the remembered terminal while the daemon runs it", () => {
    expect(
      resolveNewWorkspaceTerminalStep({ ...base, rememberedId: "t1", liveTerminalIds: ["t1"] }),
    ).toEqual({ kind: "attach", terminalId: "t1" });
  });

  it("keeps showing its terminal while the list reloads", () => {
    const reloading = { ...base, rememberedId: "t1", liveTerminalIds: null };
    expect(resolveNewWorkspaceTerminalStep({ ...reloading, shownId: "t1" }).kind).toBe("attach");
    expect(resolveNewWorkspaceTerminalStep(reloading).kind).toBe("wait");
  });

  it("replaces a terminal that ended before it was shown, and hides after one that ends", () => {
    const gone = { ...base, rememberedId: "t1", liveTerminalIds: ["t2"] };
    expect(resolveNewWorkspaceTerminalStep(gone).kind).toBe("stale");
    expect(resolveNewWorkspaceTerminalStep({ ...gone, shownId: "t1" }).kind).toBe("exited");
  });
});

describe("useNewWorkspaceTerminalStore", () => {
  it("remembers one terminal per folder and forgets it", () => {
    const key = newWorkspaceTerminalScopeKey("srv", "/repo");
    const other = { terminalId: "t2", workspaceId: "ws2" };
    const store = useNewWorkspaceTerminalStore.getState();
    store.remember(key, { terminalId: "t1", workspaceId: "ws" });
    store.remember(newWorkspaceTerminalScopeKey("srv", "/other"), other);
    expect(useNewWorkspaceTerminalStore.getState().terminals[key]?.terminalId).toBe("t1");
    store.forget(key);
    expect(useNewWorkspaceTerminalStore.getState().terminals).toEqual({ "srv:/other": other });
  });
});
