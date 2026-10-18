// CUSTOM(send-behavior-pill): pick the default send behavior from the composer pill row. It edits
// the same app setting as Settings > General > Default send, so text and dictation both follow it.
import { memo, useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CornerDownRight, ListEnd, OctagonX } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";
import { useAppSettings, type SendBehavior } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";

export const SEND_BEHAVIORS: readonly SendBehavior[] = ["steer", "interrupt", "queue"];

const SEND_BEHAVIOR_ICONS = {
  steer: withUnistyles(CornerDownRight),
  interrupt: withUnistyles(OctagonX),
  queue: withUnistyles(ListEnd),
} satisfies Record<SendBehavior, unknown>;

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function SendBehaviorIcon({ behavior, size }: { behavior: SendBehavior; size: number }) {
  const Icon = SEND_BEHAVIOR_ICONS[behavior];
  return <Icon size={size} uniProps={mutedColorMapping} />;
}

function SendBehaviorMenuItem({
  behavior,
  selected,
  onSelect,
}: {
  behavior: SendBehavior;
  selected: boolean;
  onSelect: (behavior: SendBehavior) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(behavior), [behavior, onSelect]);
  const leading = useMemo(() => <SendBehaviorIcon behavior={behavior} size={16} />, [behavior]);
  return (
    <DropdownMenuItem
      testID={`composer-send-behavior-${behavior}`}
      leading={leading}
      description={t(`settings.general.defaultSend.descriptions.${behavior}`)}
      selected={selected}
      showSelectedCheck
      onSelect={handleSelect}
    >
      {t(`settings.general.defaultSend.options.${behavior}`)}
    </DropdownMenuItem>
  );
}

export const SendBehaviorPill = memo(function SendBehaviorPill(): ReactElement {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const current = settings.sendBehavior;
  const label = t("settings.general.defaultSend.label");
  const handleSelect = useCallback(
    (sendBehavior: SendBehavior) => void updateSettings({ sendBehavior }),
    [updateSettings],
  );
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      composerPillStyles.body,
      (hovered || pressed || open) && composerPillStyles.bodyActive,
    ],
    [],
  );

  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            testID="composer-send-behavior-pill"
            accessibilityRole="button"
            accessibilityLabel={label}
            style={triggerStyle}
          >
            <View style={styles.icon} pointerEvents="none">
              <SendBehaviorIcon behavior={current} size={14} />
            </View>
            <Text numberOfLines={1} style={composerPillStyles.label}>
              {t(`settings.general.defaultSend.options.${current}`)}
            </Text>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <Text style={styles.tooltipLabel}>
            {t(`settings.general.defaultSend.descriptions.${current}`)}
          </Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent sheetTitle={label} side="top" align="start" offset={12} minWidth={280}>
        {SEND_BEHAVIORS.map((behavior) => (
          <SendBehaviorMenuItem
            key={behavior}
            behavior={behavior}
            selected={behavior === current}
            onSelect={handleSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  icon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tooltipLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
