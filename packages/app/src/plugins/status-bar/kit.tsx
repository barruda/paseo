// CUSTOM(status-bar): the StatusBarItem kit component plugins render from a status bar item.
import type { StatusBarItemProps } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { parsePluginIcon, pluginIconComponent } from "../icons";
import { useStatusBarItemFrame } from "./frame";

const ICON_SIZE = 14;

function IconGlyph({
  Icon,
  size,
  color,
}: {
  Icon: ReturnType<typeof pluginIconComponent>;
  size: number;
  color: string;
}) {
  return <Icon size={size} color={color} />;
}

const ThemedIconGlyph = withUnistyles(IconGlyph);

/**
 * One entry of the status bar. Hover lives on a plain View and press on the inner Pressable (see
 * docs/hover.md). Label: `label` when given; with no label, the item's title unless the entry has
 * an icon, in which case it is icon-only. Press anchors the item's popover to this entry.
 */
export function StatusBarItem({
  id,
  icon,
  iconColor,
  label,
  tooltip,
  onPress,
  maxLabelWidth,
}: StatusBarItemProps): ReactElement {
  const frame = useStatusBarItemFrame("StatusBarItem");
  const { anchorTo, offerAnchor, releaseAnchor } = frame;
  const entryRef = useRef<View | null>(null);
  useEffect(() => {
    const node = entryRef.current;
    offerAnchor(node);
    return () => releaseAnchor(node);
  }, [offerAnchor, releaseAnchor]);
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handlePress = useCallback(() => {
    anchorTo(entryRef.current);
    onPress?.();
  }, [anchorTo, onPress]);
  // Entries get their icon at render, so an invalid icon throws to the item's boundary.
  const iconComponent = useMemo(
    () => (icon ? pluginIconComponent(parsePluginIcon("Status bar item", icon)) : null),
    [icon],
  );
  const iconUniProps = useMemo(
    () => (theme: Theme) => ({ color: iconColor ?? theme.colors.foregroundMuted }),
    [iconColor],
  );
  const text = label ?? (icon ? "" : frame.title);
  const hint = tooltip ?? (text || frame.title);
  const drawer = frame.placement === "drawer";
  const labelStyle = useMemo(
    () => [
      styles.label,
      hovered && styles.labelHovered,
      maxLabelWidth !== undefined && { maxWidth: maxLabelWidth },
    ],
    [hovered, maxLabelWidth],
  );

  const entry = (
    <View
      ref={entryRef}
      collapsable={false}
      style={[styles.entry, drawer && styles.entryDrawer, hovered && styles.entryHovered]}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        onPress={handlePress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={text || hint}
        testID={id ? `${frame.testID}-${id}` : frame.testID}
        style={styles.pressable}
      >
        {iconComponent ? (
          <ThemedIconGlyph Icon={iconComponent} size={ICON_SIZE} uniProps={iconUniProps} />
        ) : null}
        {text ? (
          <Text style={labelStyle} numberOfLines={1}>
            {text}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );

  if (!isWeb) return entry;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{entry}</TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Fixed height, so a hover fill never moves the entry. It shrinks so a long label ellipsizes.
  entry: {
    height: 20,
    flexShrink: 1,
    minWidth: 0,
    borderRadius: theme.borderRadius.sm,
    justifyContent: "center",
  },
  entryDrawer: {
    height: 28,
  },
  entryHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  labelHovered: {
    color: theme.colors.foreground,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
