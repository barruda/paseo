// CUSTOM(pm-sidebar-decisions): bits the Decisões page and the chat sidebar's list share.
import { useMutation } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { assistantPmDecideRpc } from "../../../shared/assistant-rpc";
import type { PmCardKind } from "../../../shared/pm-board";

type Theme = PluginSurfaceProps["theme"];

export const kindColor = (kind: PmCardKind, theme: Theme) =>
  kind === "decision"
    ? theme.colors.statusSuccess
    : kind === "proposal"
      ? theme.colors.accent
      : kind === "investigation"
        ? theme.colors.statusWarning
        : theme.colors.foregroundMuted;

export type PmDecideInput = {
  cardId: string;
  optionId?: string | null;
  answer?: string | null;
};

/** The decide mutation; `onSuccess` and `onError` are the caller's own bookkeeping. */
export function usePmDecide(handlers: {
  onSuccess(result: { card: { id: string }; messageId?: string | null }): void;
  onError(): void;
}) {
  const callDecide = useRpc(assistantPmDecideRpc);
  return useMutation({
    mutationFn: (input: PmDecideInput) => callDecide(input),
    onSuccess: handlers.onSuccess,
    onError: handlers.onError,
  });
}
