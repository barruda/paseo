// CUSTOM(chat-images): the image strip beside the chat. See custom/CHANGES.md.
import type { RefObject } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ActivePromptSource } from "../chat-outline/model";
import type { StreamViewportHandle } from "../strategy";
import type { ChatImage } from "./model";

export interface ChatImagesRailProps {
  images: ChatImage[];
  /** Publishes the timeline position under the top of the viewport. */
  readingPosition: ActivePromptSource;
  client: DaemonClient | null;
  serverId: string;
  workspaceRoot: string;
  contentMaxWidth: number;
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleMessageIds: ReadonlySet<string>;
  revealLoadedMessage: (messageId: string) => boolean;
}

// The strip lives in the gutter beside the transcript, which only wide layouts have.
export function ChatImagesRail(_props: ChatImagesRailProps): null {
  return null;
}
