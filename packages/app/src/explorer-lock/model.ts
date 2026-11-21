// CUSTOM(explorer-lock): pure rules of "Keep the right sidebar open or closed". With the lock on,
// one remembered open/closed state replaces the per-Desk-tab state (Tasks mode) and the
// per-workspace state (workspace view). See custom/CHANGES.md.

export type ExplorerLockMode = "tasks" | "workspaces";

export interface ExplorerLockSettings {
  explorerLockTasks: boolean;
  explorerLockWorkspaces: boolean;
}

export function isExplorerLockOn(settings: ExplorerLockSettings, mode: ExplorerLockMode): boolean {
  return mode === "tasks" ? settings.explorerLockTasks : settings.explorerLockWorkspaces;
}

/**
 * Tasks mode: whether the Desk's docked Explorer is open. Locked, the saved state wins over the
 * focused tab's own, so switching tabs, agents or Desks changes nothing. Before the saved state
 * loads, and on compact overlays, the tab's own state stays.
 */
export function resolveDeskExplorerOpen(input: {
  lockOn: boolean;
  hydrated: boolean;
  compact: boolean;
  lockedOpen: boolean;
  tabOpen: boolean;
}): { locked: boolean; open: boolean } {
  const locked = input.lockOn && input.hydrated && !input.compact;
  return { locked, open: locked ? input.lockedOpen : input.tabOpen };
}

/**
 * Whether the lock switch was just turned on by the user. A switch read before the settings
 * loaded holds the default, so its change on load is the saved value arriving, not a toggle.
 */
export function lockSwitchTurnedOn(
  previous: { lockOn: boolean; settingsLoaded: boolean } | null,
  current: { lockOn: boolean; settingsLoaded: boolean },
): boolean {
  return Boolean(
    previous?.settingsLoaded && current.settingsLoaded && !previous.lockOn && current.lockOn,
  );
}

/** What one workspace screen sees on a render. */
export interface WorkspaceExplorerLockView {
  /** The screen is the focused route and docks the Explorer (not a compact overlay). */
  active: boolean;
  lockOn: boolean;
  /** The settings have loaded; before that `lockOn` is the default. */
  settingsLoaded: boolean;
  workspaceKey: string;
  visible: boolean;
}

/**
 * - `apply`: the screen came into view (mount, route focus, another workspace): show or hide its
 *   Explorer so it matches the locked state.
 * - `record`: the user opened or closed it here (or just turned the lock on): it becomes the locked
 *   state.
 */
export type WorkspaceExplorerLockAction =
  | { kind: "apply"; open: boolean }
  | { kind: "record"; open: boolean }
  | null;

export function planWorkspaceExplorerLock(input: {
  previous: WorkspaceExplorerLockView | null;
  current: WorkspaceExplorerLockView;
  lockedOpen: boolean;
}): WorkspaceExplorerLockAction {
  const { previous, current, lockedOpen } = input;
  if (!current.settingsLoaded || !current.active || !current.lockOn) return null;
  // A view seen before the settings loaded is not compared against: the lock coming on with the
  // saved settings applies the saved state like a screen coming into view.
  const sameView = Boolean(
    previous &&
    previous.settingsLoaded &&
    previous.active &&
    previous.workspaceKey === current.workspaceKey,
  );
  if (sameView && lockSwitchTurnedOn(previous, current)) {
    // Turning the lock on keeps what is on screen.
    return current.visible === lockedOpen ? null : { kind: "record", open: current.visible };
  }
  if (!sameView) {
    return current.visible === lockedOpen ? null : { kind: "apply", open: lockedOpen };
  }
  if (previous!.visible !== current.visible && current.visible !== lockedOpen) {
    return { kind: "record", open: current.visible };
  }
  return null;
}

/**
 * The right sidebar's width. Locked, one saved width wins over the frame's own (per workspace),
 * so changing the central content changes nothing; with no saved width yet the frame's own stays.
 */
export function resolveExplorerLockWidth(input: {
  lockOn: boolean;
  hydrated: boolean;
  compact: boolean;
  lockedWidth: number | null;
  ownWidth: number | undefined;
}): { locked: boolean; width: number | undefined } {
  const locked = input.lockOn && input.hydrated && !input.compact;
  return { locked, width: locked ? (input.lockedWidth ?? input.ownWidth) : input.ownWidth };
}

/** The first time the lock applies with no saved width, the width on screen becomes the locked one. */
export function shouldSeedLockedWidth(input: {
  locked: boolean;
  active: boolean;
  lockedWidth: number | null;
  ownWidth: number | undefined;
}): boolean {
  return input.locked && input.active && input.lockedWidth === null && input.ownWidth !== undefined;
}
