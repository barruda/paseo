// CUSTOM(empty-composer-shortcuts): share keyboard selection with the transcript.
import { create } from "zustand";
import { focusChatComposer } from "@/chat-esc-focus/registry";
import type { StreamItem } from "@/types/stream";

interface RewindSelection {
  serverId: string;
  agentId: string;
  messageId: string;
  open: boolean;
}

interface BottomRequest {
  serverId: string;
  agentId: string;
  nonce: number;
}

export const useComposerRewindSelection = create<{
  selection: RewindSelection | null;
  /** Leaving a selection asks that agent's transcript to jump back to the bottom. */
  bottomRequest: BottomRequest | null;
}>(() => ({
  selection: null,
  bottomRequest: null,
}));

export function latestSentMessage(items: readonly StreamItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.kind === "user_message" && item.messageId) return item.messageId;
  }
  return null;
}

/** The sent message one step older (-1) or newer (+1) than `current`; null past either end. */
export function adjacentSentMessage(
  items: readonly StreamItem[],
  current: string,
  step: -1 | 1,
): string | null {
  const ids = items.flatMap((item) =>
    item.kind === "user_message" && item.messageId ? [item.messageId] : [],
  );
  const index = ids.lastIndexOf(current);
  if (index < 0) return null;
  return ids[index + step] ?? null;
}

export function previousProjectId(ids: readonly string[], selected: string | null): string | null {
  if (ids.length === 0) return null;
  const index = selected === null ? -1 : ids.indexOf(selected);
  if (index < 0) return ids[ids.length - 1];
  return ids[(index - 1 + ids.length) % ids.length];
}

export function nextProjectId(ids: readonly string[], selected: string | null): string | null {
  if (ids.length === 0) return null;
  const index = selected === null ? -1 : ids.indexOf(selected);
  if (index < 0) return ids[0];
  return ids[(index + 1) % ids.length];
}

export function clearComposerRewindSelection(): void {
  useComposerRewindSelection.setState({ selection: null });
}

/** Esc, Down past the latest, or closing the rewind menu: back to the bottom and the composer. */
export function leaveComposerRewindSelection(): void {
  const { selection, bottomRequest } = useComposerRewindSelection.getState();
  if (!selection) return;
  const { serverId, agentId } = selection;
  useComposerRewindSelection.setState({
    selection: null,
    bottomRequest: { serverId, agentId, nonce: (bottomRequest?.nonce ?? 0) + 1 },
  });
  focusChatComposer(serverId, agentId);
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
  if (event.key === "Escape" && isSelected) {
    leaveComposerRewindSelection();
    event.preventDefault();
    return true;
  }
  if (event.input.text.length > 0) {
    if (isSelected) clearComposerRewindSelection();
    return false;
  }
  if (event.key === "ArrowUp") {
    // Up walks to older sent messages; it stays on the oldest loaded one.
    const messageId = isSelected
      ? (adjacentSentMessage(items, selection.messageId, -1) ?? selection.messageId)
      : latestSentMessage(items);
    if (!messageId) return false;
    useComposerRewindSelection.setState({
      selection: { serverId, agentId, messageId, open: false },
    });
  } else if (event.key === "ArrowDown" && isSelected) {
    // Down walks back to newer messages; past the latest it clears the selection.
    const messageId = adjacentSentMessage(items, selection.messageId, 1);
    if (messageId) {
      useComposerRewindSelection.setState({
        selection: { serverId, agentId, messageId, open: false },
      });
    } else {
      leaveComposerRewindSelection();
    }
  } else if (event.key === "Enter" && isSelected) {
    useComposerRewindSelection.setState({ selection: { ...selection, open: true } });
  } else {
    if (isSelected) clearComposerRewindSelection();
    return false;
  }
  event.preventDefault();
  return true;
}

/** Cycle favorites in picker order, excluding models that are no longer available. */
export function previousModelSelection(
  providers: readonly import("@/provider-selection/provider-selection").ProviderSelectorProvider[],
  provider: string | null,
  modelId: string | null,
  favoriteKeys: readonly string[],
) {
  const available = providers.flatMap((entry) =>
    entry.modelSelection.kind === "models" ? entry.modelSelection.rows : [],
  );
  const byKey = new Map(available.map((entry) => [entry.favoriteKey, entry]));
  const models = favoriteKeys.flatMap((key) => byKey.get(key) ?? []);
  if (!models.length) return null;
  const current = models.findIndex(
    (entry) => entry.provider === provider && entry.modelId === modelId,
  );
  return models[current < 0 ? models.length - 1 : (current - 1 + models.length) % models.length];
}

/** The next effort level, wrapping from the last back to the first. */
export function nextEffortId(
  options: readonly { id: string }[] | null | undefined,
  selectedId: string | null | undefined,
): string | null {
  if (!options?.length) return null;
  const current = options.findIndex((option) => option.id === selectedId);
  return options[(current + 1) % options.length].id;
}
