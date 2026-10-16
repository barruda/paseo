import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
import type { ChatEscFocusSurfaceProps } from "./types";

// CUSTOM(chat-esc-focus): native has no mouse text selection in the chat, so this only renders
// the selection-copy surface it wraps. See surface.web.tsx.
export function ChatEscFocusSurface({ style, children }: ChatEscFocusSurfaceProps) {
  return <AssistantSelectionCopySurface style={style}>{children}</AssistantSelectionCopySurface>;
}
