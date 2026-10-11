import { createContext, useContext } from "react";
import type { SidebarWorkspaceLimitResult } from "./model";

const EMPTY: SidebarWorkspaceLimitResult = {
  hiddenWorkspaceKeys: new Set(),
  limitedProjectKeys: new Set(),
};

/** Set by the sidebar model; its own context so a project block re-renders only when it changes. */
export const SidebarWorkspaceLimitContext = createContext<SidebarWorkspaceLimitResult>(EMPTY);

export function useSidebarWorkspaceLimitResult(): SidebarWorkspaceLimitResult {
  return useContext(SidebarWorkspaceLimitContext);
}
