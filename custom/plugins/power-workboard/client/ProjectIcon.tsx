import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { StyleSheet, Text, View } from "react-native";

type Theme = PluginSurfaceProps["theme"];

/** The last segment's first letter, as the app's project placeholder does. */
export function projectInitial(name: string): string {
  const trimmed = name.trim();
  const segments = trimmed.split("/").filter(Boolean);
  const label = segments[segments.length - 1] || trimmed;
  return label.charAt(0).toUpperCase();
}

/**
 * A project's generated icon: its initial on the same stable color as the card border. Uploaded
 * icons are app state the plugin cannot read, so the placeholder is the only shape here.
 */
export function ProjectIcon({
  name,
  color,
  theme,
  size = 14,
}: {
  name: string;
  color: string;
  theme: Theme;
  size?: number;
}) {
  const initial = projectInitial(name);
  if (!initial) return null;
  return (
    <View
      accessible={false}
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.25),
          backgroundColor: color,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: theme.colors.surface0,
            fontSize: Math.max(7, Math.round(size * 0.64)),
            lineHeight: size,
          },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  label: { fontWeight: "600", textAlign: "center" },
});
