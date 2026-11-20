import { findSvgIconProblem } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import type { ProjectIconData } from "../shared/model";

const SVG_MIME_TYPE = "image/svg+xml";
const ICO_MIME_TYPES = new Set(["image/x-icon", "image/vnd.microsoft.icon"]);

/**
 * The app paints the generated letter white on the project's identity fill in both themes.
 * The fill is `fillColor`, never the theme accent: the accent changes in the dark theme (it is a
 * foreground color there), while the app's letter box keeps the same fill.
 */
export const PROJECT_LETTER_COLOR = "#ffffff";

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
 * CUSTOM(project-icon-colors): an uploaded image is never rounded, as in the app; the letter box
 * keeps the app's radius, identity fill and white letter. `color` stays the accent the caller
 * uses for borders and chips; `fillColor` is the app's identity fill for the letter box.
 */
export function ProjectIcon({
  name,
  color,
  fillColor,
  size = 14,
  icon = null,
}: {
  name: string;
  color: string;
  fillColor: string;
  size?: number;
  icon?: ProjectIconData | null;
}) {
  // A broken image goes back to the letter. Keyed by the bytes, so a new icon tries again.
  const [failed, setFailed] = useState<string | null>(null);
  const usable = icon && failed !== icon.data ? icon : null;
  const box = { width: size, height: size };
  const ico = usable ? ICO_MIME_TYPES.has(usable.mimeType) : false;
  // The image comes first: a project with an image still shows it when its name is empty.
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
          resizeMode="cover"
          style={box}
          onError={() => setFailed(usable.data)}
        />
      );
    }
  }
  const initial = projectInitial(name);
  if (!initial) return null;
  return (
    <View
      accessible={false}
      style={[
        styles.box,
        {
          ...box,
          borderRadius: Math.round(size * 0.25),
          backgroundColor: fillColor,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: PROJECT_LETTER_COLOR,
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
