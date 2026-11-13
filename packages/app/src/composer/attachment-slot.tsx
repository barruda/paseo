// CUSTOM(chat-options): the attachment "+" is drawn by the composer input but ordered with the
// agent controls (Settings > Chat Options > Inside left). The input provides the node here and
// the desktop AgentControls places it; null means the input draws it itself.
import { createContext, useContext, type ReactNode } from "react";

const ComposerAttachmentSlotContext = createContext<ReactNode>(null);

export const ComposerAttachmentSlotProvider = ComposerAttachmentSlotContext.Provider;

export function useComposerAttachmentSlot(): ReactNode {
  return useContext(ComposerAttachmentSlotContext);
}
