// CUSTOM(desk-docs): opens a document from the Docs tab. In Tasks mode it goes to the Desk named
// Navegadores when there is one (and shows that Desk), otherwise to the Desk that is showing. In
// the workspace layout it opens in the project's workspace.
import { useTaskNavigationStore } from "@/task-navigation/store";
import { useDesksStore } from "@/task-navigation/desks-store";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { findBrowsersDesk } from "./model";

export function openDocument(input: { serverId: string; workspaceId: string; path: string }): void {
  const target = { kind: "file", path: input.path } as const;
  if (!useTaskNavigationStore.getState().enabled) {
    navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId, target });
    return;
  }
  const store = useDesksStore.getState();
  const browsersDeskId = findBrowsersDesk(store.desks);
  if (browsersDeskId) store.selectDesk(browsersDeskId);
  useDesksStore
    .getState()
    .openTab({ serverId: input.serverId, workspaceId: input.workspaceId, target }, true);
  useDeskWorkboardStore.getState().deselect();
}
