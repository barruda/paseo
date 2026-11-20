import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";
import { isHttpUrl } from "@/utils/http-url";

interface HostNavigationOwner {
  browserAvailable: boolean;
  /** CUSTOM(assistant-desk): `assistantSidebar` marks the Projects Assistant chat. */
  openAgent(input: { serverId: string; agentId: string; assistantSidebar?: boolean }): void;
  /** CUSTOM(turn-jump) */
  requestTurnJump?(input: { serverId: string; agentId: string; turnStartedAt: string }): void;
  openWorkspace(input: NavigateToWorkspaceInput): void;
  resolveWorkspace(input: { serverId: string; workspaceId: string }): string | null;
  createBrowser(input: { initialUrl: string; hideToolbar?: boolean; tabIcon?: string }): {
    browserId: string;
  };
  /** CUSTOM(browser-no-toolbar): present in a workspace panel; retargets the panel's tab. */
  replaceCurrentTab?(target: { kind: "browser"; browserId: string }): void;
}

export function createPluginHostNavigation(
  serverId: string,
  owner: HostNavigationOwner,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return {
    openAgent: (input) => {
      const { agentId, serverId: targetServerId, turnStartedAt } = input;
      const destinationServerId = targetServerId ?? serverId;
      // CUSTOM(turn-jump): the request waits in a store until the agent's chat has its prompts.
      if (turnStartedAt) {
        owner.requestTurnJump?.({ serverId: destinationServerId, agentId, turnStartedAt });
      }
      // CUSTOM(assistant-desk): the Power Workboard plugin passes `assistantSidebar: true` for its
      // chat, which may be too new for the session to know by its label. Not in the plugin types.
      const { assistantSidebar } = input as { assistantSidebar?: boolean };
      owner.openAgent({
        serverId: destinationServerId,
        agentId,
        ...(assistantSidebar ? { assistantSidebar: true } : {}),
      });
    },
    openWorkspace: ({ workspaceId, serverId: targetServerId }) =>
      owner.openWorkspace({ serverId: targetServerId ?? serverId, workspaceId }),
    openBrowser: owner.browserAvailable
      ? ({ url, workspaceId, serverId: targetServerId, toolbar, icon, replacePanel }) => {
          if (!isHttpUrl(url)) throw new Error("Only absolute HTTP(S) URLs are supported.");
          if (!workspaceId.trim()) throw new Error("workspaceId is required.");
          const destinationServerId = targetServerId ?? serverId;
          const destinationWorkspaceId = owner.resolveWorkspace({
            serverId: destinationServerId,
            workspaceId,
          });
          if (!destinationWorkspaceId)
            throw new Error("Workspace is unavailable on the requested host.");
          // CUSTOM(browser-no-toolbar)
          const { browserId } = owner.createBrowser({
            initialUrl: url,
            ...(toolbar === false ? { hideToolbar: true } : {}),
            ...(icon ? { tabIcon: icon } : {}),
          });
          if (replacePanel && owner.replaceCurrentTab) {
            owner.replaceCurrentTab({ kind: "browser", browserId });
            return;
          }
          owner.openWorkspace({
            serverId: destinationServerId,
            workspaceId: destinationWorkspaceId,
            target: { kind: "browser", browserId },
          });
        }
      : undefined,
  };
}

// CUSTOM(assistant-quick): sidebar items run a hook (close popover/overlay) before navigating.
export function withBeforeNavigate(
  navigation: NonNullable<PluginSurfaceProps["navigation"]>,
  before: () => void,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return {
    openAgent: (input) => {
      before();
      navigation.openAgent(input);
    },
    openWorkspace: (input) => {
      before();
      navigation.openWorkspace(input);
    },
    ...(navigation.openBrowser ? { openBrowser: navigation.openBrowser } : {}),
  };
}
