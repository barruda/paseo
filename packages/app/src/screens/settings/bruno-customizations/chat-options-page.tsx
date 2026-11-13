// CUSTOM(chat-options): Settings > Bruno's Customizations > Chat Options. The composer's items in
// three groups (above the chat, inside the composer on the left and on the right). Each item can
// be hidden; the movable ones can be dragged to reorder within their group (`chatOptionOrder`).

import { memo, useCallback, useMemo, useSyncExternalStore, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GripVertical } from "lucide-react-native";
import type { PluginIcon } from "@getpaseo/plugin/client";
import { SettingsRow, SettingsSection } from "@/components/settings";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { Switch } from "@/components/ui/switch";
import { createControlGeometry } from "@/components/ui/control-geometry";
import {
  CHAT_OPTIONS,
  FIXED_CHAT_OPTION_HINTS,
  UNHIDEABLE_CHAT_OPTIONS,
  chatOptionEnabled,
  defaultAboveOrder,
  fixedChatOptions,
  movableChatOptions,
  orderChatOptions,
  pluginChatOptionKey,
  type ChatOptionGroup,
} from "@/composer/chat-options";
import { useAppSettings } from "@/hooks/use-settings";
import { pluginButtonStore } from "@/plugins/buttons/store";
import { PluginIconView } from "@/plugins/icons";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedOptionIcon = withUnistyles(PluginIconView);
const iconColors = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const OPTION_ICONS: Record<string, PluginIcon> = {
  parent: "Bot",
  tasks: "ListTodo",
  subagents: "Users",
  "plugin:tldr:tldr": "ScrollText",
  commit: "GitCommitHorizontal",
  rename: "Pencil",
  "plugin:skills:skills": "Sparkles",
  "plugin:tell-agent:message-agent": "MessagesSquare",
  "plugin:token-ledger:ledger-pill": "Coins",
  diff: "FileDiff",
  worktree: "GitBranch",
  "git-sync": "GitMerge",
  reading: "Columns3",
  attachments: "Plus",
  model: "Sparkle",
  effort: "Brain",
  mode: "ShieldOff",
  "feature:fast_mode": "Zap",
  "feature:plan_mode": "ListTodo",
  "feature:other": "Settings2",
  "model-shortcut": "Keyboard",
  "cache-warmup": "Flame",
  critic: "ScanEye",
  jev: "Route",
  delegation: "Split", // CUSTOM(delegation)
  branch: "GitBranch",
  project: "Folder",
  "context-meter": "CircleGauge",
  dictation: "Mic",
  voice: "AudioLines",
  send: "ArrowUp",
  stop: "Square",
};

const ThemedGrip = withUnistyles(GripVertical);
const HANDLE_ICON_SIZE = 16;
const gripColors = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const GROUP_TITLES: Record<ChatOptionGroup, string> = {
  above: "Above chat",
  left: "Inside left",
  right: "Inside right",
};

const keyOf = (key: string) => key;

function collectOptions(entries: ReturnType<typeof pluginButtonStore.getSnapshot>) {
  const labels = new Map<string, string>(CHAT_OPTIONS);
  const icons = new Map<string, PluginIcon>();
  const pluginKeys: string[] = [];
  for (const entry of entries) {
    if (entry.placement !== "composer" || entry.context.context !== "agent") continue;
    const key = pluginChatOptionKey(entry.installation.id, entry.id, entry.context.agentId);
    if (!labels.has(key)) {
      labels.set(key, entry.button.title);
      pluginKeys.push(key);
    }
    if (!icons.has(key) && typeof entry.button.icon === "string") {
      icons.set(key, entry.button.icon);
    }
  }
  return { labels, icons, pluginKeys };
}

export function BrunoChatOptionsPage() {
  const entries = useSyncExternalStore(
    pluginButtonStore.subscribe,
    pluginButtonStore.getSnapshot,
    pluginButtonStore.getSnapshot,
  );
  const { labels, icons, pluginKeys } = useMemo(() => collectOptions(entries), [entries]);
  return (
    <>
      <OptionGroup group="above" labels={labels} icons={icons} pluginKeys={pluginKeys} />
      <OptionGroup group="left" labels={labels} icons={icons} pluginKeys={pluginKeys} />
      <OptionGroup group="right" labels={labels} icons={icons} pluginKeys={pluginKeys} />
    </>
  );
}

function OptionGroup({
  group,
  labels,
  icons,
  pluginKeys,
}: {
  group: ChatOptionGroup;
  labels: ReadonlyMap<string, string>;
  icons: ReadonlyMap<string, PluginIcon>;
  pluginKeys: readonly string[];
}) {
  const { settings, updateSettings } = useAppSettings();
  const saved = settings.chatOptionOrder[group];
  const defaults =
    group === "above" ? defaultAboveOrder(pluginKeys) : [...movableChatOptions(group)];
  const movable = orderChatOptions(defaults, saved);
  const fixed = fixedChatOptions(group);
  const handleDragEnd = useCallback(
    (next: string[]) => {
      void updateSettings((current) => ({
        chatOptionOrder: { ...current.chatOptionOrder, [group]: next },
      }));
    },
    [group, updateSettings],
  );
  const renderItem = useCallback(
    ({ item, index, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<string>) => (
      <View
        style={[
          styles.movableRow,
          (index > 0 || fixed.before.length > 0) && settingsStyles.rowBorder,
          isActive && styles.active,
        ]}
      >
        <View
          accessibilityLabel={`Drag ${labels.get(item) ?? item}`}
          onTouchStart={drag}
          style={styles.handle}
          {...(dragHandleProps?.attributes as object | undefined)}
          {...(dragHandleProps?.listeners as object | undefined)}
          ref={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
        >
          <ThemedGrip size={HANDLE_ICON_SIZE} uniProps={gripColors} />
        </View>
        <View style={styles.rowBody}>
          <ChatOptionRow
            optionKey={item}
            label={labels.get(item) ?? item}
            icon={OPTION_ICONS[item] ?? icons.get(item) ?? "Settings2"}
            hideable={!UNHIDEABLE_CHAT_OPTIONS.has(item)}
          />
        </View>
      </View>
    ),
    [fixed.before.length, icons, labels],
  );
  const renderFixed = (key: string, index: number): ReactElement => (
    <View
      key={key}
      style={[styles.fixedRow, (index > 0 || group === "right") && settingsStyles.rowBorder]}
    >
      <ChatOptionRow
        optionKey={key}
        label={labels.get(key) ?? key}
        icon={OPTION_ICONS[key] ?? "Settings2"}
        hint={FIXED_CHAT_OPTION_HINTS[key]}
      />
    </View>
  );
  return (
    <SettingsSection title={GROUP_TITLES[group]}>
      <View style={settingsStyles.card} testID={`chat-options-${group}`}>
        {fixed.before.map(renderFixed)}
        <DraggableList
          data={movable}
          keyExtractor={keyOf}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          scrollEnabled={false}
          useDragHandle
          testID={`chat-options-${group}-list`}
        />
        {fixed.after.map(renderFixed)}
      </View>
    </SettingsSection>
  );
}

const ChatOptionRow = memo(function ChatOptionRow({
  optionKey,
  label,
  icon,
  hint,
  hideable = true,
}: {
  optionKey: string;
  label: string;
  icon: PluginIcon;
  hint?: string;
  hideable?: boolean;
}) {
  const { settings, updateSettings } = useAppSettings();
  const accessory = useMemo(
    () => <ThemedOptionIcon icon={icon} size={16} uniProps={iconColors} />,
    [icon],
  );
  let enabled = chatOptionEnabled(settings.chatOptions, optionKey);
  if (optionKey === "critic") enabled = settings.showCriticToggle;
  if (optionKey === "jev") enabled = settings.showJevRouterToggle;
  const onChange = useCallback(
    (value: boolean) => {
      if (optionKey === "critic") {
        void updateSettings({ showCriticToggle: value });
        return;
      }
      if (optionKey === "jev") {
        void updateSettings({ showJevRouterToggle: value });
        return;
      }
      void updateSettings((current) => ({
        chatOptions: { ...current.chatOptions, [optionKey]: value },
      }));
    },
    [optionKey, updateSettings],
  );
  return (
    <SettingsRow label={label} labelAccessory={accessory} hint={hint}>
      {hideable ? (
        <Switch accessibilityLabel={label} value={enabled} onValueChange={onChange} />
      ) : (
        // Keeps the row as tall as the ones with a switch.
        <View style={styles.switchPlaceholder} />
      )}
    </SettingsRow>
  );
});

const styles = StyleSheet.create((theme) => ({
  movableRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
  },
  active: {
    opacity: 0.85,
  },
  handle: {
    paddingLeft: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowBody: {
    flex: 1,
  },
  switchPlaceholder: {
    minHeight: createControlGeometry(theme).switchControl.minHeight,
  },
  // Lines fixed rows up with the movable ones, which start after the grip handle.
  fixedRow: {
    paddingLeft: theme.spacing[3] + HANDLE_ICON_SIZE,
  },
}));
