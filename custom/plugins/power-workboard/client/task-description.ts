// CUSTOM(task-description-files): the board snapshot carries no description. The ticket panel,
// the editor and the board search read them through taskDescriptionsRpc, cached per revision.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import type { Card } from "../shared/model";
import { taskDescriptionsRpc } from "../shared/rpc";

type DescriptionCall = (input: { taskIds: string[] }) => Promise<{
  descriptions: { taskId: string; revision: number; text: string }[];
}>;
type DescribedCard = Pick<Card, "id" | "descriptionRevision">;

/** One task's description, as a query: the revision in the key refetches it after an edit. */
export function taskDescriptionQuery(
  call: DescriptionCall,
  card: DescribedCard,
) {
  return {
    queryKey: [
      "power-workboard",
      "task-description",
      card.id,
      card.descriptionRevision,
    ],
    queryFn: async () => {
      const { descriptions } = await call({ taskIds: [card.id] });
      return descriptions.find((d) => d.taskId === card.id)?.text ?? "";
    },
    staleTime: Infinity,
  };
}

export function useTaskDescription(card: DescribedCard) {
  const call = useRpc(taskDescriptionsRpc);
  return useQuery(taskDescriptionQuery(call, card));
}

/**
 * The descriptions of the given cards while the board search has text, for matching. Empty
 * otherwise, and until the first answer arrives.
 */
export function useSearchDescriptions(
  cards: readonly DescribedCard[],
  searching: boolean,
): ReadonlyMap<string, string> {
  const call = useRpc(taskDescriptionsRpc);
  const ids = cards.map((card) => card.id);
  const query = useQuery({
    queryKey: [
      "power-workboard",
      "task-descriptions",
      cards.map((card) => `${card.id}:${card.descriptionRevision}`).join(","),
    ],
    queryFn: async () => {
      const { descriptions } = await call({ taskIds: ids });
      return new Map(descriptions.map((d) => [d.taskId, d.text]));
    },
    enabled: searching && ids.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  return (searching && query.data) || EMPTY;
}

const EMPTY: ReadonlyMap<string, string> = new Map();
