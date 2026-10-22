import { useEffect, useRef, type CSSProperties } from "react";
import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import {
  isPlainEnter,
  isPlainEscape,
  shouldEnterFocusComposer,
  shouldReachBottomFocusComposer,
  shouldReturnToComposer,
  type ChatEscapeFocusKind,
} from "./model";
import { focusChatComposer } from "./registry";
import type { ChatEscFocusSurfaceProps } from "./types";

// CUSTOM(chat-esc-focus): wraps the chat's selection-copy surface. Esc with chat text selected
// clears the selection and focuses this agent's composer. The listener runs in the bubble phase,
// after the global shortcut handler (capture phase), so a shortcut that handled Esc with
// preventDefault wins. Enter with nothing focused, and scrolling back to the bottom, also focus
// the composer (see model.ts).

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

// The chat the user last pointed at or scrolled, and how many chats are mounted. With a single
// chat it owns Enter even before any interaction.
let lastInteractedRoot: HTMLElement | null = null;
let mountedSurfaces = 0;

function isLastInteracted(root: HTMLElement): boolean {
  if (lastInteractedRoot === root) return true;
  return mountedSurfaces === 1 && (lastInteractedRoot === null || !lastInteractedRoot.isConnected);
}

function isEditable(element: Element): boolean {
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function classifyFocus(root: HTMLElement): ChatEscapeFocusKind {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return "body";
  if (isEditable(active)) return "editable";
  if (root.contains(active)) return "timeline";
  if (active.contains(root)) return "ancestor";
  return "other";
}

function hasSelectionInside(root: HTMLElement, selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
    return false;
  }
  const { anchorNode, focusNode } = selection;
  return Boolean(anchorNode && focusNode && root.contains(anchorNode) && root.contains(focusNode));
}

export function ChatEscFocusSurface({
  serverId,
  agentId,
  enabled,
  isNearBottom,
  style,
  children,
}: ChatEscFocusSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(isNearBottom);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    mountedSurfaces++;
    const markInteracted = () => {
      lastInteractedRoot = root;
    };
    root.addEventListener("pointerdown", markInteracted);
    root.addEventListener("wheel", markInteracted, { passive: true });
    return () => {
      mountedSurfaces--;
      if (lastInteractedRoot === root) lastInteractedRoot = null;
      root.removeEventListener("pointerdown", markInteracted);
      root.removeEventListener("wheel", markInteracted);
    };
  }, [enabled]);

  useEffect(() => {
    const wasNearBottom = wasNearBottomRef.current;
    wasNearBottomRef.current = isNearBottom;
    const root = rootRef.current;
    if (!enabled || !root) return;
    const focusComposer = shouldReachBottomFocusComposer({
      wasNearBottom,
      isNearBottom,
      hasTimelineSelection: hasSelectionInside(root, window.getSelection()),
      focus: classifyFocus(root),
      isLastInteracted: isLastInteracted(root),
    });
    if (focusComposer) focusChatComposer(serverId, agentId);
  }, [agentId, enabled, isNearBottom, serverId]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (isPlainEnter(event)) {
        const focus = classifyFocus(root);
        // Enter on a focused button or link in the chat keeps activating it.
        const active = document.activeElement;
        if (focus === "timeline" && active?.closest("button, a, [role='button']")) return;
        if (!shouldEnterFocusComposer({ focus, isLastInteracted: isLastInteracted(root) })) return;
        if (focusChatComposer(serverId, agentId)) event.preventDefault();
        return;
      }
      if (!isPlainEscape(event)) return;
      const selection = window.getSelection();
      const returnToComposer = shouldReturnToComposer({
        hasTimelineSelection: hasSelectionInside(root, selection),
        focus: classifyFocus(root),
      });
      if (!returnToComposer) return;
      selection?.removeAllRanges();
      focusChatComposer(serverId, agentId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agentId, enabled, serverId]);

  return (
    <div ref={rootRef} style={DISPLAY_CONTENTS}>
      <AssistantSelectionCopySurface style={style}>{children}</AssistantSelectionCopySurface>
    </div>
  );
}
