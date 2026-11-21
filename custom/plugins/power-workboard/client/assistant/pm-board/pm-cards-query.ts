// CUSTOM(pm-chat-sync): the PM board's cards, read by the Decisões page and by every chat reply
// that cites a card as `[pm:<id>]`. One query key per host, so the page and the chat share one
// 5 s poll, and a decide or reopen on either side refreshes both.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { assistantPmCardsRpc } from "../../../shared/assistant-rpc";

export const PM_CARDS_POLL_MS = 5_000;

export function pmCardsQueryKey(hostId: string) {
  return ["power-workboard", "pm-board", hostId] as const;
}

/** The board's cards and their extras, polled while `enabled`. */
export function usePmCards(hostId: string, enabled = true) {
  const callCards = useRpc(assistantPmCardsRpc);
  return useQuery({
    queryKey: pmCardsQueryKey(hostId),
    queryFn: () => callCards({}),
    refetchInterval: PM_CARDS_POLL_MS,
    enabled,
  });
}

/** Refetches the cards now, after a decide or a reopen. */
export function useRefreshPmCards(hostId: string): () => Promise<void> {
  const cache = useQueryClient();
  return () => cache.invalidateQueries({ queryKey: pmCardsQueryKey(hostId) });
}
