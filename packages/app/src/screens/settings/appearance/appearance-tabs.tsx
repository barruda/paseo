// CUSTOM(appearance-plugin-tabs): Settings > Appearance as tabs. "General" is the stock content;
// each following tab is a plugin's settings screen (see plugins/relocated-settings.ts).
import { useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { resolveAppearancePluginTabs } from "@/plugins/relocated-settings";
import { useInstalledPlugins } from "@/plugins/registry";
import { PluginSettingsContent } from "@/plugins/settings";
import { AppearanceSection } from "./appearance-section";

const GENERAL = "general";

export function AppearanceTabs() {
  const plugins = useInstalledPlugins();
  const tabs = useMemo(() => resolveAppearancePluginTabs(plugins), [plugins]);
  const [selected, setSelected] = useState(GENERAL);
  const options = useMemo(
    () => [
      { value: GENERAL, label: "General" },
      ...tabs.map((tab) => ({ value: tab.key, label: tab.title })),
    ],
    [tabs],
  );

  if (tabs.length === 0) return <AppearanceSection />;

  const activeTab = tabs.find((tab) => tab.key === selected);
  return (
    <View style={styles.container}>
      <SegmentedControl
        options={options}
        value={activeTab ? activeTab.key : GENERAL}
        onValueChange={setSelected}
        size="sm"
        style={styles.tabs}
      />
      {activeTab ? (
        <PluginSettingsContent
          serverId={activeTab.serverId}
          pluginId={activeTab.pluginId}
          screenId={activeTab.screenId}
        />
      ) : (
        <AppearanceSection />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[4] },
  tabs: { alignSelf: "flex-start" },
}));
