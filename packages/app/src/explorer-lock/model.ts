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

/** What one workspace screen sees on a render. */
export interface WorkspaceExplorerLockView {
  /** The screen is the focused route and docks the Explorer (not a compact overlay). */
  active: boolean;
  lockOn: boolean;
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
  if (!current.active || !current.lockOn) return null;
  const sameView = Boolean(
    previous && previous.active && previous.workspaceKey === current.workspaceKey,
  );
  if (sameView && !previous!.lockOn) {
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
