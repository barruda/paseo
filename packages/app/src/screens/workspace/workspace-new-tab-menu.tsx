import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
// CUSTOM(new-agent-projects)
import { buildNewAgentProjectsPage, NEW_AGENT_PROJECTS_PAGE_ID } from "@/new-agent-projects/menu";
import { Shortcut } from "@/components/ui/shortcut";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { Theme } from "@/styles/theme";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
  type WorkspaceTabLaunchPurpose,
} from "@/workspace-tabs/launcher";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { PaneHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function LaunchItemIconGlyph({
  Icon,
  color = "",
}: {
  Icon: ComponentType<PanelIconProps>;
  color?: string;
}) {
  return <Icon size={14} color={color} />;
}

const ThemedLaunchItemIconGlyph = withUnistyles(LaunchItemIconGlyph);

function LaunchItemIcon({ item }: { item: WorkspaceTabLaunchItem }): ReactElement | null {
  if (item.Icon) {
    return <ThemedLaunchItemIconGlyph Icon={item.Icon} uniProps={mutedColorMapping} />;
  }
  if (item.terminalIconKey) {
    return (
      <View>
        <TerminalProfileIcon iconKey={item.terminalIconKey} size={14} />
      </View>
    );
  }
  return null;
}

function WorkspaceNewTabMenuItem({
  item,
  paneId,
}: {
  item: WorkspaceTabLaunchItem;
  paneId?: string;
}) {
  const leading = useMemo(() => <LaunchItemIcon item={item} />, [item]);
  const trailing = useMemo(
    () =>
      item.shortcutActionId ? <LaunchItemShortcut actionId={item.shortcutActionId} /> : undefined,
    [item.shortcutActionId],
  );
  const handleSelect = useCallback(() => item.launch({ kind: "open", paneId }), [item, paneId]);

  // CUSTOM(new-agent-projects): hover opens the project flyout; a click still opens the default.
  if (item.id === "agent") {
    return (
      <DropdownMenuSubTrigger
        id={NEW_AGENT_PROJECTS_PAGE_ID}
        testID={`workspace-new-tab-menu-${item.id}`}
        leading={leading}
        accessory={trailing}
        disabled={item.disabled}
        onSelect={handleSelect}
      >
        {item.label}
      </DropdownMenuSubTrigger>
    );
  }

  return (
    <DropdownMenuItem
      testID={`workspace-new-tab-menu-${item.id}`}
      leading={leading}
      trailing={trailing}
      disabled={item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

function LaunchItemShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

export function WorkspaceNewTabMenuContent({
  serverId,
  purpose,
  host,
  panePanelKinds,
  paneId,
}: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  panePanelKinds: readonly WorkspaceTabTarget["kind"][];
  paneId?: string;
}) {
  const groups = useWorkspaceTabLaunchCatalog({
    serverId,
    purpose,
    host,
    surface: "menu",
    panePanelKinds,
  });
  // CUSTOM(new-agent-projects)
  const agentItem = groups.flatMap((group) => group.items).find((item) => item.id === "agent");
  const pages = useMemo(
    () =>
      agentItem
        ? [
            buildNewAgentProjectsPage({
              serverId,
              paneId,
              launchDefault: () => agentItem.launch({ kind: "open", paneId }),
            }),
          ]
        : undefined,
    [agentItem, serverId, paneId],
  );

  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      offset={4}
      minWidth={200}
      testID="workspace-new-tab-menu"
      pages={pages}
    >
      {groups.map((group, index) => (
        <View key={group.id}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => (
            <WorkspaceNewTabMenuItem key={item.id} item={item} paneId={paneId} />
          ))}
          {group.accessory ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID={`workspace-new-tab-menu-${group.accessory.id}`}
                onSelect={group.accessory.run}
              >
                {group.accessory.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </View>
      ))}
    </DropdownMenuContent>
  );
}
