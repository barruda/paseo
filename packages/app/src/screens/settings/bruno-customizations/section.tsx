// CUSTOM(bruno-customizations): Settings > Bruno's Customizations, one place for the settings that
// exist only because of this fork's customizations, in tabs. Moved here from Chat (link list),
// Editor (tab movement, preview tabs, skip pinned) and the host's Voice and dictation page.
// Keyboard shortcuts stay in Shortcuts, plugin settings in each host's Plugins page.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  JEV_ROUTER_PLUGIN_ID,
  JEV_ROUTER_RPC,
  JevRouteOutputSchema,
  type JevRouteOutput,
} from "@getpaseo/protocol/jev-router";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { isNative } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { JevProviderSheet } from "@/jev-router/provider-sheet";
import { JevRouterSheet } from "@/jev-router/sheet";
import { DELEGATION_PLUGIN_ID } from "@getpaseo/protocol/delegation"; // CUSTOM(delegation)
import { DelegationSheet } from "@/delegation/sheet"; // CUSTOM(delegation)
import { toErrorMessage } from "@/utils/error-messages";
import { useInstalledPlugin } from "@/plugins/registry";
import { VoiceSettingsPage } from "@/screens/settings/voice/voice-settings-page";
import { settingsStyles } from "@/styles/settings";
import { useFlexibleTabMovement } from "@/tab-lanes/settings";
import { CHAT_OPTIONS, chatOptionEnabled, pluginChatOptionKey } from "@/composer/chat-options";
import { pluginButtonStore } from "@/plugins/buttons/store";
import { PluginIconView } from "@/plugins/icons";
import type { PluginIcon } from "@getpaseo/plugin/client";
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

type CustomizationsTab = "composer" | "chat" | "chat-options" | "tabs" | "voice";

const TAB_OPTIONS: SegmentedControlOption<CustomizationsTab>[] = [
  { value: "composer", label: "Composer", testID: "bruno-tab-composer" },
  { value: "chat", label: "Chat", testID: "bruno-tab-chat" },
  { value: "chat-options", label: "Chat Options", testID: "bruno-tab-chat-options" },
  { value: "tabs", label: "Tabs", testID: "bruno-tab-tabs" },
  { value: "voice", label: "Voice", testID: "bruno-tab-voice" },
];

export function BrunoCustomizationsSection({ serverId }: { serverId: string | null }) {
  const [tab, setTab] = useState<CustomizationsTab>("composer");
  return (
    <View style={styles.page}>
      <SegmentedControl
        options={TAB_OPTIONS}
        value={tab}
        onValueChange={setTab}
        size="sm"
        style={styles.tabs}
        testID="bruno-customizations-tabs"
      />
      {tab === "composer" ? <ComposerTab serverId={serverId} /> : null}
      {tab === "chat" ? <ChatTab /> : null}
      {tab === "chat-options" ? <ChatOptionsTab /> : null}
      {tab === "tabs" ? <TabsTab /> : null}
      {tab === "voice" ? <VoiceTab serverId={serverId} /> : null}
    </View>
  );
}

// CUSTOM(chat-options): show registered plugin pills as well as the built-in rail items.
function ChatOptionsTab() {
  const entries = useSyncExternalStore(
    pluginButtonStore.subscribe,
    pluginButtonStore.getSnapshot,
    pluginButtonStore.getSnapshot,
  );
  const options = new Map<string, string>(CHAT_OPTIONS);
  const icons = new Map<string, PluginIcon>();
  for (const entry of entries) {
    if (entry.placement !== "composer" || entry.context.context !== "agent") continue;
    const key = pluginChatOptionKey(entry.installation.id, entry.id, entry.context.agentId);
    if (!options.has(key)) options.set(key, entry.button.title);
    if (!icons.has(key) && typeof entry.button.icon === "string") icons.set(key, entry.button.icon);
  }
  return (
    <SettingsSection title="Chat options">
      <SettingsCard>
        {[...options].map(([key, label]) => (
          <ChatOptionRow
            key={key}
            optionKey={key}
            label={label}
            icon={OPTION_ICONS[key] ?? icons.get(key) ?? "Settings2"}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function ChatOptionRow({
  optionKey,
  label,
  icon,
}: {
  optionKey: string;
  label: string;
  icon: PluginIcon;
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
    <SettingsRow label={label} labelAccessory={accessory}>
      <Switch accessibilityLabel={label} value={enabled} onValueChange={onChange} />
    </SettingsRow>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function ComposerTab({ serverId }: { serverId: string | null }) {
  return serverId ? (
    <>
      <JevRouterSettingsCard serverId={serverId} />
      <DelegationSettingsCard serverId={serverId} />
    </>
  ) : null;
}

// CUSTOM(delegation): the same sheet as the composer icon's caret.
function DelegationSettingsCard({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, DELEGATION_PLUGIN_ID);
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  if (!plugin) return null;
  return (
    <SettingsSection title="Delegation">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Delegation settings</Text>
            <Text style={settingsStyles.rowHint}>
              On or off, the implementer&apos;s model and effort, when to delegate, review and
              search, for this host&apos;s new Opus/Fable sessions. Same sheet as the composer icon.
            </Text>
          </View>
          <Button variant="secondary" size="sm" onPress={handleOpen} testID="bruno-delegation">
            Open
          </Button>
        </View>
      </View>
      {open ? <DelegationSheet plugin={plugin} onClose={handleClose} /> : null}
    </SettingsSection>
  );
}

type JevSheet = "router" | "provider" | null;

const JEV_TEST_PROMPT = "Rename the variable `count` to `total` in utils.ts";

function describeJevTest(output: JevRouteOutput): string {
  if (output.status === "skipped") return `Skipped: ${output.reason}`;
  const { decision } = output;
  if (decision.error) return `Jev failed (the session keeps ${output.home}): ${decision.error}`;
  const latency = decision.latencyMs === null ? "" : `, ${decision.latencyMs} ms`;
  return `Jev answered: ${decision.model}/${decision.effort}${latency}`;
}

function JevRouterSettingsCard({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, JEV_ROUTER_PLUGIN_ID);
  const [open, setOpen] = useState<JevSheet>(null);
  const [test, setTest] = useState<{ running: boolean; result: string | null }>({
    running: false,
    result: null,
  });
  const handleOpenRouter = useCallback(() => setOpen("router"), []);
  const handleOpenProvider = useCallback(() => setOpen("provider"), []);
  const handleClose = useCallback(() => setOpen(null), []);
  const handleTest = useCallback(async () => {
    if (!plugin) return;
    setTest({ running: true, result: null });
    try {
      const output = JevRouteOutputSchema.parse(
        await plugin.invoke(JEV_ROUTER_RPC.route, {
          prompt: JEV_TEST_PROMPT,
          cwd: "/tmp",
          images: 0,
          provider: "claude",
          model: "claude-opus-5-5",
          thinkingOptionId: "high",
          test: true,
        }),
      );
      setTest({ running: false, result: describeJevTest(output) });
    } catch (error) {
      setTest({ running: false, result: toErrorMessage(error) });
    }
  }, [plugin]);
  const handleTestPress = useCallback(() => void handleTest(), [handleTest]);
  if (!plugin) return null;
  return (
    <SettingsSection title="Jev router">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Router settings</Text>
            <Text style={settingsStyles.rowHint}>
              On or off, Model focused or Effort focused, and each mode&apos;s models, efforts and
              thresholds, for this host. Same sheet as the composer icon.
            </Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleOpenRouter}
            testID="bruno-jev-settings"
          >
            Open
          </Button>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>TypeSafe provider</Text>
            <Text style={settingsStyles.rowHint}>
              API key, endpoint and Jev model this host calls Jev with. Each host keeps its own.
            </Text>
            {test.result ? (
              <Text selectable style={settingsStyles.rowHint} testID="bruno-jev-provider-result">
                {test.result}
              </Text>
            ) : null}
          </View>
          <Button
            variant="ghost"
            size="sm"
            onPress={handleTestPress}
            disabled={test.running}
            testID="bruno-jev-provider-test"
          >
            {test.running ? "Testing…" : "Test"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleOpenProvider}
            testID="bruno-jev-provider"
          >
            Edit
          </Button>
        </View>
      </View>
      {open === "router" ? <JevRouterSheet plugin={plugin} onClose={handleClose} /> : null}
      {open === "provider" ? <JevProviderSheet plugin={plugin} onClose={handleClose} /> : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function ChatTab() {
  const { settings, updateSettings } = useAppSettings();
  // CUSTOM(chat-links)
  const changeChatLinks = useCallback(
    (chatLinksEnabled: boolean) => void updateSettings({ chatLinksEnabled }),
    [updateSettings],
  );
  if (isNative) return <EmptyTab text="Nothing to set on this device." />;
  return (
    <SettingsSection title="Beside the chat">
      <SettingsCard>
        <SettingsSwitch
          label="Link list"
          hint="Show the links the agent sent beside the chat"
          value={settings.chatLinksEnabled}
          onValueChange={changeChatLinks}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Tabs (Tasks mode Desks)
// ---------------------------------------------------------------------------

function TabsTab() {
  return (
    <SettingsSection title="Tasks mode tabs">
      <View style={settingsStyles.card}>
        <FlexibleTabMovementRow first />
        <DeskPreviewTabsRow />
        <RecentTabsSkipPinnedRow />
      </View>
    </SettingsSection>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onValueChange,
  testID,
  first = false,
}: {
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
  first?: boolean;
}) {
  return (
    <View style={[settingsStyles.row, !first && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={title}
        testID={testID}
      />
    </View>
  );
}

// CUSTOM(flexible-tabs): desktop only; Desks are a desktop layout.
function FlexibleTabMovementRow({ first }: { first?: boolean }) {
  const { enabled, setEnabled, available } = useFlexibleTabMovement();
  if (!available) return null;
  return (
    <ToggleRow
      first={first}
      title="Flexible tab movement"
      hint="In Tasks mode, drop tabs anywhere, on more than one row. Off keeps one packed row."
      value={enabled}
      onValueChange={setEnabled}
      testID="flexible-tab-movement-toggle"
    />
  );
}

// CUSTOM(desk-preview-tabs)
function DeskPreviewTabsRow() {
  const { settings, updateSettings } = useAppSettings();
  const setEnabled = useCallback(
    (deskPreviewTabs: boolean) => void updateSettings({ deskPreviewTabs }),
    [updateSettings],
  );
  return (
    <ToggleRow
      title="Preview tabs"
      hint="In Tasks mode, a click on a task replaces one preview tab and a double click keeps it. Off, every click opens the task in its own tab."
      value={settings.deskPreviewTabs}
      onValueChange={setEnabled}
      testID="desk-preview-tabs-toggle"
    />
  );
}

// CUSTOM(recent-tabs)
function RecentTabsSkipPinnedRow() {
  const { settings, updateSettings } = useAppSettings();
  const setEnabled = useCallback(
    (recentTabsSkipPinned: boolean) => void updateSettings({ recentTabsSkipPinned }),
    [updateSettings],
  );
  return (
    <ToggleRow
      title="Skip pinned tabs"
      hint="The Last visited tab shortcut goes through the unpinned tabs only."
      value={settings.recentTabsSkipPinned}
      onValueChange={setEnabled}
      testID="recent-tabs-skip-pinned-toggle"
    />
  );
}

// ---------------------------------------------------------------------------
// Voice (host)
// ---------------------------------------------------------------------------

function VoiceTab({ serverId }: { serverId: string | null }) {
  if (!serverId) return <EmptyTab text="Connect a host to set its voice and dictation." />;
  return <VoiceSettingsPage serverId={serverId} />;
}

function EmptyTab({ text }: { text: string }) {
  return <Text style={settingsStyles.rowHint}>{text}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  page: {
    gap: theme.spacing[4],
  },
  tabs: {
    alignSelf: "flex-start",
  },
}));
