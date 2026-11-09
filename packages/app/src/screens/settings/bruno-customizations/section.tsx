// CUSTOM(bruno-customizations): Settings > Bruno's Customizations, one place for the settings that
// exist only because of this fork's customizations, in tabs. Moved here from Chat (link list),
// Editor (tab movement, preview tabs, skip pinned) and the host's Voice and dictation page.
// Keyboard shortcuts stay in Shortcuts, plugin settings in each host's Plugins page.

import { useCallback, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { JEV_ROUTER_PLUGIN_ID } from "@getpaseo/protocol/jev-router";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { isNative } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { JevRouterSheet } from "@/jev-router/sheet";
import { useInstalledPlugin } from "@/plugins/registry";
import { VoiceSettingsPage } from "@/screens/settings/voice/voice-settings-page";
import { settingsStyles } from "@/styles/settings";
import { useFlexibleTabMovement } from "@/tab-lanes/settings";
import { CHAT_OPTIONS, chatOptionEnabled, pluginChatOptionKey } from "@/composer/chat-options";
import { pluginButtonStore } from "@/plugins/buttons/store";

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
  for (const entry of entries) {
    if (entry.placement !== "composer" || entry.context.context !== "agent") continue;
    const key = pluginChatOptionKey(entry.installation.id, entry.id, entry.context.agentId);
    if (!options.has(key)) options.set(key, entry.button.title);
  }
  return (
    <SettingsSection title="Chat options">
      <SettingsCard>
        {[...options].map(([key, label]) => (
          <ChatOptionRow key={key} optionKey={key} label={label} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function ChatOptionRow({ optionKey, label }: { optionKey: string; label: string }) {
  const { settings, updateSettings } = useAppSettings();
  const onChange = useCallback(
    (value: boolean) => {
      void updateSettings((current) => ({
        chatOptions: { ...current.chatOptions, [optionKey]: value },
      }));
    },
    [optionKey, updateSettings],
  );
  return (
    <SettingsSwitch
      label={label}
      value={chatOptionEnabled(settings.chatOptions, optionKey)}
      onValueChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function ComposerTab({ serverId }: { serverId: string | null }) {
  const { settings, updateSettings } = useAppSettings();
  const setShowCritic = useCallback(
    (showCriticToggle: boolean) => void updateSettings({ showCriticToggle }),
    [updateSettings],
  );
  const setShowJev = useCallback(
    (showJevRouterToggle: boolean) => void updateSettings({ showJevRouterToggle }),
    [updateSettings],
  );
  return (
    <>
      <SettingsSection title="Toolbar icons">
        <SettingsCard>
          <SettingsSwitch
            label="Critic"
            hint="The critic's icon after the flame, on hosts with the critic plugin."
            value={settings.showCriticToggle}
            onValueChange={setShowCritic}
          />
          <SettingsSwitch
            label="Jev router"
            hint="The router's icon after the critic's. Hidden, the router still runs, ←/→ stay locked in Effort focused and a moved session still gets its green chip."
            value={settings.showJevRouterToggle}
            onValueChange={setShowJev}
          />
        </SettingsCard>
      </SettingsSection>
      {serverId ? <JevRouterSettingsCard serverId={serverId} /> : null}
    </>
  );
}

function JevRouterSettingsCard({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, JEV_ROUTER_PLUGIN_ID);
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
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
          <Button variant="secondary" size="sm" onPress={handleOpen} testID="bruno-jev-settings">
            Open
          </Button>
        </View>
      </View>
      {open ? <JevRouterSheet plugin={plugin} onClose={handleClose} /> : null}
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
