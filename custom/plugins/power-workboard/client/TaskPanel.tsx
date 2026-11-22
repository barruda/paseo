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
import { projectAccentColor, projectLetterFill } from "./colors";
import { ProjectIcon } from "./ProjectIcon";
import { projectIconFor, type ProjectIcons } from "./project-icons";
import { ConversationThread, RichText } from "./assistant/conversations-thread";
import { conversationsStrings } from "./assistant/conversations-strings";
import { usePaseoLanguage } from "./paseo-language";
import { onEscapeKey } from "./web";
import { useTaskDescription } from "./task-description"; // CUSTOM(task-description-files)
import type { CardMenuItem } from "./card-menu";
import {
  MENU_EDGE,
  clampMenuPosition,
  menuSize,
  middleClickHandler,
  resizedPanelWidth,
  type PanelView,
  type Size,
} from "./task-panel-state";

type Theme = PluginSurfaceProps["theme"];
type Strings = ReturnType<typeof strings>;
// CUSTOM(task-panel): viewport coordinates from the mouse, above every board overflow. Native
// has no fixed positioning, so there the menu is absolute inside the board root.
const FIXED = { position: "fixed" } as unknown as ViewStyle;
const ABSOLUTE = { position: "absolute" } as ViewStyle;
const COL_RESIZE = { cursor: "col-resize" } as unknown as ViewStyle;
const OVERLAY = Platform.OS === "web" ? FIXED : ABSOLUTE;

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

declare const document: { body: { style: { userSelect: string } } };
declare const window: {
  addEventListener(name: string, callback: (event: WebEvent) => void): void;
  removeEventListener(name: string, callback: (event: WebEvent) => void): void;
};

type WebNode = {
  addEventListener(name: string, callback: (event: WebEvent) => void): void;
  removeEventListener(name: string, callback: (event: WebEvent) => void): void;
};

const noAutoscroll = (event: WebEvent) => {
  if (event.button === 1) event.preventDefault?.();
};

/** CUSTOM(task-panel): middle click alone on a view (web only), e.g. the Open agent link. */
export function useMiddleClick(onMiddleClick: (() => void) | undefined) {
  const ref = useRef<View>(null);
  const middle = useRef(onMiddleClick);
  middle.current = onMiddleClick;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as WebNode | null;
    if (!node) return;
    const open = middleClickHandler(() => middle.current?.());
    node.addEventListener("auxclick", open);
    node.addEventListener("mousedown", noAutoscroll);
    return () => {
      node.removeEventListener("auxclick", open);
      node.removeEventListener("mousedown", noAutoscroll);
    };
  }, []);
  return ref;
}

/**
 * CUSTOM(task-panel): the resize handle on the panel's left edge. Web only: native has no
 * mouse, and its panel is full screen, so it gets no handle.
 */
function useResizeHandle({
  enabled,
  width,
  containerWidth,
  onResize,
  onResizeEnd,
}: {
  /** The handle is mounted; the listeners bind again when it comes back (compact → wide). */
  enabled: boolean;
  width: number;
  containerWidth: number;
  onResize(width: number): void;
  onResizeEnd(width: number): void;
}) {
  const ref = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ width, containerWidth, onResize, onResizeEnd });
  latest.current = { width, containerWidth, onResize, onResizeEnd };
  useEffect(() => {
    if (Platform.OS !== "web" || !enabled) return;
    const node = ref.current as unknown as WebNode | null;
    if (!node) return;
    let stop: (() => void) | null = null;
    const start = (event: WebEvent) => {
      if (event.button !== 0) return;
      event.preventDefault?.();
      const startX = event.clientX ?? 0;
      const startWidth = latest.current.width;
      let last = startWidth;
      const body = document.body;
      const previousSelect = body.style.userSelect;
      body.style.userSelect = "none";
      setDragging(true);
      const move = (e: WebEvent) => {
        last = resizedPanelWidth(
          startWidth,
          startX,
          e.clientX ?? startX,
          latest.current.containerWidth,
        );
        latest.current.onResize(last);
      };
      const finish = () => {
        stop?.();
        latest.current.onResizeEnd(last);
      };
      stop = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", finish);
        body.style.userSelect = previousSelect;
        stop = null;
        setDragging(false);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", finish);
    };
    node.addEventListener("mousedown", start);
    return () => {
      node.removeEventListener("mousedown", start);
      stop?.();
    };
  }, [enabled]);
  return { ref, dragging };
}

/**
 * CUSTOM(task-panel): middle click and the context menu on web. Native has no pointer events;
 * there the card's long press opens the same menu.
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
    const open = middleClickHandler(() => middle.current());
    const preventScroll = noAutoscroll;
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
  viewport,
  t,
  theme,
  onClose,
}: {
  menu: CardMenuRequest;
  viewport: Size;
  t: Strings;
  theme: Theme;
  onClose(): void;
}) {
  useEffect(() => onEscapeKey(onClose), [onClose]);
  const size = menuSize(menu.items.length);
  const available = Math.max(0, viewport.width - 2 * MENU_EDGE);
  const width = available > 0 ? Math.min(size.width, available) : size.width;
  const position = clampMenuPosition(menu, viewport, { ...size, width });
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.closeMenu}
        onPress={onClose}
        style={[styles.menuBackdrop, OVERLAY]}
      />
      <View
        testID="workboard-card-menu"
        style={[
          styles.menu,
          OVERLAY,
          {
            left: position.x,
            top: position.y,
            width,
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
  icons,
  t,
  theme,
  compact,
  onClose,
  onOpenWorkspace,
  onOpenAgent,
  onEdit,
  onStatus,
  view,
  viewAgentId,
  onShowTicket,
  onShowAgent,
  width,
  containerWidth,
  onResize,
  onResizeEnd,
  hostId,
  navigation,
}: {
  card: Card;
  board: Board;
  icons: ProjectIcons;
  t: Strings;
  theme: Theme;
  compact: boolean;
  onClose(): void;
  onOpenWorkspace?(): void;
  onOpenAgent?(agentId: string): void;
  onEdit?(): void;
  onStatus?(): void;
  view: PanelView;
  viewAgentId: string | null;
  onShowTicket(): void;
  onShowAgent(agentId: string): void;
  width: number;
  containerWidth: number;
  onResize(width: number): void;
  onResizeEnd(width: number): void;
  hostId: string;
  navigation: PluginSurfaceProps["navigation"];
}) {
  const group = board.settings.groups.find((item) => item.id === card.stage);
  const stage = group ? (group.name ?? group.label) : card.stage;
  const agentId = cardAgentId(card, board.orchestrations[card.id]);
  const record = board.orchestrations[card.id];
  const labels = card.labels.filter(
    (label) => !card.managedLabels.includes(label),
  );
  const project = board.projects.find((item) => item.id === card.projectId);
  const projectColor = card.projectId
    ? projectAccentColor(project?.accent, card.projectId, theme)
    : theme.colors.foregroundMuted;
  useEffect(() => onEscapeKey(onClose), [onClose]);
  const resize = useResizeHandle({
    enabled: !compact,
    width,
    containerWidth,
    onResize,
    onResizeEnd,
  });
  const showAgent = view === "agent" && viewAgentId !== null;
  const tab = (
    id: "ticket" | "agent",
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      testID={`workboard-panel-tab-${id}`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        {
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor:
            selected || pressed ? theme.colors.surface2 : "transparent",
        },
      ]}
    >
      <Text
        style={[
          styles.tabText,
          {
            color: selected
              ? theme.colors.accent
              : theme.colors.foregroundMuted,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View
      testID="workboard-ticket-panel"
      style={[
        styles.panel,
        compact ? styles.panelCompact : { width },
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
        },
      ]}
    >
      {Platform.OS === "web" && !compact ? (
        <View
          ref={resize.ref}
          testID="workboard-panel-resize"
          accessibilityLabel={t.ticketPanel.resize}
          style={[
            styles.resizeHandle,
            COL_RESIZE,
            resize.dragging && { backgroundColor: theme.colors.accent },
          ]}
        />
      ) : null}
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
      <View
        accessibilityRole="tablist"
        style={[styles.tabRow, { borderColor: theme.colors.border }]}
      >
        {tab("ticket", t.ticketPanel.ticketTab, !showAgent, onShowTicket)}
        {agentId
          ? tab("agent", t.ticketPanel.agentTab, showAgent, () =>
              onShowAgent(agentId),
            )
          : null}
      </View>
      {showAgent ? (
        <View style={styles.agentView}>
          <PanelAgent
            agentId={viewAgentId}
            card={card}
            theme={theme}
            hostId={hostId}
            navigation={navigation}
            onBack={onShowTicket}
            onSelectAgent={onShowAgent}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.content}
        >
          <View style={styles.projectMetaRow}>
            {card.projectId && card.projectName ? (
              <ProjectIcon
                name={project?.name ?? card.projectName}
                color={projectColor}
                fillColor={projectLetterFill(
                  project?.letterFill,
                  project?.accent,
                  card.projectId,
                )}
                size={14}
                icon={projectIconFor(icons, card.projectId)}
              />
            ) : null}
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {card.projectName || t.unassigned}
              {` · ${stage}`}
            </Text>
          </View>
          {labels.length > 0 ? (
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
              {labels.join(" · ")}
            </Text>
          ) : null}
          {card.timing ? (
            <Text
              style={[styles.meta, { color: theme.colors.foregroundMuted }]}
            >
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
            <TicketDescription card={card} t={t} theme={theme} />
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
      )}
    </View>
  );
}

/** CUSTOM(task-description-files): the description is read on open, not from the snapshot. */
function TicketDescription({
  card,
  t,
  theme,
}: {
  card: Card;
  t: Strings;
  theme: Theme;
}) {
  const query = useTaskDescription(card);
  if (query.data?.text.trim())
    return (
      <RichText
        text={query.data.text}
        color={theme.colors.foreground}
        theme={theme}
      />
    );
  return (
    <Text style={[styles.body, { color: theme.colors.foregroundMuted }]}>
      {query.isPending
        ? t.ticketPanel.loadingDescription
        : query.isError
          ? t.ticketPanel.descriptionFailed
          : t.ticketPanel.emptyDescription}
    </Text>
  );
}

function PanelAgent({
  agentId,
  card,
  theme,
  hostId,
  navigation,
  onBack,
  onSelectAgent,
}: {
  agentId: string;
  card: Card;
  theme: Theme;
  hostId: string;
  navigation: PluginSurfaceProps["navigation"];
  onBack(): void;
  onSelectAgent(agentId: string): void;
}) {
  const language = usePaseoLanguage();
  return (
    <ConversationThread
      agentId={agentId}
      taskId={card.id}
      taskTitle={null}
      navigation={navigation}
      hostId={hostId}
      compact={false}
      onBack={onBack}
      onSelectAgent={onSelectAgent}
      now={Date.now()}
      t={conversationsStrings(language)}
      theme={theme}
      readOnly
    />
  );
}

const styles = StyleSheet.create({
  resizeHandle: {
    position: "absolute",
    left: -3,
    top: 0,
    bottom: 0,
    width: 6,
    zIndex: 40,
  },
  tabRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  tab: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabText: { fontSize: 12, fontWeight: "600" },
  agentView: { flex: 1, minHeight: 0 },
  panel: {
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
  panelScroll: { flex: 1 },
  content: { padding: 12, gap: 10 },
  meta: { fontSize: 12 },
  projectMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
