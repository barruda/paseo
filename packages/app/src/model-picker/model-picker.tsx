import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Check, CornerDownLeft, Folder, Star } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import type { AgentControlCommandCenterSource } from "@/command-center/agent-control-registration";
import { getCommandCenterIcon } from "@/command-center/icon";
import { useProviderIcons } from "@/components/provider-icons";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { focusWithRetries } from "@/utils/web-focus";
import {
  OverlayLayerProvider,
  useGlobalWebOverlayLayer,
  useWebOverlayRegistration,
} from "@/lib/overlay-root";
import {
  buildModelPickerRows,
  MODEL_PICKER_PROJECT_KEY,
  moveEffortId,
  moveHighlightedKey,
  planModelPickerApply,
  resolveEffortId,
  resolveHighlightAfterEffortChange,
  resolveModelEffort,
  resolveModelPickerHighlight,
  type ModelPickerEffort,
  type ModelPickerModel,
  type ModelPickerModelRow,
  type ModelPickerProjectRow,
  type ModelPickerRow,
  type ModelPickerSelection,
} from "./model";
import {
  buildProjectPickerItems,
  currentProjectLabel,
  planProjectPick,
  type ModelPickerProjectItem,
  type ModelPickerProjectOption,
  type ModelPickerProjectSource,
} from "./project";
import { useModelFavoritesStore } from "./favorites-store";
import { PENDING_EFFORT_TTL_MS, useModelPickerStore } from "./store";

const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
const ThemedCheck = withUnistyles(Check, (theme) => ({ color: theme.colors.foreground }));
const ThemedStar = withUnistyles(Star, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedFolder = withUnistyles(Folder, (theme) => ({ color: theme.colors.foregroundMuted }));
const ThemedEnter = withUnistyles(CornerDownLeft, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedFavoriteStar = withUnistyles(Star, (theme) => ({
  color: theme.colors.palette.yellow[400],
  fill: theme.colors.palette.yellow[400],
}));
const FAVORITE_SHORTCUT_LABEL = getShortcutOs() === "mac" ? "⌘D" : "Ctrl+D";

const SECTION_HEIGHT = 30;
const MODEL_HEIGHT = 36;
const KEYBOARD_SHOULD_PERSIST_TAPS = "always" as const;

// CUSTOM(model-picker-project): the project list (Enter on the Project row) reuses the same list.
type PickerRow = ModelPickerRow | ModelPickerProjectItem;
type PickerMode = "models" | "projects";

const MODE_TEXT: Record<PickerMode, { placeholder: string; empty: string }> = {
  models: { placeholder: "Search models from every provider…", empty: "No matching models" },
  projects: { placeholder: "Search projects…", empty: "No matching projects" },
};

function useProjectPickerList(
  project: ModelPickerProjectSource | null,
  mode: PickerMode,
  query: string,
) {
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const items = useMemo(
    () => (project && mode === "projects" ? buildProjectPickerItems(project, query) : []),
    [mode, project, query],
  );
  const resolvedKey = items.find((item) => item.key === highlightKey)?.key ?? items[0]?.key ?? null;
  return { items, resolvedKey, setHighlightKey };
}

function rowHeight(row: PickerRow): number {
  return row.kind === "section" ? SECTION_HEIGHT : MODEL_HEIGHT;
}

function getRowLayout(rows: readonly PickerRow[], index: number) {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += rowHeight(rows[i]);
  return { index, length: rowHeight(rows[index]), offset };
}

function toSelection(controls: AgentControlCommandCenterSource): ModelPickerSelection {
  return {
    providers: controls.models.providers,
    selectedProvider: controls.models.selectedProvider ?? null,
    selectedModelId: controls.models.selectedModelId ?? null,
    thinkingOptions: controls.thinking.options ?? [],
    selectedThinkingId: controls.thinking.selectedId ?? null,
  };
}

/** Ctrl+M in a composer: pick a model from any provider, and its effort, from the keyboard. */
export function ModelPicker() {
  const controls = useModelPickerStore((state) => state.controls);
  const sourceId = useModelPickerStore((state) => state.sourceId);
  const project = useModelPickerStore((state) => state.project);
  if (!controls || !sourceId) return null;
  return <ModelPickerPanel sourceId={sourceId} controls={controls} project={project} />;
}

function ModelPickerPanel({
  sourceId,
  controls,
  project,
}: {
  sourceId: string;
  controls: AgentControlCommandCenterSource;
  project: ModelPickerProjectSource | null;
}) {
  const close = useModelPickerStore((state) => state.close);
  const setPendingEffort = useModelPickerStore((state) => state.setPendingEffort);
  const modalLayer = useGlobalWebOverlayLayer("modal", isWeb);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const listRef = useRef<FlatList<PickerRow>>(null);
  const [query, setQueryState] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [chosenEffortId, setChosenEffortId] = useState<string | null>(null);
  const [mode, setMode] = useState<PickerMode>("models");

  const favoriteKeys = useModelFavoritesStore((state) => state.favoriteKeys);
  const toggleFavorite = useModelFavoritesStore((state) => state.toggle);
  const selection = useMemo(() => toSelection(controls), [controls]);
  const projectLabel = project ? currentProjectLabel(project) : null;
  const {
    rows: modelRows,
    items,
    projectRow,
  } = useMemo(
    () => buildModelPickerRows(selection, query, favoriteKeys, projectLabel),
    [favoriteKeys, projectLabel, query, selection],
  );
  const { resolvedKey, navigableItems, highlightedItem, currentItem, effortModel } = useMemo(
    () => resolveModelPickerHighlight({ highlightedKey, items, projectRow, query }),
    [highlightedKey, items, projectRow, query],
  );
  const highlighted = highlightedItem?.model ?? null;
  const effort = useMemo(
    () => resolveModelEffort(selection, effortModel),
    [effortModel, selection],
  );
  const effortId = resolveEffortId(effort, chosenEffortId);
  // CUSTOM(model-picker-project): picking an effort on the Project row targets the current model.
  const chooseEffort = useCallback(
    (id: string | null) => {
      setChosenEffortId(id);
      setHighlightedKey(resolveHighlightAfterEffortChange({ resolvedKey, currentItem }));
    },
    [currentItem, resolvedKey],
  );

  const projectList = useProjectPickerList(project, mode, query);
  const { items: projectItems, resolvedKey: resolvedProjectKey, setHighlightKey } = projectList;
  const rows: readonly PickerRow[] = mode === "projects" ? projectItems : modelRows;

  // Clearing the input on a mode switch may echo an empty change; it must not move the highlight.
  const queryRef = useRef("");
  const setQuery = useCallback(
    (next: string) => {
      if (next === queryRef.current) return;
      queryRef.current = next;
      setQueryState(next);
      setHighlightedKey(null);
      setHighlightKey(null);
    },
    [setHighlightKey],
  );

  const switchMode = useCallback(
    (next: PickerMode, nextHighlight: string | null) => {
      queryRef.current = "";
      inputRef.current?.reset();
      setQueryState("");
      setMode(next);
      setHighlightKey(null);
      setHighlightedKey(nextHighlight);
    },
    [setHighlightKey],
  );
  const openProjects = useCallback(() => switchMode("projects", null), [switchMode]);
  // Back to the models, on the current model so a second Enter applies the model and effort.
  const backToModels = useCallback(
    (highlight: string | null) => switchMode("models", highlight),
    [switchMode],
  );
  const pickProject = useCallback(
    (option: ModelPickerProjectOption) => {
      if (!project) return;
      const plan = planProjectPick(project, option.id);
      if (plan !== "none") project.select(option.id);
      if (plan === "select-and-close") {
        close();
        return;
      }
      backToModels(currentItem ? `current:${currentItem.model.key}` : null);
    },
    [backToModels, close, currentItem, project],
  );

  const apply = useCallback(
    (model: ModelPickerModel | null, nextEffortId: string | null) => {
      const plan = planModelPickerApply({ selection, model, effortId: nextEffortId });
      close();
      if (plan.kind === "effort") {
        void controls.thinking.select(plan.effortId);
        return;
      }
      if (plan.kind !== "model") return;
      setPendingEffort(
        plan.effortId
          ? {
              sourceId,
              provider: plan.provider,
              modelId: plan.modelId,
              effortId: plan.effortId,
              expiresAt: Date.now() + PENDING_EFFORT_TTL_MS,
            }
          : null,
      );
      void controls.models.select(plan.provider, plan.modelId);
    },
    [close, controls, selection, setPendingEffort, sourceId],
  );

  // Unfavoriting from the Favorites section removes the highlighted row, so the highlight moves to
  // the same model under its provider instead of jumping back to the top.
  const toggleItemFavorite = useCallback(
    (item: ModelPickerModelRow) => {
      toggleFavorite(item.model.key);
      if (item.model.favorite && item.key !== item.model.key) setHighlightedKey(item.model.key);
    },
    [toggleFavorite],
  );

  const projectKey = useCallback(
    (pressed: string, modifier: boolean): boolean => {
      if (modifier) return false;
      switch (pressed) {
        case "Escape":
          backToModels(MODEL_PICKER_PROJECT_KEY);
          return true;
        case "Enter": {
          const item = projectItems.find((entry) => entry.key === resolvedProjectKey);
          if (item) pickProject(item.option);
          return true;
        }
        case "ArrowDown":
        case "ArrowUp":
          setHighlightKey(
            moveHighlightedKey(resolvedProjectKey, projectItems, pressed === "ArrowDown" ? 1 : -1),
          );
          return true;
        default:
          return false;
      }
    },
    [backToModels, pickProject, projectItems, resolvedProjectKey, setHighlightKey],
  );

  const key = useCallback(
    (pressed: string, modifier = false): boolean => {
      if (mode === "projects") return projectKey(pressed, modifier);
      if (modifier) {
        if (pressed.toLowerCase() !== "d" || !highlightedItem) return false;
        toggleItemFavorite(highlightedItem);
        return true;
      }
      switch (pressed) {
        case "Escape":
          close();
          return true;
        case "Enter":
          if (resolvedKey === MODEL_PICKER_PROJECT_KEY) {
            openProjects();
            return true;
          }
          apply(highlighted, effortId);
          return true;
        case "ArrowDown":
        case "ArrowUp":
          setHighlightedKey(
            moveHighlightedKey(resolvedKey, navigableItems, pressed === "ArrowDown" ? 1 : -1),
          );
          return true;
        case "ArrowLeft":
        case "ArrowRight":
          if (effort.options.length < 2) return false;
          chooseEffort(moveEffortId(effort, effortId, pressed === "ArrowRight" ? 1 : -1));
          return true;
        default:
          return false;
      }
    },
    [
      apply,
      chooseEffort,
      close,
      effort,
      effortId,
      highlighted,
      highlightedItem,
      mode,
      navigableItems,
      openProjects,
      projectKey,
      resolvedKey,
      toggleItemFavorite,
    ],
  );

  const handleWebKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const modifier = getShortcutOs() === "mac" ? event.metaKey : event.ctrlKey;
      if (!key(event.key, modifier)) return false;
      event.preventDefault();
      return true;
    },
    [key],
  );
  const setWebOverlayScope = useWebOverlayRegistration({
    active: isWeb,
    layer: modalLayer,
    onKeyDown: handleWebKeyDown,
  });
  // Enter goes through onSubmitEditing, so it is skipped here to apply only once.
  const keyPress = useCallback(
    ({ nativeEvent }: { nativeEvent: { key: string } }) => {
      if (nativeEvent.key !== "Enter") key(nativeEvent.key);
    },
    [key],
  );
  const submit = useCallback(() => key("Enter"), [key]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  // The picker unmounts instead of deactivating its overlay, so the overlay doesn't hand focus
  // back. Return it to the message input that opened the picker.
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (isWeb && restoreFocusRef.current === null && document.activeElement instanceof HTMLElement) {
    restoreFocusRef.current = document.activeElement;
  }
  useEffect(
    () => () => {
      if (!isWeb) return;
      const element = restoreFocusRef.current;
      const focusMessageInput = () =>
        keyboardActionDispatcher.dispatch({ id: "message-input.focus", scope: "message-input" });
      if (!element) {
        focusMessageInput();
        return;
      }
      focusWithRetries({
        focus: () => element.focus(),
        isFocused: () => document.activeElement === element,
        deferInitialAttempt: true,
        onTimeout: focusMessageInput,
      });
    },
    [keyboardActionDispatcher],
  );

  // Scroll only as far as needed to show the highlighted row, like the command center.
  const scrollRef = useRef({ offset: 0, visibleLength: 0 });
  const activeKey = mode === "projects" ? resolvedProjectKey : resolvedKey;
  const highlightedIndex = rows.findIndex((row) => row.key === activeKey);
  const revealHighlighted = useCallback(() => {
    const { offset, visibleLength } = scrollRef.current;
    if (highlightedIndex < 0 || visibleLength <= 0) return;
    const { offset: top, length } = getRowLayout(rows, highlightedIndex);
    let next: number | null = null;
    if (top < offset) next = highlightedIndex <= 1 ? 0 : top;
    if (top + length > offset + visibleLength) next = top + length - visibleLength;
    if (next === null) return;
    scrollRef.current.offset = next;
    listRef.current?.scrollToOffset({ offset: next, animated: false });
  }, [highlightedIndex, rows]);
  useEffect(revealHighlighted, [revealHighlighted]);
  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      scrollRef.current.visibleLength = event.nativeEvent.layout.height;
      revealHighlighted();
    },
    [revealHighlighted],
  );
  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollRef.current.offset = event.nativeEvent.contentOffset.y;
  }, []);

  const selectModel = useCallback(
    (model: ModelPickerModel) =>
      apply(model, resolveEffortId(resolveModelEffort(selection, model), chosenEffortId)),
    [apply, chosenEffortId, selection],
  );
  const getProviderIcon = useProviderIcons(controls.serverId);
  const hasQuery = Boolean(query.trim());
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PickerRow>) => {
      if (item.kind === "project") {
        return (
          <ProjectRow item={item} highlighted={item.key === resolvedKey} onPress={openProjects} />
        );
      }
      if (item.kind === "project-option") {
        return (
          <ProjectOptionRow
            item={item}
            highlighted={item.key === resolvedProjectKey}
            onSelect={pickProject}
          />
        );
      }
      return item.kind === "section" ? (
        <Text style={styles.sectionLabel} numberOfLines={1}>
          {item.label}
        </Text>
      ) : (
        <ModelRow
          item={item}
          highlighted={item.key === resolvedKey}
          // Current, Favorites, and search results mix providers; provider sections don't.
          showProvider={hasQuery || item.key !== item.model.key}
          Icon={getCommandCenterIcon(getProviderIcon(item.model.provider))}
          onSelect={selectModel}
          onToggleFavorite={toggleItemFavorite}
        />
      );
    },
    [
      getProviderIcon,
      hasQuery,
      openProjects,
      pickProject,
      resolvedKey,
      resolvedProjectKey,
      selectModel,
      toggleItemFavorite,
    ],
  );
  const emptyList = useMemo(
    () => <Text style={styles.empty}>{MODE_TEXT[mode].empty}</Text>,
    [mode],
  );
  const getItemLayout = useCallback(
    (_data: ArrayLike<PickerRow> | null | undefined, index: number) => getRowLayout(rows, index),
    [rows],
  );

  return (
    <OverlayLayerProvider layer={isWeb ? modalLayer : 0}>
      <Modal visible transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={close} />
          <View ref={setWebOverlayScope} style={styles.panel} testID="model-picker">
            <View style={styles.header}>
              <ThemedTextInput
                testID="model-picker-input"
                ref={inputRef}
                initialValue=""
                onChangeText={setQuery}
                onKeyPress={keyPress}
                onSubmitEditing={submit}
                placeholder={MODE_TEXT[mode].placeholder}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            </View>
            <FlatList
              ref={listRef}
              data={rows}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              style={styles.list}
              keyboardShouldPersistTaps={KEYBOARD_SHOULD_PERSIST_TAPS}
              showsVerticalScrollIndicator={false}
              onLayout={handleListLayout}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              ListEmptyComponent={emptyList}
            />
            <PickerFooter
              mode={mode}
              effort={effort}
              effortId={effortId}
              onSelectEffort={chooseEffort}
            />
          </View>
        </View>
      </Modal>
    </OverlayLayerProvider>
  );
}

const ModelRow = memo(function ModelRow({
  item,
  highlighted,
  showProvider,
  Icon,
  onSelect,
  onToggleFavorite,
}: {
  item: ModelPickerModelRow;
  highlighted: boolean;
  showProvider: boolean;
  Icon: ReturnType<typeof getCommandCenterIcon>;
  onSelect(model: ModelPickerModel): void;
  onToggleFavorite(item: ModelPickerModelRow): void;
}) {
  const { model } = item;
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (highlighted || Boolean(hovered) || pressed) && styles.highlightedRow,
    ],
    [highlighted],
  );
  const press = useCallback(() => onSelect(model), [model, onSelect]);
  const toggle = useCallback(() => onToggleFavorite(item), [item, onToggleFavorite]);
  const renderContent = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
      <>
        <View style={styles.iconSlot}>
          <Icon size={16} />
        </View>
        <Text style={styles.modelLabel} numberOfLines={1}>
          {model.modelLabel}
        </Text>
        {showProvider ? (
          <Text style={styles.providerLabel} numberOfLines={1}>
            {model.providerLabel}
          </Text>
        ) : null}
        <View style={styles.checkSlot}>{model.current ? <ThemedCheck size={14} /> : null}</View>
        <Pressable
          focusable={false}
          onPress={toggle}
          hitSlop={6}
          style={styles.starSlot}
          accessibilityRole="button"
          accessibilityLabel={model.favorite ? "Remove from favorites" : "Add to favorites"}
          testID={`model-picker-favorite-${item.key}`}
        >
          {model.favorite ? <ThemedFavoriteStar size={14} /> : null}
          {!model.favorite && (highlighted || Boolean(hovered)) ? <ThemedStar size={14} /> : null}
        </Pressable>
      </>
    ),
    [Icon, highlighted, item.key, model, showProvider, toggle],
  );
  return (
    <Pressable
      style={style}
      focusable={false}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={`${model.providerLabel} ${model.modelLabel}`}
      testID={`model-picker-row-${item.key}`}
    >
      {renderContent}
    </Pressable>
  );
});

function PickerFooter({
  mode,
  effort,
  effortId,
  onSelectEffort,
}: {
  mode: PickerMode;
  effort: ModelPickerEffort;
  effortId: string | null;
  onSelectEffort(id: string): void;
}) {
  if (mode === "projects") {
    return (
      <Text style={[styles.hint, styles.projectHint]}>↑↓ project · Enter select · Esc back</Text>
    );
  }
  return (
    <>
      <EffortBar options={effort.options} selectedId={effortId} onSelect={onSelectEffort} />
      <Text style={styles.hint}>
        ↑↓ model · ←→ effort · Enter select · {FAVORITE_SHORTCUT_LABEL} favorite · Esc close
      </Text>
    </>
  );
}

function ProjectRow({
  item,
  highlighted,
  onPress,
}: {
  item: ModelPickerProjectRow;
  highlighted: boolean;
  onPress(): void;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (highlighted || Boolean(hovered) || pressed) && styles.highlightedRow,
    ],
    [highlighted],
  );
  return (
    <Pressable
      style={style}
      focusable={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Project ${item.label}`}
      testID="model-picker-project"
    >
      <View style={styles.iconSlot}>
        <ThemedFolder size={16} />
      </View>
      <Text style={styles.modelLabel} numberOfLines={1}>
        Project
      </Text>
      <Text style={styles.projectValue} numberOfLines={1}>
        {item.label}
      </Text>
      <View style={styles.checkSlot}>{highlighted ? <ThemedEnter size={14} /> : null}</View>
    </Pressable>
  );
}

const ProjectOptionRow = memo(function ProjectOptionRow({
  item,
  highlighted,
  onSelect,
}: {
  item: ModelPickerProjectItem;
  highlighted: boolean;
  onSelect(option: ModelPickerProjectOption): void;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (highlighted || Boolean(hovered) || pressed) && styles.highlightedRow,
    ],
    [highlighted],
  );
  const press = useCallback(() => onSelect(item.option), [item.option, onSelect]);
  return (
    <Pressable
      style={style}
      focusable={false}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={item.option.label}
      testID={`model-picker-project-option-${item.option.id}`}
    >
      <View style={styles.iconSlot}>
        <ThemedFolder size={16} />
      </View>
      <Text style={styles.modelLabel} numberOfLines={1}>
        {item.option.label}
      </Text>
      <View style={styles.checkSlot}>{item.current ? <ThemedCheck size={14} /> : null}</View>
    </Pressable>
  );
});

function EffortBar({
  options,
  selectedId,
  onSelect,
}: {
  options: ModelPickerSelection["thinkingOptions"];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <View style={styles.effortBar} testID="model-picker-effort">
      <Text style={styles.effortTitle}>Effort</Text>
      {options.length === 0 ? (
        <Text style={styles.effortNone}>This model has no effort levels</Text>
      ) : (
        <View style={styles.effortOptions}>
          {options.map((option) => (
            <EffortChip
              key={option.id}
              option={option}
              selected={option.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const EffortChip = memo(function EffortChip({
  option,
  selected,
  onSelect,
}: {
  option: ModelPickerSelection["thinkingOptions"][number];
  selected: boolean;
  onSelect(id: string): void;
}) {
  const press = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      focusable={false}
      onPress={press}
      style={[styles.effortChip, selected && styles.effortChipSelected]}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={`model-picker-effort-${option.id}`}
    >
      <Text style={[styles.effortChipLabel, selected && styles.effortChipLabelSelected]}>
        {formatThinkingOptionLabel(option)}
      </Text>
    </Pressable>
  );
});

function keyExtractor(row: PickerRow): string {
  return row.key;
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  panel: {
    width: 560,
    height: 520,
    maxWidth: "92%",
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.lg,
  },
  header: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  list: { flex: 1 },
  sectionLabel: {
    height: SECTION_HEIGHT,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  row: {
    height: MODEL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  highlightedRow: { backgroundColor: theme.colors.surface1 },
  iconSlot: { width: 16, alignItems: "center", justifyContent: "center" },
  modelLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  providerLabel: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  checkSlot: { width: 14, alignItems: "center" },
  projectValue: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  projectHint: { paddingTop: theme.spacing[2] },
  starSlot: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  empty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  effortBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  effortTitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  effortNone: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  effortOptions: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1.5] },
  effortChip: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  effortChipSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  effortChipLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  effortChipLabelSelected: { color: theme.colors.foreground, fontWeight: "500" },
  hint: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
