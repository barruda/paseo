import type { ReactNode } from "react";

// CUSTOM(chat-comments): commenting needs a right click on selected text, so native has none.
export function ChatCommentSurface({
  children,
}: {
  serverId: string;
  agentId: string;
  enabled: boolean;
  children: ReactNode;
}): ReactNode {
  return children;
}
