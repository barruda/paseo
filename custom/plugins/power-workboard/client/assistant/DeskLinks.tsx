// CUSTOM(board-desk-links): Dashboard, Conversations and Reports links at the end of the board's
// tab bar. Compact layouts show only the icons; the label stays in the hint.
import { StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { HintButton } from "../Hint";
import { usePaseoLocale } from "../paseo-language";
import {
  DESK_LINKS,
  canOpenDeskSurfaces,
  deskLinkStrings,
  openDeskLink,
} from "./desk-links";

export function DeskLinks({
  navigation,
  theme,
  compact,
}: {
  navigation: PluginSurfaceProps["navigation"];
  theme: PluginSurfaceProps["theme"];
  compact: boolean;
}) {
  const t = deskLinkStrings(usePaseoLocale());
  if (!canOpenDeskSurfaces(navigation)) return null;
  return (
    <View style={styles.links}>
      {DESK_LINKS.map((link) => (
        <HintButton
          key={link.key}
          testID={`workboard-desk-link-${link.key}`}
          hint={t[link.key].hint}
          accessibilityRole="link"
          accessibilityLabel={t[link.key].hint}
          onPress={() => openDeskLink(navigation, link.key)}
          style={({ pressed }) => [
            styles.link,
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon
            name={link.icon}
            size={14}
            color={theme.colors.foregroundMuted}
          />
          {!compact && (
            <Text
              style={[styles.label, { color: theme.colors.foregroundMuted }]}
            >
              {t[link.key].label}
            </Text>
          )}
        </HintButton>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  links: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
    alignSelf: "center",
  },
  link: {
    minHeight: 32,
    minWidth: 32,
    paddingHorizontal: 8,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  label: { fontSize: 13, lineHeight: 18 },
});
