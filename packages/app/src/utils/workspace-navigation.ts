// CUSTOM(desks): explicit supporting-tab launches honor the current Desk mode.
import { openDeskTarget } from "@/task-navigation/open-desk-target";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  prepareWorkspaceTab as prepareWorkspaceTabPure,
  type PrepareWorkspaceTabInput,
} from "./prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type { PrepareWorkspaceTabInput } from "./prepare-workspace-tab";

function layoutStoreDeps() {
  const store = useWorkspaceLayoutStore.getState();
  return {
    openTab: (input: {
      workspaceKey: string;
      target: WorkspaceTabTarget;
      intent: "reveal";
      pin?: boolean;
      placement?: import("@/stores/workspace-layout-actions").WorkspaceTabPlacement;
    }) => openDeskTarget(input) ?? store.openTab(input),
  };
}

export function prepareWorkspaceTab(input: PrepareWorkspaceTabInput): void {
  prepareWorkspaceTabPure(input, layoutStoreDeps());
}
