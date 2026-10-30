// CUSTOM(chat-links): the link list beside the chat. See custom/CHANGES.md.
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { InlinePathTarget } from "@/assistant-file-links";
import type { ToastApi } from "@/components/toast-host";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { ChatLink } from "./model";

export interface ChatLinksBoxProps {
  links: ChatLink[];
  client: DaemonClient | null;
  serverId: string;
  workspaceRoot: string;
  sessionPaths?: readonly string[];
  onOpenWorkspaceFile: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  toast?: ToastApi | null;
  contentMaxWidth: number;
  /** Distance from the bottom of the chat that keeps the box clear of the composer. */
  bottomOffset: number;
  /** Height the box takes from the bottom of the gutter, so the image strip stays above it. */
  onReservedHeightChange: (height: number) => void;
}

// The box lives in the gutter beside the transcript, which only wide layouts have.
export function ChatLinksBox(_props: ChatLinksBoxProps): null {
  return null;
}
