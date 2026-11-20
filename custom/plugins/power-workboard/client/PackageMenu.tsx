// CUSTOM(packages): the "Add to package" menu. A search field, the open packages of the ticket's
// project, and a create row with the typed text. It is a modal on every surface so the keyboard
// and the list work the same on the web, the desktop and a phone.
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInput as NativeTextInput,
} from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PackageView } from "../shared/model";
import { groupColorValue } from "./colors";
import type { strings } from "./strings";

export function PackageMenu({
  packages,
  taskIds,
  hasPackage,
  t,
  theme,
  onClose,
  onAssign,
  onCreate,
  onRemove,
  onAskPm,
}: {
  packages: readonly PackageView[];
  taskIds: readonly string[];
  hasPackage: boolean;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onClose(): void;
  onAssign(packageId: string): void;
  onCreate(name: string): void;
  onRemove(): void;
  onAskPm(): void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<NativeTextInput>(null);
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const matches = packages.filter(
    (pkg) =>
      pkg.status === "open" &&
      (!needle || pkg.name.toLocaleLowerCase().includes(needle)),
  );
  const exact = packages.some(
    (pkg) => pkg.name.trim().toLocaleLowerCase() === needle,
  );
  const create = needle.length > 0 && !exact ? query.trim() : null;
  const first = matches[0] ?? null;
  const submit = () => {
    if (first) onAssign(first.id);
    else if (create) onCreate(create);
  };
  return (
    <Modal
      open
      title={t.packages.addToPackage}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content>
        <View style={styles.searchRow}>
          <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
          <TextInput
            ref={input}
            value={query}
            onChangeText={setQuery}
            placeholder={t.packages.searchOrCreate}
            autoFocus
            onSubmitEditing={submit}
            returnKeyType="done"
            style={[
              styles.input,
              {
                color: theme.colors.foreground,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface1,
              },
            ]}
          />
        </View>
        <Text style={[styles.hint, { color: theme.colors.foregroundMuted }]}>
          {t.packages.selected.replace("{count}", String(taskIds.length))}
        </Text>
        <View style={styles.list}>
          {matches.map((pkg) => (
            <Pressable
              key={pkg.id}
              accessibilityRole="button"
              accessibilityLabel={`${pkg.name} · ${t.packages.progress
                .replace("{merged}", String(pkg.merged))
                .replace("{total}", String(pkg.total))}`}
              onPress={() => onAssign(pkg.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: pressed
                    ? theme.colors.surface2
                    : theme.colors.surface0,
                },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: groupColorValue(pkg.color, theme) },
                ]}
              />
              <View style={styles.rowText}>
                <Text
                  numberOfLines={1}
                  style={{ color: theme.colors.foreground }}
                >
                  {pkg.name}
                </Text>
                <Text
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {t.packages.progress
                    .replace("{merged}", String(pkg.merged))
                    .replace("{total}", String(pkg.total))}
                </Text>
              </View>
            </Pressable>
          ))}
          {create && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.packages.createPackage.replace(
                "{name}",
                create,
              )}
              onPress={() => onCreate(create)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: pressed
                    ? theme.colors.surface2
                    : theme.colors.surface0,
                },
              ]}
            >
              <Icon name="Plus" size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent }}>
                {t.packages.createPackage.replace("{name}", create)}
              </Text>
            </Pressable>
          )}
          {!matches.length && !create && (
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {t.packages.noPackages}
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          {hasPackage && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.packages.removeFromPackage}
              onPress={onRemove}
              style={({ pressed }) => [
                styles.action,
                { borderColor: theme.colors.border },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name="PackageMinus"
                size={15}
                color={theme.colors.foreground}
              />
              <Text style={{ color: theme.colors.foreground }}>
                {t.packages.removeFromPackage}
              </Text>
            </Pressable>
          )}
          {taskIds.length > 1 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.packages.askPmToGroup}
              onPress={onAskPm}
              style={({ pressed }) => [
                styles.action,
                { borderColor: theme.colors.border },
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon name="Bot" size={15} color={theme.colors.foreground} />
              <Text style={{ color: theme.colors.foreground }}>
                {t.packages.askPmToGroup}
              </Text>
            </Pressable>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  hint: { fontSize: 12 },
  list: { gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowText: { flex: 1, gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meta: { fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
