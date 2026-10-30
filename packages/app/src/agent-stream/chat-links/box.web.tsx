// CUSTOM(chat-links): the link list beside the chat. See custom/CHANGES.md.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FileText, Globe, Link2 } from "lucide-react-native";
import {
  AssistantFileLinkResolverProvider,
  useAssistantFileLinkActions,
  useFileLink,
} from "@/assistant-file-links";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { wrapWithFileLinkHover } from "@/assistant-file-links/link";
import { PressHighlight } from "@/components/ui/press-highlight";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { ChatLink } from "./model";
import type { ChatLinksBoxProps } from "./box";

// The box shares the right gutter with the image strip, at its bottom. When the gutter is too
// narrow for the list, a button there opens it over the transcript instead.
const RAIL_INSET = 12;
const BOX_MAX_WIDTH = 280;
const BOX_MIN_WIDTH = 168;
const TOGGLE_SIZE = 32;
const FLOATING_GAP = 8;
const ROW_HEIGHT = 28;
const VISIBLE_ROWS = 10;
const END_TOLERANCE = 4;

type BoxLayout = { mode: "inline"; width: number } | { mode: "toggle" };

function resolveBoxLayout(panelWidth: number, contentMaxWidth: number): BoxLayout | null {
  const room = (panelWidth - contentMaxWidth) / 2 - RAIL_INSET * 2;
  if (room >= BOX_MIN_WIDTH) return { mode: "inline", width: Math.min(BOX_MAX_WIDTH, room) };
  if (room >= TOGGLE_SIZE) return { mode: "toggle" };
  return null;
}

const ThemedLink = withUnistyles(Link2, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedGlobe = withUnistyles(Globe, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedFile = withUnistyles(FileText, (theme) => ({ color: theme.colors.foregroundMuted }));

export const ChatLinksBox = memo(function ChatLinksBox({
  links,
  client,
  serverId,
  workspaceRoot,
  sessionPaths,
  onOpenWorkspaceFile,
  toast,
  contentMaxWidth,
  bottomOffset,
  onReservedHeightChange,
}: ChatLinksBoxProps) {
  const [panelWidth, setPanelWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  const [open, setOpen] = useState(false);

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    // Retained tabs report 0 under display: none; that is not a narrow panel.
    if (width > 0) setPanelWidth(width);
  }, []);

  const layout = links.length > 0 ? resolveBoxLayout(panelWidth, contentMaxWidth) : null;
  let reserved = 0;
  if (layout?.mode === "inline" && boxHeight > 0) reserved = bottomOffset + boxHeight;
  if (layout?.mode === "toggle") reserved = bottomOffset + TOGGLE_SIZE;
  useEffect(() => onReservedHeightChange(reserved), [onReservedHeightChange, reserved]);
  useEffect(() => () => onReservedHeightChange(0), [onReservedHeightChange]);
  useEffect(() => {
    if (layout?.mode !== "toggle") setOpen(false);
  }, [layout?.mode]);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);
  const toggleStyle = useMemo(
    () => [styles.toggle, inlineUnistylesStyle({ bottom: bottomOffset })],
    [bottomOffset],
  );

  return (
    <View style={styles.panelMeasure} pointerEvents="box-none" onLayout={handlePanelLayout}>
      {layout ? (
        <AssistantFileLinkResolverProvider
          client={client}
          serverId={serverId}
          workspaceRoot={workspaceRoot}
          sessionPaths={sessionPaths}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          toast={toast}
        >
          {layout.mode === "inline" ? (
            <ChatLinkList
              links={links}
              width={layout.width}
              bottom={bottomOffset}
              onHeightChange={setBoxHeight}
            />
          ) : (
            <>
              {open ? (
                <ChatLinkList
                  links={links}
                  width={BOX_MAX_WIDTH}
                  bottom={bottomOffset + TOGGLE_SIZE + FLOATING_GAP}
                  floating
                  onOpened={close}
                />
              ) : null}
              <View style={toggleStyle}>
                <ToolbarButton
                  label={`Links (${links.length})`}
                  tooltipSide="left"
                  selected={open}
                  onPress={toggle}
                  testID="chat-links-toggle"
                >
                  <ThemedLink size={16} />
                </ToolbarButton>
              </View>
            </>
          )}
        </AssistantFileLinkResolverProvider>
      ) : null}
    </View>
  );
});

interface ChatLinkListProps {
  links: ChatLink[];
  width: number;
  bottom: number;
  floating?: boolean;
  onHeightChange?: (height: number) => void;
  onOpened?: () => void;
}

function ChatLinkList({
  links,
  width,
  bottom,
  floating = false,
  onHeightChange,
  onOpened,
}: ChatLinkListProps) {
  const actions = useAssistantFileLinkActions();
  const scrollRef = useRef<ScrollView>(null);
  // Newest links sit at the bottom; the list follows them unless the reader scrolled up.
  const atEndRef = useRef(true);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    atEndRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - END_TOLERANCE;
  }, []);
  const handleContentSizeChange = useCallback(() => {
    if (atEndRef.current) scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onHeightChange?.(event.nativeEvent.layout.height),
    [onHeightChange],
  );
  const handleOpen = useCallback(
    (link: ChatLink) => {
      actions.open(link.source, "preferred");
      onOpened?.();
    },
    [actions, onOpened],
  );

  return (
    <View
      style={[styles.box, floating && styles.boxFloating, inlineUnistylesStyle({ bottom, width })]}
      onLayout={handleLayout}
      testID="chat-links-box"
    >
      <View style={styles.header}>
        <ThemedLink size={14} />
        <Text style={styles.headerTitle}>Links</Text>
        <Text style={styles.headerCount}>{links.length}</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onContentSizeChange={handleContentSizeChange}
      >
        {links.map((link) => (
          <ChatLinkRow key={link.key} link={link} onOpen={handleOpen} />
        ))}
      </ScrollView>
    </View>
  );
}

// The same hover card as the link in the message (copy, open in a tab, open in the browser), so a
// row offers what the link does. A click still opens it like clicking the link.
const ChatLinkRow = memo(function ChatLinkRow({
  link,
  onOpen,
}: {
  link: ChatLink;
  onOpen: (link: ChatLink) => void;
}) {
  const fileLink = useFileLink(link.source);
  const handlePress = useCallback(() => onOpen(link), [link, onOpen]);
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => {
    setHovered(true);
    fileLink.onHoverIn();
  }, [fileLink]);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const rowStyle = useMemo(() => [styles.row, hovered && styles.rowHovered], [hovered]);
  const row = (
    <PressHighlight
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={link.detail}
      testID={`chat-links-row-${link.key}`}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={rowStyle}
    >
      {link.kind === "url" ? <ThemedGlobe size={14} /> : <ThemedFile size={14} />}
      <Text style={styles.rowLabel} numberOfLines={1}>
        {link.label}
      </Text>
    </PressHighlight>
  );
  return wrapWithFileLinkHover(link.source, fileLink, row) ?? row;
});

const styles = StyleSheet.create((theme) => ({
  panelMeasure: {
    position: "absolute",
    inset: 0,
  },
  box: {
    position: "absolute",
    right: RAIL_INSET,
    zIndex: 2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  boxFloating: {
    zIndex: 3,
    backgroundColor: theme.colors.surface2,
    ...theme.shadow.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    height: ROW_HEIGHT,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  headerCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  list: {
    maxHeight: ROW_HEIGHT * VISIBLE_ROWS,
  },
  listContent: {
    paddingVertical: theme.spacing[0.5],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    height: ROW_HEIGHT,
    paddingHorizontal: theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  toggle: {
    position: "absolute",
    right: RAIL_INSET,
    zIndex: 2,
    minWidth: TOGGLE_SIZE,
    minHeight: TOGGLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
}));
