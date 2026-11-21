// CUSTOM(assistant-desk): which Projects Assistant chat the assistant Desk shows, and the chat
// whose open is waiting for the session to list its agent (not persisted).
// CUSTOM(pm-sidebar): `requested` is the chat the right sidebar was asked to show before the
// session listed it (not persisted).
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
  /**
   * CUSTOM(pm-sidebar): a chat openAssistantSidebar was asked for that the session does not list
   * yet. The sidebar shows it as it is until the session lists it; not persisted.
   */
  requested: AssistantChatRef | null;
  setChat(chat: AssistantChatRef): void;
  setPending(chat: AssistantChatRef | null): void;
  setRequested(chat: AssistantChatRef | null): void;
}

const chatSchema = z.object({ serverId: z.string(), agentId: z.string() });

export const useAssistantSidebarStore = create<AssistantSidebarState>()(
  persist(
    (set) => ({
      chat: null,
      pending: null,
      requested: null,
      setChat: (chat) =>
        set((state) =>
          state.chat?.serverId === chat.serverId && state.chat.agentId === chat.agentId
            ? state
            : // Another chat drops a request for an unlisted one.
              { chat, requested: null },
        ),
      setPending: (pending) => set({ pending }),
      setRequested: (requested) => set({ requested }),
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
