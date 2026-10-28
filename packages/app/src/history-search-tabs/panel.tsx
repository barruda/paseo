import { useCallback, useMemo } from "react";
import { History, Sparkles } from "lucide-react-native";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { SessionsScreenContent } from "@/screens/sessions-screen";
import type { HistorySearchTabBinding } from "./use-history-search-tabs";
import type { HistorySearchTabTarget } from "@/workspace-tabs/model";

// CUSTOM(history-search-tabs): the History list, filtered by the tab's search. English only,
// like the other custom surfaces.

function useHistorySearchPanelDescriptor(target: HistorySearchTabTarget): PanelDescriptor {
  const kind = target.ai === true ? "Ask AI" : "History search";
  return {
    label: target.query,
    subtitle: kind,
    tooltip: `${kind}: ${target.query}`,
    titleState: "ready",
    icon: target.ai === true ? Sparkles : History,
    statusBucket: null,
  };
}

function HistorySearchPanel() {
  const { target, openTab } = usePaneContext();
  invariant(target.kind === "history_search", "HistorySearchPanel requires history_search target");
  const openSearch = useCallback((next: HistorySearchTabTarget) => openTab(next), [openTab]);
  const binding = useMemo<HistorySearchTabBinding>(
    () => ({ target, openSearch }),
    [target, openSearch],
  );
  // Keyed so another tab's search never inherits this one's typed text.
  return (
    <SessionsScreenContent
      key={`${target.ai === true ? "ai" : "keywords"}:${target.query}`}
      tab={binding}
    />
  );
}

export const historySearchPanelRegistration = definePanel("history_search", {
  component: HistorySearchPanel,
  useDescriptor: useHistorySearchPanelDescriptor,
});
