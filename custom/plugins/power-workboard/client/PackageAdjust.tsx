// CUSTOM(packages): the small "Adjust package" sheet reachable from the assignment banner and the
// package detail. A package is born with a name only; this edits the name, the two default
// triggers and the optional integration branch.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsInput,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import type { PackageView } from "../shared/model";
import type { strings } from "./strings";

export function PackageAdjust({
  pkg,
  t,
  theme,
  onClose,
  onSave,
}: {
  pkg: PackageView;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onSave(patch: {
    name: string;
    night: boolean;
    onClose: boolean;
    branch: string | null;
  }): void;
}) {
  const [name, setName] = useState(pkg.name);
  const [night, setNight] = useState(pkg.trigger.night);
  const [onCloseTrigger, setOnCloseTrigger] = useState(pkg.trigger.onClose);
  const [branch, setBranch] = useState(pkg.branch ?? "");
  return (
    <Modal
      open
      title={t.packages.adjustTitle}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content>
        <SettingsCard>
          <SettingsInput
            label={t.packages.name}
            initialValue={pkg.name}
            onChangeText={setName}
          />
          <SettingsSwitch
            label={t.packages.triggerNight}
            value={night}
            onValueChange={setNight}
          />
          <SettingsSwitch
            label={t.packages.triggerClose}
            value={onCloseTrigger}
            onValueChange={setOnCloseTrigger}
          />
          <SettingsInput
            label={t.packages.branch}
            hint={t.packages.branchHint}
            initialValue={pkg.branch ?? ""}
            onChangeText={setBranch}
            placeholder={t.packages.branchPlaceholder}
          />
        </SettingsCard>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.packages.cancel}
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              { borderColor: theme.colors.border },
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Text style={{ color: theme.colors.foreground }}>
              {t.packages.cancel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.packages.save}
            disabled={!name.trim()}
            onPress={() =>
              onSave({
                name: name.trim(),
                night,
                onClose: onCloseTrigger,
                branch: branch.trim() || null,
              })
            }
            style={({ pressed }) => [
              styles.button,
              {
                borderColor: theme.colors.accent,
                backgroundColor: theme.colors.accent,
                opacity: name.trim() ? (pressed ? 0.8 : 1) : 0.5,
              },
            ]}
          >
            <Text style={{ color: theme.colors.accentForeground }}>
              {t.packages.save}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
