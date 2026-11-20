// CUSTOM(assistant-desk): which Projects Assistant chat the assistant Desk shows, and the chat
// whose open is waiting for the session to list its agent (not persisted).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { AssistantChatRef } from "./model";

interface AssistantSidebarState {
  /** The chat last opened; the Desk follows its successor and falls back to any live chat. */
  chat: AssistantChatRef | null;
  /** A chat the session did not list yet when it was opened; not persisted. */
  pending: AssistantChatRef | null;
  setChat(chat: AssistantChatRef): void;
  setPending(chat: AssistantChatRef | null): void;
}

const chatSchema = z.object({ serverId: z.string(), agentId: z.string() });

export const useAssistantSidebarStore = create<AssistantSidebarState>()(
  persist(
    (set) => ({
      chat: null,
      pending: null,
      setChat: (chat) =>
        set((state) =>
          state.chat?.serverId === chat.serverId && state.chat.agentId === chat.agentId
            ? state
            : { chat },
        ),
      setPending: (pending) => set({ pending }),
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
