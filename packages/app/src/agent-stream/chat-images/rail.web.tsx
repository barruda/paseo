// CUSTOM(chat-images): the image strip beside the chat. See custom/CHANGES.md.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useAssistantImage } from "@/assistant-image/use-assistant-image";
import { useStableEvent } from "@/hooks/use-stable-event";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { CHAT_IMAGE_SELECTOR, resolveActiveImageMessageId, type ChatImage } from "./model";
import type { ChatImagesRailProps } from "./rail";

// The strip sits in the right gutter and shrinks with it; below the small size it hides
// rather than cover the transcript.
const LARGE_THUMB = 64;
const SMALL_THUMB = 40;
const RAIL_INSET = 12;
const PREVIEW_MAX = 320;
const PREVIEW_GAP = 8;
const JUMP_TIMEOUT_MS = 3000;
// Lands the image a little below the top edge instead of flush against it.
const IMAGE_TOP_MARGIN = 16;

function resolveThumbSize(panelWidth: number, contentMaxWidth: number): number | null {
  const gutter = (panelWidth - contentMaxWidth) / 2;
  if (gutter >= LARGE_THUMB + RAIL_INSET * 2) return LARGE_THUMB;
  if (gutter >= SMALL_THUMB + RAIL_INSET * 2) return SMALL_THUMB;
  return null;
}

function findRenderedImage(root: HTMLElement | null, image: ChatImage): HTMLElement | null {
  if (!root) return null;
  // A message renders one row per Markdown block; its images are numbered across all rows.
  const rows = root.querySelectorAll<HTMLElement>(
    `[data-message-id="${CSS.escape(image.messageId)}"]`,
  );
  const rendered = Array.from(rows).flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(CHAT_IMAGE_SELECTOR)),
  );
  return rendered[image.index] ?? null;
}

export const ChatImagesRail = memo(function ChatImagesRail({
  images,
  readingPosition,
  client,
  serverId,
  workspaceRoot,
  contentMaxWidth,
  viewportRef,
  visibleMessageIds,
  revealLoadedMessage,
}: ChatImagesRailProps) {
  const panelRef = useRef<View>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const railRef = useRef<View>(null);
  const [hovered, setHovered] = useState<HoveredThumb | null>(null);
  const jumpRef = useRef<AbortController | null>(null);
  const bindingsRef = useRef({ visibleMessageIds, revealLoadedMessage });
  bindingsRef.current = { visibleMessageIds, revealLoadedMessage };

  const getActiveMessageId = useCallback(
    () => resolveActiveImageMessageId(images, readingPosition.getActiveSeq()),
    [images, readingPosition],
  );
  const activeMessageId = useSyncExternalStore(readingPosition.subscribe, getActiveMessageId);
  const firstActiveKey = images.find((image) => image.messageId === activeMessageId)?.key ?? null;

  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const width = event.nativeEvent.layout.width;
    // Retained tabs report 0 under display: none; that is not a narrow panel.
    if (width > 0) setPanelWidth(width);
  }, []);

  useEffect(() => () => jumpRef.current?.abort(), []);

  // Older rows may sit outside the mounted history window, so the jump reveals the message
  // first, scrolls to it, and then hands the viewport the image's own top once it renders.
  const jumpToImage = useStableEvent((image: ChatImage) => {
    jumpRef.current?.abort();
    const controller = new AbortController();
    jumpRef.current = controller;
    const { signal } = controller;
    const getRoot = () =>
      (panelRef.current as unknown as HTMLElement | null)?.parentElement ?? null;
    const deadline = performance.now() + JUMP_TIMEOUT_MS;
    let scrolledToMessage = false;
    const poll = () => {
      if (signal.aborted || performance.now() >= deadline) return;
      const bindings = bindingsRef.current;
      if (!bindings.visibleMessageIds.has(image.messageId)) {
        bindings.revealLoadedMessage(image.messageId);
        requestAnimationFrame(poll);
        return;
      }
      if (!scrolledToMessage) {
        viewportRef.current?.scrollToMessage?.(image.messageId);
        scrolledToMessage = true;
      }
      if (!findRenderedImage(getRoot(), image)) {
        requestAnimationFrame(poll);
        return;
      }
      viewportRef.current?.scrollToMessage?.(image.messageId, {
        signal,
        targetTop() {
          const target = findRenderedImage(getRoot(), image);
          return target ? target.getBoundingClientRect().top - IMAGE_TOP_MARGIN : null;
        },
      });
    };
    requestAnimationFrame(poll);
  });

  // The strip scrolls, and a scroll container clips both axes, so the preview renders
  // outside it, beside the hovered thumbnail.
  const handleHoverChange = useCallback((next: HoveredThumb | null, key: string) => {
    if (next) {
      const railNode = railRef.current as unknown as HTMLElement | null;
      const railTop = railNode?.getBoundingClientRect().top ?? 0;
      setHovered({ ...next, centerY: next.centerY - railTop });
      return;
    }
    setHovered((current) => (current?.key === key ? null : current));
  }, []);
  const clearHover = useCallback(() => setHovered(null), []);

  const thumbSize = resolveThumbSize(panelWidth, contentMaxWidth);
  useEffect(() => {
    if (thumbSize === null) setHovered(null);
  }, [thumbSize]);
  if (images.length === 0) return null;

  return (
    <View
      ref={panelRef}
      style={styles.panelMeasure}
      pointerEvents="box-none"
      onLayout={handleLayout}
    >
      {thumbSize === null ? null : (
        <View ref={railRef} style={styles.rail} pointerEvents="box-none" testID="chat-images-rail">
          <ScrollView
            style={styles.scroller}
            contentContainerStyle={styles.scrollerContent}
            showsVerticalScrollIndicator={false}
            onScroll={clearHover}
            scrollEventThrottle={64}
          >
            {images.map((image, position) => (
              <ChatImageThumb
                key={image.key}
                image={image}
                label={`Image ${position + 1} of ${images.length}${image.alt ? `: ${image.alt}` : ""}`}
                size={thumbSize}
                isActive={image.messageId === activeMessageId}
                scrollIntoView={image.key === firstActiveKey}
                isHovered={image.key === hovered?.key}
                client={client}
                serverId={serverId}
                workspaceRoot={workspaceRoot}
                onHoverChange={handleHoverChange}
                onPress={jumpToImage}
              />
            ))}
          </ScrollView>
          {hovered ? <ChatImagePreview hovered={hovered} thumbSize={thumbSize} /> : null}
        </View>
      )}
    </View>
  );
});

interface HoveredThumb {
  key: string;
  uri: string;
  aspectRatio: number | null;
  /** Y of the thumbnail's centre when the pointer entered it: viewport y from the thumbnail,
   * rail-relative once stored. */
  centerY: number;
}

function ChatImagePreview({ hovered, thumbSize }: { hovered: HoveredThumb; thumbSize: number }) {
  const ratio = hovered.aspectRatio ?? 1;
  const size =
    ratio >= 1
      ? { width: PREVIEW_MAX, height: PREVIEW_MAX / ratio }
      : { width: PREVIEW_MAX * ratio, height: PREVIEW_MAX };
  const source = useMemo(() => ({ uri: hovered.uri }), [hovered.uri]);
  return (
    <View
      style={[
        styles.preview,
        inlineUnistylesStyle({
          right: thumbSize + PREVIEW_GAP,
          top: hovered.centerY - size.height / 2,
          width: size.width,
          height: size.height,
        }),
      ]}
      pointerEvents="none"
      aria-hidden
      testID="chat-images-preview"
    >
      <Image source={source} style={styles.previewImage} resizeMode="contain" />
    </View>
  );
}

interface ChatImageThumbProps {
  image: ChatImage;
  label: string;
  size: number;
  isActive: boolean;
  scrollIntoView: boolean;
  isHovered: boolean;
  client: DaemonClient | null;
  serverId: string;
  workspaceRoot: string;
  onHoverChange: (hovered: HoveredThumb | null, key: string) => void;
  onPress: (image: ChatImage) => void;
}

const ChatImageThumb = memo(function ChatImageThumb({
  image,
  label,
  size,
  isActive,
  scrollIntoView,
  isHovered,
  client,
  serverId,
  workspaceRoot,
  onHoverChange,
  onPress,
}: ChatImageThumbProps) {
  const slotRef = useRef<View>(null);
  // Keyed by source so repeats of one image share a single read.
  const loaded = useAssistantImage({
    source: image.source,
    occurrenceKey: `chat-images:${image.source}`,
    client,
    workspaceRoot,
    serverId,
  });
  const uri = loaded.status === "failed" ? null : (loaded.binding?.uri ?? null);
  const aspectRatio = loaded.status === "failed" ? null : loaded.aspectRatio;
  const imageSource = useMemo(() => (uri ? { uri } : null), [uri]);

  const handlePointerEnter = useCallback(() => {
    const node = slotRef.current as unknown as HTMLElement | null;
    if (!uri || !node) return;
    const rect = node.getBoundingClientRect();
    onHoverChange(
      { key: image.key, uri, aspectRatio, centerY: rect.top + rect.height / 2 },
      image.key,
    );
  }, [aspectRatio, image.key, onHoverChange, uri]);
  const handlePointerLeave = useCallback(
    () => onHoverChange(null, image.key),
    [image.key, onHoverChange],
  );
  const handlePress = useCallback(() => onPress(image), [image, onPress]);

  // Follow the reader: keep the thumbnail of the message on screen visible in the strip.
  useEffect(() => {
    if (!scrollIntoView) return;
    const node = slotRef.current as unknown as HTMLElement | null;
    node?.scrollIntoView?.({ block: "nearest" });
  }, [scrollIntoView]);

  return (
    <View
      ref={slotRef}
      style={styles.slot}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={`chat-images-thumb-${image.key}`}
        style={[
          styles.thumb,
          inlineUnistylesStyle({ width: size, height: size }),
          isActive && styles.thumbActive,
          isHovered && styles.thumbHovered,
        ]}
      >
        {imageSource ? (
          <Image
            source={imageSource}
            style={styles.thumbImage}
            resizeMode="cover"
            onLoad={loaded.status === "failed" ? undefined : loaded.binding?.onLoad}
            onError={loaded.status === "failed" ? undefined : loaded.binding?.onError}
            ref={loaded.status === "failed" ? undefined : loaded.binding?.onRef}
          />
        ) : (
          <View style={styles.thumbPlaceholder} />
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  panelMeasure: {
    position: "absolute",
    inset: 0,
  },
  rail: {
    position: "absolute",
    right: RAIL_INSET,
    top: "10%",
    bottom: "20%",
    justifyContent: "center",
    zIndex: 2,
  },
  scroller: {
    flexGrow: 0,
  },
  scrollerContent: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  slot: {
    position: "relative",
  },
  // At rest the strip stays quiet so it reads peripherally; the image under the reader and
  // the hovered one are the only emphasised states.
  thumb: {
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    opacity: 0.7,
    transitionProperty: "opacity, border-color",
    transitionDuration: "140ms",
    transitionTimingFunction: "ease-out",
  },
  thumbActive: {
    opacity: 1,
    borderColor: theme.colors.foregroundExtraMuted,
  },
  thumbHovered: {
    opacity: 1,
    borderColor: theme.colors.foreground,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    flex: 1,
  },
  preview: {
    position: "absolute",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
}));
