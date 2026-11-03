import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useFlexibleTabMovement } from "@/tab-lanes/settings";

export function EditorSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleChange = useCallback(
    (vimKeybindings: boolean) => void updateSettings({ vimKeybindings }),
    [updateSettings],
  );
  return (
    <SettingsSection title={t("settings.editor.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.editor.vimKeybindings")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.editor.vimHint")}</Text>
          </View>
          <Switch
            value={settings.vimKeybindings}
            onValueChange={handleChange}
            accessibilityLabel={t("settings.editor.vimKeybindings")}
            testID="vim-keybindings-toggle"
          />
        </View>
        <FlexibleTabMovementRow />
        <DeskPreviewTabsRow />
        <RecentTabsSkipPinnedRow />
      </View>
    </SettingsSection>
  );
}

// CUSTOM(flexible-tabs): desktop only; Desks are a desktop layout.
function FlexibleTabMovementRow() {
  const { enabled, setEnabled, available } = useFlexibleTabMovement();
  if (!available) return null;
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Flexible tab movement</Text>
        <Text style={settingsStyles.rowHint}>
          In Tasks mode, drop tabs anywhere, on more than one row. Off keeps one packed row.
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={setEnabled}
        accessibilityLabel="Flexible tab movement"
        testID="flexible-tab-movement-toggle"
      />
    </View>
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
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Preview tabs</Text>
        <Text style={settingsStyles.rowHint}>
          In Tasks mode, a click on a task replaces one preview tab and a double click keeps it.
          Off, every click opens the task in its own tab.
        </Text>
      </View>
      <Switch
        value={settings.deskPreviewTabs}
        onValueChange={setEnabled}
        accessibilityLabel="Preview tabs"
        testID="desk-preview-tabs-toggle"
      />
    </View>
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
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Skip pinned tabs</Text>
        <Text style={settingsStyles.rowHint}>
          The Last visited tab shortcut goes through the unpinned tabs only.
        </Text>
      </View>
      <Switch
        value={settings.recentTabsSkipPinned}
        onValueChange={setEnabled}
        accessibilityLabel="Skip pinned tabs"
        testID="recent-tabs-skip-pinned-toggle"
      />
    </View>
  );
}
