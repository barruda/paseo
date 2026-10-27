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
