// CUSTOM(task-panel): a ticket opens beside the board instead of replacing it. The Paseo
// workspace panel cannot carry a ticket id, so the board owns this side panel.
import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { Board, Card } from "../shared/model";
import type { strings } from "./strings";
import { cardAgentId } from "./board-utils";
import { RichText } from "./assistant/conversations-thread";
import { onEscapeKey } from "./web";
import type { CardMenuItem } from "./card-menu";

type Theme = PluginSurfaceProps["theme"];
type Strings = ReturnType<typeof strings>;
// CUSTOM(task-panel): viewport coordinates from the mouse, above every board overflow.
const FIXED = { position: "fixed" } as unknown as ViewStyle;

export type CardMenuRequest = {
  x: number;
  y: number;
  items: CardMenuItem[];
};

type WebEvent = {
  button?: number;
  preventDefault?(): void;
  stopPropagation?(): void;
  clientX?: number;
  clientY?: number;
};

type WebNode = {
  addEventListener(name: string, callback: (event: WebEvent) => void): void;
  removeEventListener(name: string, callback: (event: WebEvent) => void): void;
};

/**
 * CUSTOM(task-panel): middle click and the context menu on web. Native has neither, so the
 * board keeps its usual press behavior there.
 */
export function useCardPointerActions({
  onMiddleClick,
  onContextMenu,
}: {
  onMiddleClick(): void;
  onContextMenu(position: { x: number; y: number }): void;
}) {
  const ref = useRef<View>(null);
  const middle = useRef(onMiddleClick);
  middle.current = onMiddleClick;
  const context = useRef(onContextMenu);
  context.current = onContextMenu;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as WebNode | null;
    if (!node) return;
    const open = (event: WebEvent) => {
      if (event.button !== 1) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      middle.current();
    };
    const preventScroll = (event: WebEvent) => {
      if (event.button === 1) event.preventDefault?.();
    };
    const showMenu = (event: WebEvent) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      context.current({ x: event.clientX ?? 0, y: event.clientY ?? 0 });
    };
    node.addEventListener("auxclick", open);
    node.addEventListener("mousedown", preventScroll);
    node.addEventListener("contextmenu", showMenu);
    return () => {
      node.removeEventListener("auxclick", open);
      node.removeEventListener("mousedown", preventScroll);
      node.removeEventListener("contextmenu", showMenu);
    };
  }, []);
  return ref;
}

export function CardContextMenu({
  menu,
  theme,
  onClose,
}: {
  menu: CardMenuRequest;
  theme: Theme;
  onClose(): void;
}) {
  useEffect(() => onEscapeKey(onClose), [onClose]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={[styles.menuBackdrop, FIXED]}
      />
      <View
        testID="workboard-card-menu"
        style={[
          styles.menu,
          FIXED,
          {
            left: menu.x,
            top: menu.y,
            backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {menu.items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => {
              onClose();
              item.onPress();
            }}
            style={({ pressed }) => [
              styles.menuItem,
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon name={item.icon} size={14} color={theme.colors.foreground} />
            <Text style={[styles.menuText, { color: theme.colors.foreground }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function PanelAction({
  icon,
  label,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  theme: Theme;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: theme.colors.border },
        pressed && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Icon name={icon} size={14} color={theme.colors.foreground} />
      <Text style={[styles.actionText, { color: theme.colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TaskPanel({
  card,
  board,
  t,
  theme,
  compact,
  onClose,
  onOpenWorkspace,
  onOpenAgent,
  onEdit,
  onStatus,
}: {
  card: Card;
  board: Board;
  t: Strings;
  theme: Theme;
  compact: boolean;
  onClose(): void;
  onOpenWorkspace?(): void;
  onOpenAgent?(agentId: string): void;
  onEdit?(): void;
  onStatus?(): void;
}) {
  const group = board.settings.groups.find((item) => item.id === card.stage);
  const stage = group ? (group.name ?? group.label) : card.stage;
  const agentId = cardAgentId(card, board.orchestrations[card.id]);
  const record = board.orchestrations[card.id];
  const labels = card.labels.filter(
    (label) => !card.managedLabels.includes(label),
  );
  useEffect(() => onEscapeKey(onClose), [onClose]);
  return (
    <View
      testID="workboard-ticket-panel"
      style={[
        styles.panel,
        compact && styles.panelCompact,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
        },
      ]}
    >
      <View style={[styles.header, { borderColor: theme.colors.border }]}>
        <View style={styles.heading}>
          {card.number > 0 ? (
            <View
              style={[
                styles.numberBadge,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                },
              ]}
            >
              <Text style={[styles.number, { color: theme.colors.foreground }]}>
                {`#${card.number}`}
              </Text>
            </View>
          ) : null}
          <Text
            numberOfLines={2}
            style={[styles.title, { color: theme.colors.foreground }]}
          >
            {card.title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.ticketPanel.close}
          onPress={onClose}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {card.projectName || t.unassigned}
          {` · ${stage}`}
        </Text>
        {labels.length > 0 ? (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {labels.join(" · ")}
          </Text>
        ) : null}
        {card.timing ? (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {card.timing.kind === "night"
              ? t.night.badge
              : new Date(card.timing.at).toLocaleString(t.locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
          </Text>
        ) : null}
        <View
          style={[
            styles.section,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
            },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {t.ticketPanel.description}
          </Text>
          {card.description.trim() ? (
            <RichText
              text={card.description}
              color={theme.colors.foreground}
              theme={theme}
            />
          ) : (
            <Text
              style={[styles.body, { color: theme.colors.foregroundMuted }]}
            >
              {t.ticketPanel.emptyDescription}
            </Text>
          )}
        </View>
        {record?.summary ? (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: theme.colors.foregroundMuted },
              ]}
            >
              {t.ticketPanel.summary}
            </Text>
            <Text
              selectable
              style={[styles.body, { color: theme.colors.foreground }]}
            >
              {record.summary}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          {card.workspaceId && onOpenWorkspace ? (
            <PanelAction
              icon="ArrowUpRight"
              label={t.openWorkspace}
              theme={theme}
              onPress={onOpenWorkspace}
            />
          ) : null}
          {agentId && onOpenAgent ? (
            <PanelAction
              icon="Bot"
              label={t.openAgent}
              theme={theme}
              onPress={() => onOpenAgent(agentId)}
            />
          ) : null}
          {onEdit ? (
            <PanelAction
              icon="FileText"
              label={t.edit}
              theme={theme}
              onPress={onEdit}
            />
          ) : null}
          {onStatus ? (
            <PanelAction
              icon="ArrowRightLeft"
              label={t.status}
              theme={theme}
              onPress={onStatus}
            />
          ) : null}
        </View>
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {`${t.ticketPanel.created} ${new Date(card.createdAt).toLocaleString(t.locale)}`}
          {` · ${t.ticketPanel.updated} ${new Date(card.updatedAt).toLocaleString(t.locale)}`}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 380,
    minWidth: 0,
    minHeight: 0,
    borderLeftWidth: 1,
    flexShrink: 0,
  },
  panelCompact: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    zIndex: 30,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  heading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  numberBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  number: { fontSize: 12, fontWeight: "700" },
  title: { flex: 1, fontSize: 15, fontWeight: "600" },
  iconButton: { padding: 6, borderRadius: 6 },
  content: { padding: 12, gap: 10 },
  meta: { fontSize: 12 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  body: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { fontSize: 12, fontWeight: "500" },
  menuBackdrop: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  menu: {
    zIndex: 101,
    minWidth: 190,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  menuText: { fontSize: 13 },
});
