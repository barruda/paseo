// CUSTOM(empty-composer-shortcuts): share keyboard selection with the transcript.
import { create } from "zustand";
import type { StreamItem } from "@/types/stream";

interface RewindSelection {
  serverId: string;
  agentId: string;
  messageId: string;
  open: boolean;
}

export const useComposerRewindSelection = create<{ selection: RewindSelection | null }>(() => ({
  selection: null,
}));

export function latestSentMessage(items: readonly StreamItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.kind === "user_message" && item.messageId) return item.messageId;
  }
  return null;
}

export function previousProjectId(ids: readonly string[], selected: string | null): string | null {
  if (ids.length === 0) return null;
  const index = selected === null ? -1 : ids.indexOf(selected);
  if (index < 0) return ids[ids.length - 1];
  return ids[(index - 1 + ids.length) % ids.length];
}

export function clearComposerRewindSelection(): void {
  useComposerRewindSelection.setState({ selection: null });
}

export function useMessageKeyboardSelection(
  serverId: string | undefined,
  agentId: string | undefined,
  messageId: string | undefined,
) {
  const selection = useComposerRewindSelection((state) => state.selection);
  const selected =
    selection !== null &&
    selection.serverId === serverId &&
    selection.agentId === agentId &&
    selection.messageId === messageId;
  return { selected, open: selected && selection.open };
}

interface RewindKeyInput {
  event: import("./input/input").ComposerKeyPressEvent;
  serverId: string;
  agentId: string;
  items: readonly StreamItem[];
}

export function handleEmptyRewindKey({ event, serverId, agentId, items }: RewindKeyInput): boolean {
  const selection = useComposerRewindSelection.getState().selection;
  const isSelected = selection?.serverId === serverId && selection.agentId === agentId;
  if (event.hasModifier) return false;
  if (event.input.text.length > 0 || event.key === "Escape") {
    if (isSelected) clearComposerRewindSelection();
    return false;
  }
  if (event.key === "ArrowUp") {
    const messageId = latestSentMessage(items);
    if (!messageId) return false;
    useComposerRewindSelection.setState({
      selection: { serverId, agentId, messageId, open: false },
    });
  } else if (event.key === "Enter" && isSelected) {
    useComposerRewindSelection.setState({ selection: { ...selection, open: true } });
  } else {
    if (isSelected) clearComposerRewindSelection();
    return false;
  }
  event.preventDefault();
  return true;
}
