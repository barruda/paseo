// CUSTOM(explorer-lock)
import { describe, expect, it } from "vitest";
import {
  isExplorerLockOn,
  lockSwitchTurnedOn,
  planWorkspaceExplorerLock,
  resolveDeskExplorerOpen,
  resolveExplorerLockWidth,
  shouldSeedLockedWidth,
  type WorkspaceExplorerLockView,
} from "./model";
import { DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";

describe("isExplorerLockOn", () => {
  it("is on in Tasks mode and off in workspaces by default", () => {
    expect(isExplorerLockOn(DEFAULT_CLIENT_SETTINGS, "tasks")).toBe(true);
    expect(isExplorerLockOn(DEFAULT_CLIENT_SETTINGS, "workspaces")).toBe(false);
  });

  it("follows each mode's own setting", () => {
    const settings = { explorerLockTasks: false, explorerLockWorkspaces: true };
    expect(isExplorerLockOn(settings, "tasks")).toBe(false);
    expect(isExplorerLockOn(settings, "workspaces")).toBe(true);
  });
});

describe("resolveDeskExplorerOpen", () => {
  const base = { lockOn: true, hydrated: true, compact: false };

  it("locked, an open sidebar stays open on a tab that had it closed", () => {
    expect(resolveDeskExplorerOpen({ ...base, lockedOpen: true, tabOpen: true }).open).toBe(true);
    // The next tab, agent or Desk: its own state is closed, the sidebar stays open.
    expect(resolveDeskExplorerOpen({ ...base, lockedOpen: true, tabOpen: false })).toEqual({
      locked: true,
      open: true,
    });
  });

  it("locked, a closed sidebar stays closed on a tab that had it open", () => {
    expect(resolveDeskExplorerOpen({ ...base, lockedOpen: false, tabOpen: true })).toEqual({
      locked: true,
      open: false,
    });
  });

  it("unlocked, each tab keeps its own state as before", () => {
    const off = { ...base, lockOn: false, lockedOpen: true };
    expect(resolveDeskExplorerOpen({ ...off, tabOpen: false })).toEqual({
      locked: false,
      open: false,
    });
    expect(resolveDeskExplorerOpen({ ...off, tabOpen: true }).open).toBe(true);
  });

  it("does not apply the default before the saved state loads, nor on compact overlays", () => {
    expect(
      resolveDeskExplorerOpen({ ...base, hydrated: false, lockedOpen: false, tabOpen: true }),
    ).toEqual({ locked: false, open: true });
    expect(
      resolveDeskExplorerOpen({ ...base, compact: true, lockedOpen: false, tabOpen: true }),
    ).toEqual({ locked: false, open: true });
  });
});

describe("planWorkspaceExplorerLock", () => {
  const view = (patch: Partial<WorkspaceExplorerLockView>): WorkspaceExplorerLockView => ({
    active: true,
    lockOn: true,
    settingsLoaded: true,
    workspaceKey: "s1:a",
    visible: false,
    ...patch,
  });

  it("opens the next workspace's sidebar when the locked state is open", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: null,
        current: view({ workspaceKey: "s1:b", visible: false }),
        lockedOpen: true,
      }),
    ).toEqual({ kind: "apply", open: true });
  });

  it("closes the next workspace's sidebar when the locked state is closed", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: view({ active: false, workspaceKey: "s1:b", visible: true }),
        current: view({ workspaceKey: "s1:b", visible: true }),
        lockedOpen: false,
      }),
    ).toEqual({ kind: "apply", open: false });
  });

  it("records an open or close the user makes in the focused workspace", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: view({ visible: false }),
        current: view({ visible: true }),
        lockedOpen: false,
      }),
    ).toEqual({ kind: "record", open: true });
    expect(
      planWorkspaceExplorerLock({
        previous: view({ visible: true }),
        current: view({ visible: false }),
        lockedOpen: true,
      }),
    ).toEqual({ kind: "record", open: false });
  });

  it("does nothing once the sidebar matches the locked state", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: view({ visible: false }),
        current: view({ visible: true }),
        lockedOpen: true,
      }),
    ).toBeNull();
  });

  it("keeps what is on screen when the lock is turned on", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: view({ lockOn: false, visible: true }),
        current: view({ visible: true }),
        lockedOpen: false,
      }),
    ).toEqual({ kind: "record", open: true });
  });

  it("leaves every workspace alone with the lock off, or when the screen is not focused", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: null,
        current: view({ lockOn: false, visible: false }),
        lockedOpen: true,
      }),
    ).toBeNull();
    expect(
      planWorkspaceExplorerLock({
        previous: view({ visible: false }),
        current: view({ active: false, visible: true }),
        lockedOpen: false,
      }),
    ).toBeNull();
  });

  it("applies the saved state when the lock comes on with the settings load", () => {
    // Read before the settings loaded: the default (off). The saved settings turn it on.
    expect(
      planWorkspaceExplorerLock({
        previous: view({ lockOn: false, settingsLoaded: false, visible: false }),
        current: view({ visible: false }),
        lockedOpen: true,
      }),
    ).toEqual({ kind: "apply", open: true });
  });

  it("does nothing before the settings load", () => {
    expect(
      planWorkspaceExplorerLock({
        previous: view({ settingsLoaded: false, visible: false }),
        current: view({ settingsLoaded: false, visible: true }),
        lockedOpen: false,
      }),
    ).toBeNull();
  });
});

describe("lockSwitchTurnedOn", () => {
  const loaded = { settingsLoaded: true };

  it("is a toggle when the switch goes on after the settings loaded", () => {
    expect(lockSwitchTurnedOn({ lockOn: false, ...loaded }, { lockOn: true, ...loaded })).toBe(
      true,
    );
  });

  it("is not a toggle when the saved settings arrive on load", () => {
    expect(
      lockSwitchTurnedOn(
        { lockOn: false, settingsLoaded: false },
        { lockOn: true, settingsLoaded: true },
      ),
    ).toBe(false);
    expect(lockSwitchTurnedOn(null, { lockOn: true, ...loaded })).toBe(false);
  });

  it("is not a toggle when the switch stays on or goes off", () => {
    expect(lockSwitchTurnedOn({ lockOn: true, ...loaded }, { lockOn: true, ...loaded })).toBe(
      false,
    );
    expect(lockSwitchTurnedOn({ lockOn: true, ...loaded }, { lockOn: false, ...loaded })).toBe(
      false,
    );
  });
});

describe("resolveExplorerLockWidth", () => {
  const base = { lockOn: true, hydrated: true, compact: false };

  it("locked, every content gets the same width", () => {
    const a = resolveExplorerLockWidth({ ...base, lockedWidth: 420, ownWidth: 300 });
    const b = resolveExplorerLockWidth({ ...base, lockedWidth: 420, ownWidth: 500 });
    expect(a).toEqual({ locked: true, width: 420 });
    expect(b).toEqual({ locked: true, width: 420 });
  });

  it("locked with no saved width falls back to the own width", () => {
    expect(resolveExplorerLockWidth({ ...base, lockedWidth: null, ownWidth: 300 }).width).toBe(300);
  });

  it("unlocked, not hydrated or compact keep the own width", () => {
    for (const off of [{ lockOn: false }, { hydrated: false }, { compact: true }]) {
      expect(
        resolveExplorerLockWidth({ ...base, ...off, lockedWidth: 420, ownWidth: 300 }),
      ).toEqual({ locked: false, width: 300 });
    }
  });
});

describe("shouldSeedLockedWidth", () => {
  const base = { locked: true, active: true, lockedWidth: null, ownWidth: 300 };

  it("seeds from the active frame's own width when none is saved", () => {
    expect(shouldSeedLockedWidth(base)).toBe(true);
  });

  it("does not seed when unlocked, inactive, already saved or without an own width", () => {
    expect(shouldSeedLockedWidth({ ...base, locked: false })).toBe(false);
    expect(shouldSeedLockedWidth({ ...base, active: false })).toBe(false);
    expect(shouldSeedLockedWidth({ ...base, lockedWidth: 420 })).toBe(false);
    expect(shouldSeedLockedWidth({ ...base, ownWidth: undefined })).toBe(false);
  });
});
