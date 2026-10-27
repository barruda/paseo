import { useMemo } from "react";
import { type StyleProp, Text, type TextStyle, View } from "react-native";
import { ProjectIconImage } from "@/components/project-icon-image";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { useProjectIconTextStore } from "@/projects/icon-text-store";

const WHITE_TEXT = { color: "#ffffff" } as const;
const FALLBACK_LAYOUT = { alignItems: "center", justifyContent: "center" } as const;

/**
 * Corner radius of the *generated* project icon — the colored square with an initial — as a
 * fraction of the box, so it reads as the same shape at 16pt in the sidebar and 40pt in the edit
 * sheet. Fixed tokens did not give that: the radius scale is coarse at the bottom, so small icons
 * landed on 2pt and looked square while large ones were visibly rounder.
 *
 * This is ours to shape. A **user-uploaded icon is never rounded** — it is someone's mark, and
 * clipping its corners distorts branding we don't own. A square logo stays square, a round one is
 * already round.
 */
const RADIUS_RATIO = 0.25;

export function projectIconRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}

/**
 * CUSTOM(project-icon-text): font size for text longer than one character, shrinking as it grows
 * so it stays on one line inside the box.
 */
export function projectIconTextFontSize(text: string, size: number): number | null {
  const length = Array.from(text).length;
  if (length <= 1) return null;
  return Math.max(6, Math.min(size * 0.55, (size * 1.5) / length));
}

/**
 * A project's icon: its chosen image, or a colored square carrying its initial.
 *
 * Geometry lives here, not at the call site. It used to be five copies of the same
 * width/height/radius/centering block, which is how the radius drifted apart in the first
 * place — pass a `size` and the shape follows.
 */

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  size,
  textStyle,
  text,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  size: number;
  textStyle: StyleProp<TextStyle>;
  /**
   * CUSTOM(project-icon-text): text shown instead of the initial. Omitted, the text saved in
   * Edit project is used; null forces the initial.
   */
  text?: string | null;
}) {
  const savedText = useProjectIconTextStore((state) => state.texts[projectViewKey] ?? null);
  const label = (text === undefined ? savedText : text) || initial;
  const labelFontSize = projectIconTextFontSize(label, size);
  // The uploaded image is sized but never clipped — see projectIconRadius.
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  const fallbackStyles = useMemo(
    () => [
      box,
      { borderRadius: projectIconRadius(size) },
      FALLBACK_LAYOUT,
      { backgroundColor: identityColor(deriveIdentityColorName(projectViewKey)) },
    ],
    [box, size, projectViewKey],
  );
  const textStyles = useMemo(
    () => [textStyle, WHITE_TEXT, labelFontSize ? { fontSize: labelFontSize } : null],
    [textStyle, labelFontSize],
  );

  const fallback = useMemo(
    () => (
      <View style={fallbackStyles}>
        <Text numberOfLines={1} style={textStyles}>
          {label}
        </Text>
      </View>
    ),
    [fallbackStyles, label, textStyles],
  );

  return iconDataUri ? (
    <ProjectIconImage dataUri={iconDataUri} fallback={fallback} style={box} />
  ) : (
    fallback
  );
}
