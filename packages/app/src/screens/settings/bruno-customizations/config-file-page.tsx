// CUSTOM(bruno-config-file): Settings > Bruno's Customizations > Save and Load. One JSON file
// with every setting the Bruno's Customizations pages edit, downloaded and loaded back. Web and
// Electron only: the file I/O uses the DOM.

import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { BRUNO_CONFIG_FILE_NAME } from "@/bruno-config/config-file";
import {
  useBrunoConfigFile,
  type LoadReport,
  type PreparedLoad,
} from "@/bruno-config/use-bruno-config-file";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";

function describeReport(report: LoadReport): string {
  if (report.refused) return report.refused;
  const lines: string[] = [];
  if (report.applied.length > 0) lines.push(`Applied: ${report.applied.join(", ")}.`);
  if (report.skipped.length > 0) lines.push(`Skipped: ${report.skipped.join(", ")}.`);
  for (const failure of report.failed) lines.push(`Failed: ${failure.section}: ${failure.error}`);
  return lines.length > 0 ? lines.join("\n") : "The file had nothing to apply.";
}

export function BrunoConfigFilePage({ serverId }: { serverId: string | null }) {
  const toast = useToast();
  const { busy, save, pick, apply } = useBrunoConfigFile(serverId);
  const [report, setReport] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    try {
      const { skipped } = await save();
      toast.show(
        skipped.length > 0
          ? `Configuration saved. Skipped: ${skipped.join(", ")}.`
          : "Configuration saved.",
      );
    } catch (error) {
      toast.error(`Could not save the configuration: ${toErrorMessage(error)}`);
    }
  }, [save, toast]);

  const handleLoad = useCallback(async () => {
    const picked = await pick();
    if (picked === null) return;
    if ("refused" in picked) {
      setReport(describeReport(picked));
      toast.error(describeReport(picked));
      return;
    }
    const prepared: PreparedLoad = picked;
    const confirmed = await confirmDialog({
      title: "Load configuration",
      message: `This replaces: ${prepared.sections.join(", ")}. Settings missing from the file stay as they are.`,
      confirmLabel: "Load",
    });
    if (!confirmed) return;
    const result = await apply(prepared.config);
    setReport(describeReport(result));
    if (result.failed.length > 0) toast.error("Some settings could not be loaded.");
    else toast.show("Configuration loaded.");
  }, [apply, pick, toast]);

  const handleSavePress = useCallback(() => void handleSave(), [handleSave]);
  const handleLoadPress = useCallback(() => void handleLoad(), [handleLoad]);

  if (isNative) {
    return <Text style={settingsStyles.rowHint}>Only on desktop and web.</Text>;
  }

  return (
    <SettingsSection title="Configuration file">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Save configuration</Text>
            <Text style={settingsStyles.rowHint}>
              Saves every Bruno&apos;s Customizations setting of this app and of the active host to{" "}
              {BRUNO_CONFIG_FILE_NAME}. The file includes the TypeSafe API key, so keep it private.
            </Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleSavePress}
            disabled={busy}
            testID="bruno-config-save"
          >
            Save
          </Button>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Load configuration</Text>
            <Text style={settingsStyles.rowHint}>
              Applies a saved file. Settings missing from the file stay as they are.
            </Text>
            {report ? (
              <Text selectable style={settingsStyles.rowHint} testID="bruno-config-report">
                {report}
              </Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleLoadPress}
            disabled={busy}
            testID="bruno-config-load"
          >
            Load
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}
