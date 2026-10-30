import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Dimensions, View, type Role, type StyleProp, type ViewStyle } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { Portal } from "@gorhom/portal";
import {
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
import { FloatingSurface } from "@/components/ui/floating";
import {
  measureFloatingPanelPortalHost,
  useFloatingPanelPortalHostName,
} from "@/components/ui/floating-panel-portal";
import { isWeb } from "@/constants/platform";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import {
  computePosition,
  measureElement,
  type Alignment,
  type Placement,
  type Rect,
  type Size,
} from "./anchor";

const CLOSE_GRACE_MS = 100;

interface HoverCardContextValue {
  open: boolean;
  layer: number;
  setTriggerRef: (node: View | null) => void;
  triggerRef: RefObject<View | null>;
  contentRef: RefObject<View | null>;
  openNow: () => void;
  scheduleClose: () => void;
  /** CUSTOM(chat-file-actions): what the trigger's pointer events call, honoring `openDelayMs`. */
  enterTrigger: (event?: PointerLike) => void;
  leaveTrigger: () => void;
  close: () => void;
  /** CUSTOM(chat-file-actions): where the pointer was on the trigger when the card opened. */
  pointerXRef: RefObject<number | null>;
  trackPointer: (event?: PointerLike) => void;
}

interface PointerLike {
  nativeEvent?: { clientX?: number };
}

const HoverCardContext = createContext<HoverCardContextValue | null>(null);

/**
 * A card that opens while the pointer is on its trigger and stays open while the pointer crosses
 * onto it, so its content can be pressed. Hover only exists on web; elsewhere the trigger renders
 * alone and the content never mounts. See docs/hover.md.
 *
 * ```tsx
 * <HoverCard>
 *   <HoverCardTrigger>{trigger}</HoverCardTrigger>
 *   <HoverCardContent placement="top">{details}</HoverCardContent>
 * </HoverCard>
 * ```
 */
export function HoverCard({
  disabled = false,
  openDelayMs = 0,
  children,
}: {
  /** Closes the card and keeps it closed, e.g. while its trigger is dragged. */
  disabled?: boolean;
  /** CUSTOM(chat-file-actions): how long the pointer rests on the trigger before it opens. */
  openDelayMs?: number;
  children: ReactNode;
}): ReactNode {
  if (!isWeb) return children;
  return (
    <WebHoverCard disabled={disabled} openDelayMs={openDelayMs}>
      {children}
    </WebHoverCard>
  );
}

function WebHoverCard({
  disabled,
  openDelayMs,
  children,
}: {
  disabled: boolean;
  openDelayMs: number;
  children: ReactNode;
}): ReactElement {
  const layer = useOverlayLayer("floating");
  const triggerRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const [openState, setOpen] = useState(false);
  // CUSTOM(chat-file-actions): a hidden retained chat freezes one commit later (react-freeze), and
  // a card still open then stays forever in the workspace's portal host, over the tab that hid the
  // chat ("Abrir em aba"). Gate it on the panel in the same render that hides the chat, as
  // Tooltip does.
  const panelActive = useRetainedPanelActive();
  const panelActiveRef = useRef(panelActive);
  panelActiveRef.current = panelActive;
  const open = openState && panelActive;
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read when focus arrives: by focusout the element losing focus no longer matches :focus-visible.
  const keyboardFocusedRef = useRef(false);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const focusInside = useCallback(() => {
    if (!isWeb) return false;
    const active = document.activeElement;
    return [triggerRef.current, contentRef.current].some((view) =>
      (view as unknown as HTMLElement | null)?.contains(active),
    );
  }, []);

  // Keyboard focus keeps the card open for keyboard users; the focus a pointer click leaves
  // behind on the trigger or a button in the card does not outlast the pointer leaving.
  const keyboardFocusInside = useCallback(() => {
    return focusInside() && document.activeElement?.matches(":focus-visible") === true;
  }, [focusInside]);

  const scheduleClose = useCallback(() => {
    if (keyboardFocusInside()) return;
    if (graceTimerRef.current) return;
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      if (keyboardFocusInside()) return;
      setOpen(false);
    }, CLOSE_GRACE_MS);
  }, [keyboardFocusInside]);

  const openNow = useCallback(() => {
    clearGraceTimer();
    if (!disabled && panelActiveRef.current) {
      setOpen(true);
    }
  }, [clearGraceTimer, disabled]);

  const keyPressed = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!isWeb) return false;
      const trigger = triggerRef.current as unknown as HTMLElement | null;
      if (!trigger) return false;
      if (event.key === "Escape" && open) {
        event.preventDefault();
        if (focusInside()) trigger.focus();
        clearGraceTimer();
        setOpen(false);
        return true;
      } else if (
        focusInside() &&
        event.target === trigger &&
        ["ArrowDown", "Enter", " "].includes(event.key)
      ) {
        event.preventDefault();
        openNow();
        requestAnimationFrame(() => {
          (contentRef.current as unknown as HTMLElement | null)
            ?.querySelector<HTMLElement>(
              'button, [role="button"][tabindex="0"], a[href], input, [tabindex="0"]',
            )
            ?.focus();
        });
        return true;
      }
      return false;
    },
    [clearGraceTimer, focusInside, open, openNow],
  );

  const setOverlayScope = useWebOverlayRegistration({
    active: !disabled && open,
    layer,
    onKeyDown: keyPressed,
    manageFocus: false,
  });
  const setTriggerRef = useCallback(
    (node: View | null) => {
      triggerRef.current = node;
      setOverlayScope(node);
    },
    [setOverlayScope],
  );

  useEffect(() => {
    if (!isWeb) return;
    const trigger = triggerRef.current as unknown as HTMLElement | null;
    if (!trigger) return;
    const close = () => {
      clearGraceTimer();
      setOpen(false);
    };
    const focusEntered = (event: FocusEvent) => {
      const target = event.target as Element;
      keyboardFocusedRef.current = target.matches(":focus-visible");
      if (trigger.contains(target)) {
        openNow();
      } else if ((contentRef.current as unknown as HTMLElement | null)?.contains(target)) {
        clearGraceTimer();
      }
    };
    // Only keyboard focus keeps the card open, so only losing keyboard focus closes it. A button
    // that disables itself on press drops pointer focus while the pointer is still on the card.
    const focusLeft = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (
        keyboardFocusedRef.current &&
        !trigger.contains(next) &&
        !(contentRef.current as unknown as HTMLElement | null)?.contains(next)
      ) {
        scheduleClose();
      }
    };
    const activateClosedTrigger = (event: KeyboardEvent) => {
      if (
        !open &&
        !event.defaultPrevented &&
        !event.isComposing &&
        ["ArrowDown", "Enter", " "].includes(event.key)
      )
        keyPressed(event);
    };
    const scrolled = (event: Event) => {
      if (!(contentRef.current as unknown as HTMLElement | null)?.contains(event.target as Node))
        close();
    };
    document.addEventListener("focusin", focusEntered);
    document.addEventListener("focusout", focusLeft);
    trigger.addEventListener("keydown", activateClosedTrigger);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("focusin", focusEntered);
      document.removeEventListener("focusout", focusLeft);
      trigger.removeEventListener("keydown", activateClosedTrigger);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [clearGraceTimer, keyPressed, open, openNow, scheduleClose]);

  // While open, the safe zone covers trigger + content + the bridge between
  // them. Close only fires when the pointer leaves the safe zone; re-entering
  // it (including the bridge) cancels the pending close.
  useHoverSafeZone({
    enabled: open,
    triggerRef,
    contentRef,
    onEnterSafeZone: clearGraceTimer,
    onLeaveSafeZone: scheduleClose,
  });

  useEffect(() => {
    if (disabled) {
      clearGraceTimer();
      setOpen(false);
    }
  }, [clearGraceTimer, disabled]);

  useEffect(() => clearGraceTimer, [clearGraceTimer]);

  // CUSTOM(chat-file-actions): a delayed open, so sweeping the pointer across text doesn't flash it.
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerXRef = useRef<number | null>(null);
  // Follows the pointer until the card opens; an open card stays where it opened.
  const trackPointer = useCallback(
    (event?: PointerLike) => {
      const x = event?.nativeEvent?.clientX;
      if (!open && typeof x === "number") pointerXRef.current = x;
    },
    [open],
  );
  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);
  const enterTrigger = useCallback(
    (event?: PointerLike) => {
      trackPointer(event);
      if (openDelayMs <= 0 || open) {
        openNow();
        return;
      }
      clearGraceTimer();
      clearOpenTimer();
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        openNow();
      }, openDelayMs);
    },
    [clearGraceTimer, clearOpenTimer, open, openDelayMs, openNow, trackPointer],
  );
  const leaveTrigger = useCallback(() => {
    clearOpenTimer();
    scheduleClose();
  }, [clearOpenTimer, scheduleClose]);
  useEffect(() => clearOpenTimer, [clearOpenTimer]);
  const close = useCallback(() => {
    clearOpenTimer();
    clearGraceTimer();
    setOpen(false);
  }, [clearGraceTimer, clearOpenTimer]);
  // CUSTOM(chat-file-actions): and stay closed when the chat comes back.
  useEffect(() => {
    if (!panelActive) close();
  }, [close, panelActive]);

  const value = useMemo<HoverCardContextValue>(
    () => ({
      open,
      layer,
      setTriggerRef,
      triggerRef,
      contentRef,
      openNow,
      scheduleClose,
      enterTrigger,
      leaveTrigger,
      close,
      pointerXRef,
      trackPointer,
    }),
    [
      open,
      layer,
      setTriggerRef,
      openNow,
      scheduleClose,
      enterTrigger,
      leaveTrigger,
      close,
      trackPointer,
    ],
  );

  return (
    <OverlayLayerProvider layer={layer}>
      <HoverCardContext.Provider value={value}>{children}</HoverCardContext.Provider>
    </OverlayLayerProvider>
  );
}

/**
 * CUSTOM(chat-file-actions): closes the enclosing card now, e.g. after an action in it opened a
 * tab: the pointer never "leaves" a card whose trigger got hidden, so it would stay up. Call it
 * from a component under `HoverCard` (the content renders in a portal, outside the context).
 */
export function useHoverCardClose(): () => void {
  const ctx = useContext(HoverCardContext);
  return ctx?.close ?? noop;
}

function noop() {}

export function HoverCardTrigger({
  children,
  focusable = false,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  focusable?: boolean;
  accessibilityLabel?: string;
  /** CUSTOM(chat-file-actions): e.g. inline-flex, for a trigger inside running text. */
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const ctx = useContext(HoverCardContext);
  if (!ctx) return children;
  return (
    <View
      ref={ctx.setTriggerRef}
      tabIndex={focusable ? 0 : undefined}
      accessibilityRole={focusable ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      collapsable={false}
      style={style}
      onPointerEnter={ctx.enterTrigger}
      onPointerMove={ctx.trackPointer}
      onPointerLeave={ctx.leaveTrigger}
    >
      {children}
    </View>
  );
}

interface HoverCardContentProps {
  placement: Placement;
  alignment?: Alignment;
  offset?: number;
  /** Layered over the default popover surface. */
  style?: StyleProp<ViewStyle>;
  role?: Role;
  accessibilityLabel?: string;
  testID?: string;
  /**
   * CUSTOM(chat-file-actions): anchor the card's left edge this many px left of the pointer
   * instead of at the trigger, so what sits there in the card is right above the pointer. Still
   * kept on screen.
   */
  pointerAnchorOffset?: number;
  /** Mounted only while the card is open, so whatever it fetches runs only then. */
  children: ReactNode;
}

export function HoverCardContent(props: HoverCardContentProps): ReactElement | null {
  const ctx = useContext(HoverCardContext);
  if (!ctx?.open) return null;
  return (
    <HoverCardSurface
      {...props}
      layer={ctx.layer}
      triggerRef={ctx.triggerRef}
      contentRef={ctx.contentRef}
      pointerX={ctx.pointerXRef.current}
    />
  );
}

function HoverCardSurface({
  layer,
  triggerRef,
  contentRef,
  placement,
  alignment = "center",
  offset = 4,
  style,
  role,
  accessibilityLabel,
  testID,
  pointerAnchorOffset,
  pointerX,
  children,
}: HoverCardContentProps & {
  layer: number;
  triggerRef: RefObject<View | null>;
  contentRef: RefObject<View | null>;
  pointerX: number | null;
}): ReactElement {
  const portalHostName = useFloatingPanelPortalHostName();
  const [anchor, setAnchor] = useState<{ triggerRect: Rect; hostRect: Rect } | null>(null);
  const [contentSize, setContentSize] = useState<Size | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!triggerRef.current) return;
    let cancelled = false;
    void Promise.all([
      measureElement(triggerRef.current),
      measureFloatingPanelPortalHost(portalHostName),
    ]).then(([rect, hostRect]) => {
      if (cancelled || !hostRect) return undefined;
      // CUSTOM(chat-file-actions): a zero-width anchor at the pointer, with start alignment.
      const triggerRect =
        pointerAnchorOffset !== undefined && pointerX !== null
          ? { ...rect, x: pointerX - pointerAnchorOffset, width: 0 }
          : rect;
      setAnchor({ triggerRect, hostRect });
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [pointerAnchorOffset, pointerX, portalHostName, triggerRef]);

  useEffect(() => {
    if (!anchor || !contentSize) return;
    const { width, height } = Dimensions.get("window");
    const { x, y } = computePosition({
      triggerRect: anchor.triggerRect,
      contentSize,
      displayArea: { x: 0, y: 0, width, height },
      placement,
      flipHorizontal: true,
      alignment,
      offset,
    });
    setPosition({ x: x - anchor.hostRect.x, y: y - anchor.hostRect.y });
  }, [alignment, anchor, contentSize, offset, placement]);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = event.nativeEvent.layout;
      setContentSize({ width, height });
    },
    [],
  );

  const frameStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: position?.y ?? -9999,
      left: position?.x ?? -9999,
    }),
    [position?.x, position?.y],
  );
  const surfaceStyle = useMemo(() => [styles.surface, style], [style]);

  return (
    <Portal hostName={portalHostName}>
      <View pointerEvents="box-none" style={[styles.portalOverlay, { zIndex: layer }]}>
        <FloatingSurface
          ref={contentRef}
          entering={FadeIn.duration(80)}
          exiting={FadeOut.duration(80)}
          collapsable={false}
          onLayout={handleLayout}
          role={role}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          style={surfaceStyle}
          frameStyle={frameStyle}
        >
          {children}
        </FloatingSurface>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create((theme) => ({
  portalOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  surface: {
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadow.md,
    zIndex: 1000,
  },
}));
