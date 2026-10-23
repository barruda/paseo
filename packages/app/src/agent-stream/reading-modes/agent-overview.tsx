// CUSTOM(reading-modes): the agent stream's side of Newspaper and Cards. It builds the turns from
// the loaded transcript, renders their answers with the chat's Markdown, and hands a clicked turn
// back to the chat, which is still mounted underneath.
import { type RefObject, useCallback, useMemo, useRef } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createAssistantImageOccurrenceKey } from "@/assistant-image/acquisition-cache";
import { AssistantFileLinkResolverProvider } from "@/assistant-file-links";
import type { AssistantFileLinkResolverConfig } from "@/assistant-file-links/provider";
import { AssistantMessage } from "@/components/message";
import type { ToastApi } from "@/components/toast-host";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import {
  buildReadingTurns,
  type ReadingHistory,
  type ReadingMode,
  type ReadingTurn,
} from "./model";
import { ReadingOverview } from "./overview";
import { useReadingModeStore } from "./store";

const JUMP_TIMEOUT_MS = 3000;

export interface AgentReadingOverviewProps {
  mode: ReadingMode;
  agentId: string;
  serverId: string;
  client: DaemonClient | null;
  workspaceRoot: string;
  toast?: ToastApi | null;
  onOpenWorkspaceFile: AssistantFileLinkResolverConfig["onOpenWorkspaceFile"];
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleMessageIds: ReadonlySet<string>;
  revealLoadedMessage: (messageId: string) => boolean;
  /** The daemon's older history: the overview loads all of it before it lays out pages. */
  history: ReadingHistory;
  /** Changes when the chat is sent to the bottom (a message was sent); the pages go to the end. */
  followRequest: number;
  onAtEndChange: (atEnd: boolean) => void;
  /** Height of the composer floating over the bottom of the chat. */
  bottomInset: number;
}

// Stays mounted in every mode: opening a turn switches back to the chat, and the jump keeps
// reading the chat's fresh bindings until the turn renders.
export function AgentReadingOverview({
  mode,
  agentId,
  serverId,
  client,
  workspaceRoot,
  toast,
  onOpenWorkspaceFile,
  tail,
  head,
  viewportRef,
  visibleMessageIds,
  revealLoadedMessage,
  history,
  followRequest,
  onAtEndChange,
  bottomInset,
}: AgentReadingOverviewProps) {
  const isOverview = mode === "newspaper" || mode === "cards";
  const turns = useMemo(
    () => (isOverview ? buildReadingTurns(head ? [...tail, ...head] : tail) : []),
    [isOverview, tail, head],
  );
  const resetReadingMode = useReadingModeStore((state) => state.reset);

  // A turn outside the mounted history window is revealed first, then scrolled to once the chat
  // renders it.
  const bindingsRef = useRef({ visibleMessageIds, revealLoadedMessage });
  bindingsRef.current = { visibleMessageIds, revealLoadedMessage };
  const openTurn = useStableEvent((turn: ReadingTurn) => {
    resetReadingMode(agentId);
    const messageId = turn.jumpMessageId;
    const deadline = performance.now() + JUMP_TIMEOUT_MS;
    const poll = () => {
      if (performance.now() >= deadline) return;
      const bindings = bindingsRef.current;
      if (!bindings.visibleMessageIds.has(messageId)) {
        if (bindings.revealLoadedMessage(messageId)) requestAnimationFrame(poll);
        return;
      }
      viewportRef.current?.scrollToMessage?.(messageId);
    };
    requestAnimationFrame(poll);
  });

  const renderAnswer = useCallback(
    (item: AssistantMessageItem) => (
      <AssistantFileLinkResolverProvider
        client={client}
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        toast={toast}
      >
        <AssistantMessage
          renderFullContent
          occurrenceKey={createAssistantImageOccurrenceKey({
            agentId,
            itemId: `reading:${item.id}`,
          })}
          message={item.text}
          timestamp={item.timestamp.getTime()}
          workspaceRoot={workspaceRoot}
          serverId={serverId}
          client={client}
          phase="complete"
        />
      </AssistantFileLinkResolverProvider>
    ),
    [agentId, client, onOpenWorkspaceFile, serverId, toast, workspaceRoot],
  );

  if (!isOverview) return null;
  return (
    <ReadingOverview
      mode={mode}
      turns={turns}
      renderAnswer={renderAnswer}
      onOpenTurn={openTurn}
      history={history}
      followRequest={followRequest}
      onAtEndChange={onAtEndChange}
      bottomInset={bottomInset}
    />
  );
}
