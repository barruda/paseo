// CUSTOM(new-workspace-terminal): Ctrl/Cmd+J on the New Workspace screen shows a terminal in the
// selected project's folder, under the form, like the workspace bottom panel.
//
// The daemon only runs a terminal inside a workspace, so the panel borrows a workspace that lives
// in the project's folder (its main checkout) and the terminal shows up as a tab there too. The
// panel keeps one terminal per folder and reuses it while the daemon still runs it.
import { create } from "zustand";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface NewWorkspaceTerminal {
  terminalId: string;
  /** The workspace that runs it. Its terminal list is the one to watch. */
  workspaceId: string;
}

interface NewWorkspaceTerminalState {
  /** The panel's terminal per `serverId:cwd`, kept across visits to the screen. */
  terminals: Record<string, NewWorkspaceTerminal>;
  remember(scopeKey: string, terminal: NewWorkspaceTerminal): void;
  forget(scopeKey: string): void;
}

export const useNewWorkspaceTerminalStore = create<NewWorkspaceTerminalState>()((set) => ({
  terminals: {},
  remember: (scopeKey, terminal) =>
    set((state) => ({ terminals: { ...state.terminals, [scopeKey]: terminal } })),
  forget: (scopeKey) =>
    set((state) => {
      const { [scopeKey]: _forgotten, ...terminals } = state.terminals;
      return { terminals };
    }),
}));

export function newWorkspaceTerminalScopeKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd}`;
}

function trimTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The most recently active workspace that lives in `cwd` and is not being archived. */
export function pickTerminalWorkspace(
  workspaces: Iterable<WorkspaceDescriptor>,
  cwd: string,
): WorkspaceDescriptor | null {
  const target = trimTrailingSlashes(cwd);
  let best: WorkspaceDescriptor | null = null;
  for (const workspace of workspaces) {
    if (workspace.archivingAt) continue;
    if (trimTrailingSlashes(workspace.workspaceDirectory) !== target) continue;
    const time = workspace.statusEnteredAt?.getTime() ?? 0;
    if (!best || time > (best.statusEnteredAt?.getTime() ?? 0)) best = workspace;
  }
  return best;
}

/** What the shown panel does next. */
export type NewWorkspaceTerminalStep =
  /** Waiting for the remembered terminal's list, or for a create in flight. */
  | { kind: "wait" }
  | { kind: "no-workspace" }
  | { kind: "create"; workspaceId: string }
  | { kind: "attach"; terminalId: string }
  /** The remembered terminal is gone before the panel ever showed it: drop it and create another. */
  | { kind: "stale" }
  /** The terminal the panel was showing ended (`exit`): hide the panel. */
  | { kind: "exited" };

export function resolveNewWorkspaceTerminalStep(input: {
  /** Where a new terminal goes. */
  workspaceId: string | null;
  /** Terminals of the remembered terminal's workspace, or null while loading. */
  liveTerminalIds: readonly string[] | null;
  rememberedId: string | null;
  /** The terminal this panel has attached to since it mounted. */
  shownId: string | null;
  creating: boolean;
}): NewWorkspaceTerminalStep {
  const { rememberedId, liveTerminalIds } = input;
  if (rememberedId) {
    if (liveTerminalIds === null) {
      return rememberedId === input.shownId
        ? { kind: "attach", terminalId: rememberedId }
        : { kind: "wait" };
    }
    if (liveTerminalIds.includes(rememberedId)) return { kind: "attach", terminalId: rememberedId };
    return rememberedId === input.shownId ? { kind: "exited" } : { kind: "stale" };
  }
  if (!input.workspaceId) return { kind: "no-workspace" };
  if (input.creating) return { kind: "wait" };
  return { kind: "create", workspaceId: input.workspaceId };
}
