import { useEffect, useRef, type CSSProperties } from "react";
import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import { isPlainEscape, shouldReturnToComposer, type ChatEscapeFocusKind } from "./model";
import { focusChatComposer } from "./registry";
import type { ChatEscFocusSurfaceProps } from "./types";

// CUSTOM(chat-esc-focus): wraps the chat's selection-copy surface. Esc with chat text selected
// clears the selection and focuses this agent's composer. The listener runs in the bubble phase,
// after the global shortcut handler (capture phase), so a shortcut that handled Esc with
// preventDefault wins.

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

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
  style,
  children,
}: ChatEscFocusSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || !isPlainEscape(event)) return;
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
