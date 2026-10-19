import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";

export function usePluginHostNavigation(
  serverId: string,
  // CUSTOM(browser-no-toolbar): workspace panels can turn their own tab into a browser.
  replaceCurrentTab?: (target: { kind: "browser"; browserId: string }) => void,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return useMemo(
    () =>
      createPluginHostNavigation(serverId, {
        replaceCurrentTab,
        browserAvailable: getIsElectron(),
        openAgent: navigateToAgent,
        openWorkspace: navigateToWorkspace,
        createBrowser: createWorkspaceBrowser,
        resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
          resolveWorkspaceMapKeyByIdentity({
            workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
            workspaceId,
          }),
      }),
    [replaceCurrentTab, serverId],
  );
}
