import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { HistorySearchSyntax } from "@/components/history-search-syntax";
// CUSTOM(history-subagents-toggle)
import { HistoryIncludeSubagents } from "@/components/history-include-subagents";
// CUSTOM(history-ai-search)
import { HistoryAiSearchPanel } from "@/components/history-ai-search";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import {
  type AgentHistoryHostError,
  type AgentHistoryView,
  useAgentHistory,
} from "@/hooks/use-agent-history";
// CUSTOM(history-archived-tab)
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useImportSession } from "@/hooks/use-import-session";
import { useHosts } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";
// CUSTOM(history-search-tabs)
import {
  initialHistorySearchInput,
  useHistorySearchTabs,
  type HistorySearchTabBinding,
} from "@/history-search-tabs/use-history-search-tabs";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

// CUSTOM(history-archived-tab): English only, like the other custom surfaces.
const HISTORY_VIEW_OPTIONS: SegmentedControlOption<AgentHistoryView>[] = [
  { value: "active", label: "Active", testID: "sessions-view-active" },
  { value: "archived", label: "Archived", testID: "sessions-view-archived" },
];
const ARCHIVED_UNSUPPORTED_TEXT = "Update this host to browse archived sessions.";
/** The selected sub-tab lasts for the app session only: module memory, never persisted. */
let rememberedHistoryView: AgentHistoryView = "active";

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

/** CUSTOM(history-search-tabs): a History search tab sits under the tab row, without a header. */
function SessionsHeader({ isTab, title }: { isTab: boolean; title: string }): ReactElement | null {
  return isTab ? null : <MenuHeader title={title} />;
}

export function SessionsScreenContent({ tab }: { tab?: HistorySearchTabBinding }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const importSession = useImportSession();
  const hosts = useHosts();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [searchInput, setSearchInput] = useState(() => initialHistorySearchInput(tab));
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const [view, setViewState] = useState<AgentHistoryView>(rememberedHistoryView);
  const setView = useCallback((next: AgentHistoryView) => {
    rememberedHistoryView = next;
    setViewState(next);
  }, []);
  // CUSTOM(history-subagents-toggle): delegated sub-agents are hidden unless asked for.
  const [includeSubagents, setIncludeSubagents] = useState(false);
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isArchivedUnavailable,
    isSearchTruncated,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
    view,
    includeSubagents,
  });
  const isSearching = isSearchSupported && search.length > 0;
  // CUSTOM(history-ai-search): a submitted question replaces the list with the AI's picks.
  // CUSTOM(history-search-tabs): and Enter in either field keeps the search as a tab.
  const { aiSearch, initialAiQuestion, submitSearch } = useHistorySearchTabs({
    tab,
    searchInput,
    serverId: historyServerId,
    includeSubagents,
  });

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // Searching filters the chronological history without changing its date buckets.
  const emptyText = resolveEmptyText({
    t,
    isSearching,
    isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
  });
  const showHostFilter = hosts.length > 1;
  const showFilterRow = showHostFilter || isSearchSupported;
  const showLoadError = isError && agents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // COMPAT(historyPagination): old daemons return a truncated relevance page.
    // Added in v0.8.0; remove after 2027-03-16 once the daemon floor supports search pagination.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  return (
    <View style={styles.container}>
      <SessionsHeader isTab={tab !== undefined} title={t("sessions.title")} />
      <View style={styles.viewRow}>
        <SegmentedControl
          options={HISTORY_VIEW_OPTIONS}
          value={view}
          onValueChange={setView}
          size="sm"
          testID="sessions-view"
        />
      </View>
      {showFilterRow ? (
        <View style={styles.filterContainer}>
          {isSearchSupported ? (
            <SearchField
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder={t("sessions.searchPlaceholder")}
              clearAccessibilityLabel={t("sessions.actions.clearSearch")}
              testID="sessions-search-input"
              clearTestID="sessions-search-clear"
              onSubmit={submitSearch}
            />
          ) : null}
          {showHostFilter ? (
            <HostFilter
              hosts={hosts}
              selectedHost={selectedHost}
              onSelectHost={setSelectedHost}
              triggerTestID="sessions-host-filter-trigger"
              hostOptionTestID={sessionsHostOptionTestID}
            />
          ) : null}
        </View>
      ) : null}
      {/* CUSTOM(history-subagents-toggle) */}
      <HistoryIncludeSubagents value={includeSubagents} onValueChange={setIncludeSubagents} />
      {/* CUSTOM(history-content-search): the query operators, under the search field. */}
      <HistorySearchSyntax isVisible={isSearchSupported} />
      <HistoryAiSearchPanel aiSearch={aiSearch} initialQuestion={initialAiQuestion}>
        {isArchivedUnavailable ? (
          <View style={styles.emptyContainer} testID="sessions-archived-unsupported">
            <Text style={styles.emptyText}>{ARCHIVED_UNSUPPORTED_TEXT}</Text>
          </View>
        ) : (
          <>
            <SessionHostErrorsBanner errors={hostErrors} t={t} />
            {isInitialLoad ? (
              <View style={styles.loadingContainer}>
                <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
              </View>
            ) : null}
            {!isInitialLoad && showLoadError ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>Unable to load sessions</Text>
                <Button variant="ghost" onPress={handleRefresh}>
                  Try again
                </Button>
              </View>
            ) : null}
            {!isInitialLoad && !showLoadError && agents.length === 0 ? (
              <View style={styles.emptyContainer} testID="sessions-empty">
                <Text style={styles.emptyText}>{emptyText}</Text>
                {isSearching ? (
                  <Button variant="ghost" onPress={handleClearSearch}>
                    {t("sessions.actions.clearSearch")}
                  </Button>
                ) : (
                  <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
                    Back
                  </Button>
                )}
                <Button variant="ghost" leftIcon={Import} onPress={importSession.open}>
                  {t("importSession.title")}
                </Button>
              </View>
            ) : null}
            {!isInitialLoad && !showLoadError && agents.length > 0 ? (
              <AgentList
                agents={agents}
                showCheckoutInfo={false}
                isRefreshing={isManualRefresh}
                onRefresh={handleRefresh}
                listFooterComponent={listFooterComponent}
                showAttentionIndicator={false}
                showHostColumn
                search={isSearching ? search : undefined}
              />
            ) : null}
          </>
        )}
      </HistoryAiSearchPanel>
      {importSession.sheet}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  viewRow: {
    alignItems: "flex-start",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  filterContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[2],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
