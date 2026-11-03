// CUSTOM(recent-tabs): the switcher the "Last visited tab" shortcut opens in the middle of the
// screen, like Alt+Tab. It lists the walked tabs in visit order and highlights the one the walk is
// on; `recent-tabs.ts` switches to it when the modifier is released. Rendered by each screen that
// owns a tab row (a workspace, a Desk), under the providers its tab descriptors read.
import { memo, useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import {
  WorkspaceTabOptionRow,
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { chooseRecentTab, useRecentTabWalk } from "./recent-tabs";

export interface RecentTabOwner {
  serverId: string;
  workspaceId: string;
}

export function RecentTabSwitcher({
  scope,
  tabs,
  ownerOf,
}: {
  scope: string | null;
  tabs: readonly WorkspaceTab[];
  ownerOf: (tabId: string) => RecentTabOwner | null;
}) {
  const walk = useRecentTabWalk(isWeb ? scope : null);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tabId, tab])), [tabs]);
  if (!walk || !scope) return null;
  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.panel} testID="recent-tab-switcher">
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {walk.order.map((tabId, index) => {
            const tab = tabsById.get(tabId);
            const owner = ownerOf(tabId);
            if (!tab || !owner) return null;
            return (
              <RecentTabSwitcherRow
                key={tabId}
                scope={scope}
                tab={tab}
                owner={owner}
                highlighted={index === walk.index}
              />
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const RecentTabSwitcherRow = memo(function RecentTabSwitcherRow({
  scope,
  tab,
  owner,
  highlighted,
}: {
  scope: string;
  tab: WorkspaceTab;
  owner: RecentTabOwner;
  highlighted: boolean;
}) {
  const descriptor = useMemo<WorkspaceTabDescriptor>(
    () => ({ key: tab.tabId, tabId: tab.tabId, kind: tab.target.kind, target: tab.target }),
    [tab],
  );
  const choose = useCallback(() => chooseRecentTab(scope, tab.tabId), [scope, tab.tabId]);
  const renderPresentation = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <View
        style={highlighted ? styles.highlighted : undefined}
        testID={highlighted ? "recent-tab-switcher-highlighted" : undefined}
      >
        <WorkspaceTabOptionRow
          presentation={presentation}
          selected={false}
          active={false}
          onPress={choose}
        />
      </View>
    ),
    [choose, highlighted],
  );
  return (
    <WorkspaceTabPresentationResolver
      tab={descriptor}
      serverId={owner.serverId}
      workspaceId={owner.workspaceId}
    >
      {renderPresentation}
    </WorkspaceTabPresentationResolver>
  );
});

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    width: 420,
    maxWidth: "90%",
    maxHeight: "70%",
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.lg,
  },
  list: {
    flexGrow: 0,
  },
  // The option row's own active fill (surface1) barely shows on the panel's surface0.
  highlighted: {
    backgroundColor: theme.colors.surface2,
  },
  listContent: {
    paddingTop: theme.spacing[1],
  },
}));
