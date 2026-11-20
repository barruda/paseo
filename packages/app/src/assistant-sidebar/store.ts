// CUSTOM(assistant-sidebar): which Projects Assistant chat the sidebar tab shows, and the pending
// request to reveal it. The Desk or workspace screen that has the focus handles the request,
// since only it knows which Explorer is on screen.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { AssistantChatRef } from "./model";

interface AssistantSidebarState {
  /** The chat last opened; the tab follows its successor and falls back to any live chat. */
  chat: AssistantChatRef | null;
  /** Bumped by every open; not persisted. */
  requestSeq: number;
  /** The last request a screen revealed. */
  handledSeq: number;
  /** Whether the request should focus the composer once the chat shows. */
  focusComposer: boolean;
  request(chat: AssistantChatRef | null, focusComposer: boolean): void;
  setChat(chat: AssistantChatRef): void;
  markHandled(seq: number): void;
}

const chatSchema = z.object({ serverId: z.string(), agentId: z.string() });

export const useAssistantSidebarStore = create<AssistantSidebarState>()(
  persist(
    (set) => ({
      chat: null,
      requestSeq: 0,
      handledSeq: 0,
      focusComposer: false,
      request: (chat, focusComposer) =>
        set((state) => ({
          chat: chat ?? state.chat,
          requestSeq: state.requestSeq + 1,
          focusComposer,
        })),
      setChat: (chat) =>
        set((state) =>
          state.chat?.serverId === chat.serverId && state.chat.agentId === chat.agentId
            ? state
            : { chat },
        ),
      markHandled: (seq) => set((state) => (state.handledSeq >= seq ? state : { handledSeq: seq })),
    }),
    {
      name: "custom-assistant-sidebar",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ chat: chatSchema.nullable() }),
      ),
      partialize: (state) => ({ chat: state.chat }),
    },
  ),
);
