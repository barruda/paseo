import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { findSvgIconProblem } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import type { ProjectIconData } from "../shared/model";

type Theme = PluginSurfaceProps["theme"];

const SVG_MIME_TYPE = "image/svg+xml";
const ICO_MIME_TYPES = new Set(["image/x-icon", "image/vnd.microsoft.icon"]);

/** The last segment's first letter, as the app's project placeholder does. */
export function projectInitial(name: string): string {
  const trimmed = name.trim();
  const segments = trimmed.split("/").filter(Boolean);
  const label = segments[segments.length - 1] || trimmed;
  return label.charAt(0).toUpperCase();
}

function dataUri(icon: ProjectIconData): string {
  return `data:${icon.mimeType};base64,${icon.data}`;
}

/**
 * A project's icon: the image the app shows for it, or the app's generated letter placeholder.
 * CUSTOM(project-icon-colors): the icon and the accent both come from the app's project
 * definition. An uploaded image is never rounded, as in the app; the letter box keeps the
 * app's radius and white letter.
 */
export function ProjectIcon({
  name,
  color,
  theme,
  size = 14,
  icon = null,
}: {
  name: string;
  color: string;
  theme: Theme;
  size?: number;
  icon?: ProjectIconData | null;
}) {
  // A broken image goes back to the letter. Keyed by the bytes, so a new icon tries again.
  const [failed, setFailed] = useState<string | null>(null);
  const initial = projectInitial(name);
  if (!initial) return null;
  const usable = icon && failed !== icon.data ? icon : null;
  const box = { width: size, height: size };
  const ico = usable ? ICO_MIME_TYPES.has(usable.mimeType) : false;
  if (usable && (!ico || Platform.OS === "web")) {
    if (usable.mimeType === SVG_MIME_TYPE && Platform.OS !== "web") {
      if (usable.svg && !findSvgIconProblem(usable.svg)) {
        return (
          <View style={box}>
            <Icon icon={{ svg: usable.svg }} size={size} color={color} />
          </View>
        );
      }
    } else {
      return (
        <Image
          accessible={false}
          source={{ uri: dataUri(usable) }}
          resizeMode="contain"
          style={box}
          onError={() => setFailed(usable.data)}
        />
      );
    }
  }
  return (
    <View
      accessible={false}
      style={[
        styles.box,
        {
          ...box,
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
