import { useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type NativeSyntheticEvent } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { AgentList } from "@/components/agent-list";
import type { HistoryAiSearchResult, HistoryAiSearchState } from "@/hooks/use-history-ai-search";

// CUSTOM(history-ai-search): the "Ask AI" field under History search and the line that says
// what the model searched for. English only, like the other custom surfaces.

const ThemedSparkles = withUnistyles(Sparkles);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedSpinner = withUnistyles(LoadingSpinner, mutedColorMapping);

/** Enter submits; editing the text after a search keeps the results until the next Enter. */
function HistoryAiSearchField({
  initialQuestion = "",
  onSubmit,
  onClear,
  isSearching,
}: {
  initialQuestion?: string;
  onSubmit: (question: string) => void;
  onClear: () => void;
  isSearching: boolean;
}): ReactElement {
  const [value, setValue] = useState(initialQuestion);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleSubmit = useCallback(
    (_event?: NativeSyntheticEvent<unknown>) => {
      const question = value.trim();
      if (question) onSubmit(question);
    },
    [onSubmit, value],
  );
  const handleClear = useCallback(() => {
    inputRef.current?.replaceText("");
    setValue("");
    onClear();
  }, [onClear]);

  return (
    <View style={styles.row}>
      <View style={[styles.field, isFocused && styles.fieldFocused]}>
        <ThemedSparkles size={14} uniProps={mutedColorMapping} />
        <ThemedTextInput
          testID="sessions-ai-search-input"
          ref={inputRef}
          initialValue={value}
          onChangeText={setValue}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSubmitEditing={handleSubmit}
          placeholder="Ask AI: which session had…"
          accessibilityLabel="Ask AI about your sessions"
          returnKeyType="search"
          style={styles.input}
        />
        {isSearching ? <ThemedSpinner size="small" /> : null}
        {value.length > 0 ? (
          <Pressable
            testID="sessions-ai-search-clear"
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear AI search"
            hitSlop={8}
          >
            <ThemedX size={14} uniProps={mutedColorMapping} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function formatDates(since: string | null, until: string | null): string | null {
  if (since && until) return since === until ? since : `${since} → ${until}`;
  if (since) return `since ${since}`;
  if (until) return `until ${until}`;
  return null;
}

function HistoryAiSearchStatus({
  state,
  onRetry,
}: {
  state: HistoryAiSearchState;
  onRetry: () => void;
}): ReactElement | null {
  if (state.status === "idle") return null;
  if (state.status === "searching") {
    return (
      <View style={styles.status}>
        <Text style={styles.statusText}>Searching with AI… this takes a few seconds.</Text>
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <View style={styles.status}>
        <Text style={styles.errorText}>AI search failed: {state.error}</Text>
        <Button variant="ghost" size="sm" onPress={onRetry}>
          Try again
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.status} testID="sessions-ai-search-status">
      {state.hosts.map((host) => {
        if (host.error) {
          return (
            <Text key={host.serverId} style={styles.errorText}>
              {state.hosts.length > 1 ? `${host.serverLabel}: ` : ""}AI search failed: {host.error}
            </Text>
          );
        }
        const dates = formatDates(host.since, host.until);
        const parts = [
          host.queries.length > 0 ? `Searched ${host.queries.join(" · ")}` : null,
          dates,
        ].filter((part): part is string => part !== null);
        return (
          <Text key={host.serverId} style={styles.statusText}>
            {state.hosts.length > 1 ? `${host.serverLabel}: ` : ""}
            {parts.join(" — ")}
          </Text>
        );
      })}
      {state.agents.length === 0 ? (
        <Text style={styles.statusText}>No session answers that question.</Text>
      ) : null}
    </View>
  );
}

/** The field, what was searched, and the picks best first. Renders nothing on older hosts. */
export function HistoryAiSearchPanel({
  aiSearch,
  initialQuestion,
  children,
}: {
  aiSearch: HistoryAiSearchResult;
  /** CUSTOM(history-search-tabs): the question an AI History search tab was opened with. */
  initialQuestion?: string;
  /** The regular History list, shown while no question is submitted. */
  children: ReactNode;
}): ReactElement {
  const { state, isActive } = aiSearch;
  return (
    <>
      {aiSearch.isSupported ? (
        <HistoryAiSearchField
          initialQuestion={initialQuestion}
          onSubmit={aiSearch.submit}
          onClear={aiSearch.clear}
          isSearching={state.status === "searching"}
        />
      ) : null}
      {isActive ? <HistoryAiSearchStatus state={state} onRetry={aiSearch.retry} /> : children}
      {isActive && state.status === "done" && state.agents.length > 0 ? (
        <AgentList
          agents={state.agents}
          showCheckoutInfo={false}
          showAttentionIndicator={false}
          showHostColumn
          orderBy="relevance"
        />
      ) : null}
    </>
  );
}

const SEARCH_FIELD_MAX_WIDTH = 640;

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[2],
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
    maxWidth: SEARCH_FIELD_MAX_WIDTH,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fieldFocused: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 20,
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  status: {
    alignItems: "flex-start",
    gap: theme.spacing[1],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[2],
  },
  statusText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.palette.red[300],
  },
}));
