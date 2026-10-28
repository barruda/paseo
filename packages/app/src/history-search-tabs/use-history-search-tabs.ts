import { useCallback, useMemo } from "react";
import { useHistoryAiSearch, type HistoryAiSearchResult } from "@/hooks/use-history-ai-search";
import type { HistorySearchTabTarget } from "@/workspace-tabs/model";
import { openHistorySearchTab } from "./open";

// CUSTOM(history-search-tabs): Enter in either History search field keeps the search as a tab.
// The History screen opens it in the last workspace (or Desk); a History search tab passes its
// binding and opens the next search beside itself.

export interface HistorySearchTabBinding {
  target: HistorySearchTabTarget;
  openSearch: (target: HistorySearchTabTarget) => void;
}

/** The keyword search a History screen starts with: the tab's, unless it is an AI tab. */
export function initialHistorySearchInput(tab: HistorySearchTabBinding | undefined): string {
  return tab && tab.target.ai !== true ? tab.target.query : "";
}

export function useHistorySearchTabs(input: {
  tab: HistorySearchTabBinding | undefined;
  searchInput: string;
  serverId: string | null;
}): {
  aiSearch: HistoryAiSearchResult;
  initialAiQuestion: string | undefined;
  submitSearch: () => void;
} {
  const { tab, searchInput } = input;
  const initialAiQuestion = tab?.target.ai === true ? tab.target.query : undefined;
  const baseAiSearch = useHistoryAiSearch({
    serverId: input.serverId,
    initialQuestion: initialAiQuestion,
  });
  const openSearch = tab?.openSearch;
  const open = useCallback(
    (target: HistorySearchTabTarget): boolean => {
      if (!openSearch) return openHistorySearchTab(target);
      openSearch(target);
      return true;
    },
    [openSearch],
  );
  const submitSearch = useCallback(() => {
    const query = searchInput.trim();
    if (query) open({ kind: "history_search", query });
  }, [open, searchInput]);
  const baseAiSubmit = baseAiSearch.submit;
  const submitAiQuestion = useCallback(
    (question: string) => {
      // The tab already answers its own question. Without a workspace to hold a tab, History
      // answers in place.
      if (question === initialAiQuestion) {
        baseAiSubmit(question);
        return;
      }
      if (!open({ kind: "history_search", query: question, ai: true })) baseAiSubmit(question);
    },
    [baseAiSubmit, initialAiQuestion, open],
  );
  const aiSearch = useMemo(
    () => ({ ...baseAiSearch, submit: submitAiQuestion }),
    [baseAiSearch, submitAiQuestion],
  );
  return { aiSearch, initialAiQuestion, submitSearch };
}
