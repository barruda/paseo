import type { PluginButtonContentProps, PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SkillBrowser } from "./browser";
import { LoadedView } from "./loaded";

/** Which Skills tab the popover's open button leads to: the pill's own agent's. */
export type SkillsTabTarget = { workspaceId: string; agentId: string };

// The host pads the popover itself, so this is only the spacing between rows.
const PADDING = 12;

// CUSTOM(skills-loaded): the popover has two tabs; the original browser is the first.
type PopoverTab = "search" | "loaded";
const TABS: ReadonlyArray<{ id: PopoverTab; label: string }> = [
  { id: "search", label: "Search Skill" },
  { id: "loaded", label: "Skills and MCPs Loaded" },
];

/**
 * The composer pill's popover: the Skills tab's own browser, drawn inside the
 * surface Paseo anchors to the pill, under a header whose button opens the tab.
 *
 * Content props carry no `openPanel` — only the client context has it — so the
 * pill hands in the one call the header needs. Built once per client entry, not
 * per pill: the target arrives in the props.
 */
export function createSkillsPopover(openTab: (target: SkillsTabTarget) => void) {
  return function SkillsPopover(props: PluginButtonContentProps) {
    // The union also covers header buttons; a composer pill is always an agent's.
    if (props.context !== "agent") return null;
    return (
      <SkillsPopoverBody
        theme={props.theme}
        compact={props.layout.compact}
        target={{ workspaceId: props.workspaceId, agentId: props.agentId }}
        close={props.close}
        openTab={openTab}
      />
    );
  };
}

function SkillsPopoverBody({
  theme,
  compact,
  target,
  close,
  openTab,
}: {
  theme: PluginHostProps["theme"];
  compact: boolean;
  target: SkillsTabTarget;
  close: () => void;
  openTab: (target: SkillsTabTarget) => void;
}) {
  const { workspaceId, agentId } = target;
  const [tab, setTab] = useState<PopoverTab>("search");
  const styles = useMemo(
    () => ({
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: PADDING,
      },
      title: { color: theme.colors.foreground, fontSize: 15 },
      open: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        marginLeft: "auto" as const,
      },
      openLabel: { color: theme.colors.accent, fontSize: 13 },
      // CUSTOM(skills-loaded)
      tabs: {
        flexDirection: "row" as const,
        gap: 4,
        marginBottom: PADDING,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      tab: { paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: "transparent" },
      tabActive: { borderBottomColor: theme.colors.accent },
      tabLabel: { color: theme.colors.foregroundMuted, fontSize: 13 },
      tabLabelActive: { color: theme.colors.foreground },
    }),
    [theme],
  );

  const handleOpenTab = useCallback(() => {
    openTab({ workspaceId, agentId });
    close();
  }, [openTab, close, workspaceId, agentId]);

  return (
    <View>
      <View style={styles.header}>
        {/* A compact layout presents this as a sheet the host already titles. */}
        {compact ? null : <Text style={styles.title}>Skills/MCPs</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the Skills tab"
          hitSlop={8}
          style={styles.open}
          onPress={handleOpenTab}
        >
          <Text style={styles.openLabel}>Open tab</Text>
          <Icon name="Maximize2" size={13} color={theme.colors.accent} />
        </Pressable>
      </View>
      {/* CUSTOM(skills-loaded) */}
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active ? styles.tabActive : null]}
              onPress={() => setTab(item.id)}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === "search" ? (
        /* The composer under this popover is already the agent's, so a successful
           invoke only has to get out of the way of the turn it started. */
        <SkillBrowser
          theme={theme}
          frame="popover"
          padding={PADDING}
          agentId={agentId}
          onInvoked={close}
        />
      ) : (
        <LoadedView theme={theme} agentId={agentId} />
      )}
    </View>
  );
}
