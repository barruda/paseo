// CUSTOM(agent-profiles): the profile editor shared by the orchestrator form and the Projects
// Assistant's entry: agent pickers backed by the daemon's catalog, the skills chip, the system
// prompt and the memory switch. Content (prompt, skills) lives in the profile folder; the settings
// (provider, skills selection, memory) are saved by the caller.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type FlatList as NativeFlatList,
} from "react-native";
import {
  useRpc,
  usePaseo,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  FlatList,
  Icon,
  Modal,
  ScrollView,
  TextInput,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import {
  assistantChatSettingsSchema,
  type AssistantChatSettings,
} from "../shared/assistant";
import {
  assistantSettingsGetRpc,
  assistantSettingsSetRpc,
} from "../shared/assistant-rpc";
import {
  ASSISTANT_PROFILE,
  profilesGetRpc,
  profilesSetSystemPromptRpc,
  profilesSkillsRpc,
  type SkillItem,
  type SkillSelection,
} from "../shared/profiles";
import { usePaseoLanguage } from "./paseo-language";
import {
  fullAccessModeOf,
  isFeaturePermissionProvider,
} from "../shared/permission"; // CUSTOM(unattended-automation)
import { profileStrings, type ProfileStrings } from "./profiles-strings";
import { strings } from "./strings"; // CUSTOM(factory)
import {
  activeInternalProviders,
  filterModelCatalog,
  groupModelCatalog,
  internalProviderOf,
  modelsForInternalProvider,
  type CatalogModel,
  type ModelGroup,
} from "./model-catalog";

type Theme = PluginSurfaceProps["theme"];
const DEFAULT = "__default";

/** `provider/model` as the board stores it; the model may be empty while it is being picked. */
export function splitProvider(value: string): {
  provider: string;
  model: string;
} {
  const slash = value.indexOf("/");
  return slash === -1
    ? { provider: value, model: "" }
    : { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
export const isClaude = (value: string) =>
  splitProvider(value).provider === "claude";

function withCurrent(
  options: { value: string; label: string }[],
  current: string,
) {
  return !current || options.some((o) => o.value === current)
    ? options
    : [...options, { value: current, label: current }];
}

export interface AgentValue {
  provider: string;
  modeId: string;
  /** CUSTOM(unattended-automation): the permission of OpenCode-like providers. */
  autoAccept: boolean;
  thinkingOptionId: string;
}

type PickerRow =
  | { kind: "section"; key: string; title: string }
  | { kind: "model"; key: string; model: CatalogModel };

const SECTION_HEIGHT = 28;
const MODEL_HEIGHT = 52;

function pickerRows(groups: readonly ModelGroup[]): PickerRow[] {
  return groups.flatMap((group) => [
    ...(group.provider
      ? [
          {
            kind: "section" as const,
            key: `section:${group.provider.id}`,
            title: group.provider.label,
          },
        ]
      : []),
    ...group.models.map((model) => ({
      kind: "model" as const,
      key: `model:${model.id}`,
      model,
    })),
  ]);
}

function rowHeight(row: PickerRow): number {
  return row.kind === "section" ? SECTION_HEIGHT : MODEL_HEIGHT;
}

/** CUSTOM(model-picker-workboard): searchable model list; OpenCode rows show their provider. */
function ModelPickerModal({
  models,
  opencode,
  selectedId,
  onPick,
  onClose,
  theme,
  s,
}: {
  models: readonly CatalogModel[];
  opencode: boolean;
  selectedId: string;
  onPick(model: CatalogModel): void;
  onClose(): void;
  theme: Theme;
  s: ProfileStrings;
}) {
  const list = useRef<NativeFlatList<PickerRow>>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(selectedId);
  const groups = useMemo(
    () =>
      groupModelCatalog(filterModelCatalog(models, query, opencode), opencode),
    [models, opencode, query],
  );
  const rows = useMemo(() => pickerRows(groups), [groups]);
  const modelRows = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.kind === "model" ? [{ row, index }] : [],
      ),
    [rows],
  );
  const resolved =
    modelRows.find((entry) => entry.row.model.id === highlighted)?.row.model
      .id ??
    modelRows[0]?.row.model.id ??
    null;
  const choose = (model: CatalogModel) => {
    onPick(model);
    onClose();
  };
  const move = (delta: number) => {
    if (!modelRows.length) return;
    const at = modelRows.findIndex((entry) => entry.row.model.id === resolved);
    const next =
      at < 0 ? 0 : Math.max(0, Math.min(modelRows.length - 1, at + delta));
    const entry = modelRows[next];
    if (!entry) return;
    setHighlighted(entry.row.model.id);
    list.current?.scrollToIndex({ index: entry.index, viewPosition: 0.5 });
  };
  const onKey = (key: string) => {
    if (key === "ArrowDown") {
      move(1);
      return true;
    }
    if (key === "ArrowUp") {
      move(-1);
      return true;
    }
    if (key === "Enter") {
      const entry = modelRows.find(
        (candidate) => candidate.row.model.id === resolved,
      );
      if (entry) choose(entry.row.model);
      return true;
    }
    if (key === "Escape") {
      onClose();
      return true;
    }
    return false;
  };
  const search = (next: string) => {
    setQuery(next);
    setHighlighted(null);
  };
  const getItemLayout = (
    _data: ArrayLike<PickerRow> | null | undefined,
    index: number,
  ) => {
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += rowHeight(rows[i]!);
    return { index, length: rowHeight(rows[index]!), offset };
  };
  return (
    <Modal open title={s.model} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content scrollable={false} contentContainerStyle={styles.picker}>
        <TextInput
          autoFocus
          accessibilityLabel={s.searchModels}
          value={query}
          onChangeText={search}
          placeholder={s.searchModels}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
          onKeyPress={(event) => {
            if (onKey(event.nativeEvent.key)) event.preventDefault();
          }}
        />
        {!rows.length ? (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {s.noModels}
          </Text>
        ) : (
          <FlatList
            ref={list}
            data={rows}
            style={styles.pickerList}
            keyExtractor={(row) => row.key}
            keyboardShouldPersistTaps="handled"
            getItemLayout={getItemLayout}
            renderItem={({ item }) =>
              item.kind === "section" ? (
                <Text
                  style={[
                    styles.section,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {item.title}
                </Text>
              ) : (
                <ModelRow
                  model={item.model}
                  opencode={opencode}
                  selected={item.model.id === selectedId}
                  highlighted={item.model.id === resolved}
                  onPress={() => choose(item.model)}
                  theme={theme}
                />
              )
            }
          />
        )}
      </Modal.Content>
    </Modal>
  );
}

function ModelRow({
  model,
  opencode,
  selected,
  highlighted,
  onPress,
  theme,
}: {
  model: CatalogModel;
  opencode: boolean;
  selected: boolean;
  highlighted: boolean;
  onPress(): void;
  theme: Theme;
}) {
  const provider = internalProviderOf(model, opencode);
  const subtitle = opencode ? provider?.label : model.description;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        subtitle ? `${model.label}, ${subtitle}` : model.label
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.modelRow,
        highlighted && { backgroundColor: theme.colors.surface2 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.modelCheck}>
        {selected && (
          <Icon name="Check" size={16} color={theme.colors.accent} />
        )}
      </View>
      <View style={styles.modelText}>
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.foreground, fontWeight: "600" }}
        >
          {model.label}
        </Text>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={[styles.meta, { color: theme.colors.foregroundMuted }]}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** Provider, model, mode and thinking as selects of the daemon's catalog; free text when it fails. */
export function AgentFields({
  value,
  onChange,
  disabled,
  theme,
  s,
}: {
  value: AgentValue;
  onChange(next: AgentValue): void;
  disabled: boolean;
  theme: Theme;
  s: ProfileStrings;
}) {
  const { providers } = usePaseo();
  const { provider, model } = splitProvider(value.provider);
  const catalog = useQuery({
    queryKey: ["pwb-catalog"],
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const result = await providers.listAvailable();
      if (result.error) throw new Error(result.error);
      return result.providers.filter((entry) => entry.available);
    },
  });
  const models = useQuery({
    queryKey: ["pwb-catalog", provider, "models"],
    enabled: catalog.isSuccess && !!provider,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const result = await providers.listModels(provider);
      if (result.error) throw new Error(result.error);
      return result.models ?? [];
    },
  });
  const modes = useQuery({
    queryKey: ["pwb-catalog", provider, "modes"],
    enabled: catalog.isSuccess && !!provider,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const result = await providers.listModes(provider);
      if (result.error) throw new Error(result.error);
      return result.modes ?? [];
    },
  });
  const field = (label: string, child: ReactNode) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {label}
      </Text>
      {child}
    </View>
  );
  const text = (
    label: string,
    text: string,
    onText: (text: string) => void,
    placeholder: string,
  ) =>
    field(
      label,
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={text}
        onChangeText={onText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[
          styles.input,
          { color: theme.colors.foreground, borderColor: theme.colors.border },
        ]}
      />,
    );
  const modelList = models.data ?? [];
  const chosen = modelList.find((entry) => entry.id === model);
  const thinking = chosen?.thinkingOptions ?? [];
  const opencode = provider === "opencode";
  const internalProviders = useMemo(
    () => activeInternalProviders(modelList, opencode),
    [modelList, opencode],
  );
  const currentInternal = internalProviderOf({ id: model }, opencode);
  const selectedInternal = currentInternal ?? internalProviders[0] ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const modelChoices = opencode
    ? modelsForInternalProvider(
        modelList,
        selectedInternal?.id ?? "",
        true,
      ).filter((entry) => entry.isSelectable !== false)
    : modelList.filter((entry) => entry.isSelectable !== false);
  const modelLabel = chosen?.label ?? (model || s.providerDefault);
  const modelInternalLabel = opencode ? (currentInternal?.label ?? null) : null;
  const modelButtonLabel =
    modelInternalLabel && modelInternalLabel !== modelLabel
      ? `${modelLabel} · ${modelInternalLabel}`
      : modelLabel;
  const chooseInternal = (nextId: string) => {
    if (!nextId || nextId === selectedInternal?.id) return;
    const list = modelsForInternalProvider(modelList, nextId, true).filter(
      (entry) => entry.isSelectable !== false,
    );
    const next = list.find((entry) => entry.isDefault) ?? list[0];
    if (!next) return;
    onChange({
      ...value,
      provider: `${provider}/${next.id}`,
      thinkingOptionId: next.thinkingOptions?.some(
        (option) => option.id === value.thinkingOptionId,
      )
        ? value.thinkingOptionId
        : "",
    });
  };
  const chooseModel = (next: CatalogModel) => {
    onChange({
      ...value,
      provider: `${provider}/${next.id}`,
      thinkingOptionId: next.thinkingOptions?.some(
        (option) => option.id === value.thinkingOptionId,
      )
        ? value.thinkingOptionId
        : "",
    });
  };
  if (catalog.isError)
    return (
      <View style={styles.stack}>
        <View style={styles.inline}>
          {text(
            s.freeProvider,
            value.provider,
            (provider) => onChange({ ...value, provider }),
            "claude/claude-opus-5-5",
          )}
          {text(
            s.permissions,
            value.modeId,
            (modeId) => onChange({ ...value, modeId }),
            "bypassPermissions",
          )}
          {text(
            s.freeThinking,
            value.thinkingOptionId,
            (thinkingOptionId) => onChange({ ...value, thinkingOptionId }),
            "medium",
          )}
        </View>
        <Text style={[styles.meta, { color: theme.colors.statusWarning }]}>
          {s.catalogFailed}
        </Text>
      </View>
    );
  if (!catalog.isSuccess)
    return (
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {s.catalogLoading}
      </Text>
    );

  const pick = async (nextProvider: string) => {
    if (nextProvider === provider) return;
    // The new provider's own default model; mode and thinking stay only when it has them too.
    let nextModels: typeof modelList = [];
    let nextModes: { id: string }[] = [];
    try {
      nextModels = (await providers.listModels(nextProvider)).models ?? [];
      nextModes = (await providers.listModes(nextProvider)).modes ?? [];
    } catch {
      // Left empty: the provider default is used.
    }
    const nextModel =
      nextModels.find(
        (entry) => entry.isDefault && entry.isSelectable !== false,
      ) ?? nextModels.find((entry) => entry.isSelectable !== false);
    onChange({
      provider: `${nextProvider}/${nextModel?.id ?? ""}`,
      modeId: nextModes.some((mode) => mode.id === value.modeId)
        ? value.modeId
        : "",
      autoAccept: value.autoAccept,
      thinkingOptionId: nextModel?.thinkingOptions?.some(
        (o) => o.id === value.thinkingOptionId,
      )
        ? value.thinkingOptionId
        : "",
    });
  };
  const select = (
    label: string,
    current: string,
    options: { value: string; label: string }[],
    onPick: (value: string) => void,
  ) => (
    <SettingsSelect<string>
      label={label}
      value={current || DEFAULT}
      options={withCurrent(options, current).map((o) => o)}
      onValueChange={(next) => onPick(next === DEFAULT ? "" : next)}
      disabled={disabled}
    />
  );
  const none = { value: DEFAULT, label: s.providerDefault };
  // CUSTOM(unattended-automation): same rule as the server; empty mode is full access.
  const featureProvider = isFeaturePermissionProvider(provider);
  const permissionModes = modes.data ?? [];
  const fullMode = fullAccessModeOf(permissionModes);
  return (
    <>
      <SettingsCard>
        {select(
          s.provider,
          provider,
          (catalog.data ?? []).map((entry) => ({
            value: entry.provider,
            label: entry.provider,
          })),
          (next) => void pick(next),
        )}
        {models.isError ? (
          text(
            s.model,
            model,
            (next) => onChange({ ...value, provider: `${provider}/${next}` }),
            "",
          )
        ) : (
          <>
            {opencode && (
              <SettingsSelect<string>
                label={s.opencodeProvider}
                value={selectedInternal?.id ?? DEFAULT}
                options={
                  internalProviders.length || selectedInternal
                    ? withCurrent(
                        internalProviders.map((entry) => ({
                          value: entry.id,
                          label: entry.label,
                        })),
                        selectedInternal?.id ?? "",
                      )
                    : [{ value: DEFAULT, label: s.providerDefault }]
                }
                onValueChange={(next) =>
                  chooseInternal(next === DEFAULT ? "" : next)
                }
                disabled={disabled || !internalProviders.length}
              />
            )}
            <SettingsRow label={s.model}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s.model}: ${modelButtonLabel}`}
                disabled={disabled || !modelChoices.length}
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => [
                  styles.modelButton,
                  {
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface1,
                    opacity:
                      disabled || !modelChoices.length
                        ? 0.5
                        : pressed
                          ? 0.8
                          : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.modelButtonText,
                    { color: theme.colors.foreground },
                  ]}
                >
                  {modelButtonLabel}
                </Text>
                <Icon
                  name="ChevronDown"
                  size={16}
                  color={theme.colors.foregroundMuted}
                />
              </Pressable>
            </SettingsRow>
            {pickerOpen && (
              <ModelPickerModal
                models={modelChoices}
                opencode={opencode}
                selectedId={model}
                onPick={chooseModel}
                onClose={() => setPickerOpen(false)}
                theme={theme}
                s={s}
              />
            )}
          </>
        )}
        {featureProvider ? (
          <>
            {select(
              s.mode,
              value.modeId,
              [
                none,
                ...(modes.data ?? []).map((mode) => ({
                  value: mode.id,
                  label: mode.label,
                })),
              ],
              (modeId) => onChange({ ...value, modeId }),
            )}
            <SettingsSelect<string>
              label={s.permissions}
              value={value.autoAccept ? "full" : "ask"}
              options={[
                { value: "full", label: s.permissionFull },
                { value: "ask", label: s.permissionAsk },
              ]}
              onValueChange={(next) =>
                onChange({ ...value, autoAccept: next === "full" })
              }
              disabled={disabled}
            />
          </>
        ) : modes.isError ? (
          text(
            s.permissions,
            value.modeId,
            (modeId) => onChange({ ...value, modeId }),
            "bypassPermissions",
          )
        ) : (
          <SettingsSelect<string>
            label={s.permissions}
            value={value.modeId || fullMode?.id || DEFAULT}
            options={withCurrent(
              permissionModes.map((mode) => ({
                value: mode.id,
                label:
                  mode.id === fullMode?.id
                    ? `${mode.label} ${s.permissionDefault}`
                    : mode.label,
              })),
              value.modeId,
            )}
            onValueChange={(modeId) => onChange({ ...value, modeId })}
            disabled={disabled}
          />
        )}
        {select(
          s.thinking,
          value.thinkingOptionId,
          [
            none,
            ...thinking.map((option) => ({
              value: option.id,
              label: option.label,
            })),
          ],
          (thinkingOptionId) => onChange({ ...value, thinkingOptionId }),
        )}
      </SettingsCard>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {s.permissionsHint}
      </Text>
    </>
  );
}

/** "Skills · All" or "Skills · N": opens the picker, like the composer's Skills/MCPs pill. */
export function SkillsChip({
  profile,
  value,
  ownCount,
  onChange,
  disabled,
  theme,
  s,
}: {
  profile: string;
  value: SkillSelection;
  ownCount: number;
  onChange(next: SkillSelection): void;
  disabled: boolean;
  theme: Theme;
  s: ProfileStrings;
}) {
  const [open, setOpen] = useState(false);
  const label = `${s.skills} · ${value.mode === "all" ? s.skillsAll : value.names.length + ownCount}`;
  return (
    <View style={styles.stack}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          styles.pill,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
          },
          disabled && styles.disabled,
        ]}
      >
        <Icon name="Sparkles" size={14} color={theme.colors.foreground} />
        <Text style={{ color: theme.colors.foreground }}>{label}</Text>
      </Pressable>
      {open && (
        <SkillsPicker
          profile={profile}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          theme={theme}
          s={s}
        />
      )}
    </View>
  );
}

function SkillsPicker({
  profile,
  value,
  onChange,
  onClose,
  theme,
  s,
}: {
  profile: string;
  value: SkillSelection;
  onChange(next: SkillSelection): void;
  onClose(): void;
  theme: Theme;
  s: ProfileStrings;
}) {
  const callSkills = useRpc(profilesSkillsRpc);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["pwb-profile-skills", profile],
    gcTime: 0,
    queryFn: () => callSkills({ profile }),
  });
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = (query.data?.skills ?? []).filter(
      (skill) =>
        !needle ||
        `${skill.name} ${skill.description}`.toLowerCase().includes(needle),
    );
    return (
      [
        ["profile", s.groupProfile],
        ["personal", s.groupPersonal],
        ["plugins", s.groupPlugins],
      ] as const
    )
      .map(([group, title]) => ({
        title,
        items: all.filter((skill) => skill.group === group),
      }))
      .filter((group) => group.items.length);
  }, [query.data, search, s]);
  const all = value.mode === "all";
  const toggle = (skill: SkillItem) =>
    onChange({
      mode: "selected",
      names: value.names.includes(skill.name)
        ? value.names.filter((name) => name !== skill.name)
        : [...value.names, skill.name],
    });
  return (
    <Modal open title={s.skills} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <SettingsCard>
          <SettingsSwitch
            label={s.allSkills}
            hint={s.allSkillsHint}
            value={all}
            onValueChange={(next) =>
              onChange({ ...value, mode: next ? "all" : "selected" })
            }
          />
        </SettingsCard>
        <TextInput
          accessibilityLabel={s.searchSkills}
          value={search}
          onChangeText={setSearch}
          placeholder={s.searchSkills}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              color: theme.colors.foreground,
              borderColor: theme.colors.border,
            },
          ]}
        />
        {query.isError && (
          <Text style={[styles.meta, { color: theme.colors.statusDanger }]}>
            {s.skillsLoadFailed}
          </Text>
        )}
        {query.isSuccess && !groups.length && (
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {s.noSkills}
          </Text>
        )}
        {groups.map((group) => (
          <View key={group.title} style={styles.stack}>
            <Text
              style={[styles.label, { color: theme.colors.foregroundMuted }]}
            >
              {group.title}
            </Text>
            {group.items.map((skill) => {
              const own = skill.group === "profile";
              const checked = all || own || value.names.includes(skill.name);
              return (
                <Pressable
                  key={`${skill.group}:${skill.name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: all || own }}
                  disabled={all || own}
                  onPress={() => toggle(skill)}
                  style={[styles.skillRow, (all || own) && styles.disabled]}
                >
                  <Icon
                    name={checked ? "SquareCheck" : "Square"}
                    size={16}
                    color={
                      checked
                        ? theme.colors.accent
                        : theme.colors.foregroundMuted
                    }
                  />
                  <View style={styles.skillText}>
                    <Text
                      style={{
                        color: theme.colors.foreground,
                        fontWeight: "600",
                      }}
                    >
                      {skill.name}
                      {own ? ` · ${s.fromProfile}` : ""}
                    </Text>
                    {!!skill.description && (
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.meta,
                          { color: theme.colors.foregroundMuted },
                        ]}
                      >
                        {skill.description}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Modal.Content>
    </Modal>
  );
}

function CopyPath({
  label,
  path,
  theme,
  s,
}: {
  label: string;
  path: string;
  theme: Theme;
  s: ProfileStrings;
}) {
  const toast = useToast();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {label}
      </Text>
      <View style={styles.inline}>
        <Text
          selectable
          style={[
            styles.meta,
            styles.path,
            { color: theme.colors.foregroundMuted },
          ]}
        >
          {path}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${s.copy}: ${label}`}
          onPress={() =>
            void copyText(path).then(
              () => toast.show(s.copied, { variant: "success" }),
              () => toast.show(s.copyFailed, { variant: "warning" }),
            )
          }
          style={[styles.pill, { borderColor: theme.colors.border }]}
        >
          <Icon name="Copy" size={14} color={theme.colors.foreground} />
          <Text style={{ color: theme.colors.foreground }}>{s.copy}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The profile's saved content, with the system prompt as an editable draft. */
export function useProfileContent(profile: string) {
  const callGet = useRpc(profilesGetRpc);
  const callSet = useRpc(profilesSetSystemPromptRpc);
  const query = useQuery({
    queryKey: ["pwb-profile", profile],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => callGet({ profile }),
  });
  const [prompt, setPrompt] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (query.data && !touched) setPrompt(query.data.systemPrompt);
  }, [query.data, touched]);
  return {
    view: query.data,
    failed: query.isError,
    prompt,
    edit(text: string) {
      setTouched(true);
      setPrompt(text);
    },
    /** Writes the prompt when it changed. */
    async save() {
      if (!touched || prompt === null) return;
      await callSet({ profile, text: prompt });
      setTouched(false);
      await query.refetch();
    },
    touched,
  };
}

/** Skills chip, system prompt, memory and the folder paths. */
type ProfileFieldsProps = {
  profile: string;
  content: ReturnType<typeof useProfileContent>;
  skills: SkillSelection;
  memory: boolean;
  provider: string;
  onSkills(next: SkillSelection): void;
  onMemory(next: boolean): void;
  disabled: boolean;
  theme: Theme;
  s: ProfileStrings;
};

/** Both halves, one after the other: the Project Manager tab uses this. */
export function ProfileFields(props: ProfileFieldsProps) {
  return (
    <View style={styles.stack}>
      <ProfileSkillsMemory
        {...props}
        afterSkills={<ProfilePromptField {...props} />}
      />
    </View>
  );
}

/** Skills, memory and the profile folder. */
export function ProfileSkillsMemory({
  profile,
  content,
  skills,
  memory,
  provider,
  onSkills,
  onMemory,
  disabled,
  theme,
  s,
  afterSkills,
}: ProfileFieldsProps & { afterSkills?: ReactNode }) {
  const view = content.view;
  return (
    <View style={styles.stack}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foreground }]}>
          {s.skills}
        </Text>
        <SkillsChip
          profile={profile}
          value={skills}
          ownCount={view?.ownSkills.length ?? 0}
          onChange={onSkills}
          disabled={disabled}
          theme={theme}
          s={s}
        />
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {s.skillsHint}
        </Text>
        {!isClaude(provider) && (
          <Text style={[styles.meta, { color: theme.colors.statusWarning }]}>
            {s.nonClaude}
          </Text>
        )}
      </View>
      {afterSkills}
      <SettingsCard>
        <SettingsSwitch
          label={s.memory}
          hint={s.memoryHint}
          value={memory}
          onValueChange={onMemory}
          disabled={disabled}
        />
      </SettingsCard>
      {view && memory && (
        <CopyPath
          label={s.memoryFolder}
          path={`${view.directory}/memory`}
          theme={theme}
          s={s}
        />
      )}
      {view && (
        <View style={styles.stack}>
          <CopyPath
            label={s.profileFolder}
            path={view.directory}
            theme={theme}
            s={s}
          />
          <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
            {s.profileFolderHint}
          </Text>
        </View>
      )}
    </View>
  );
}

/** The system prompt textarea. */
export function ProfilePromptField({
  content,
  disabled,
  theme,
  s,
}: Pick<ProfileFieldsProps, "content" | "disabled" | "theme" | "s">) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>
        {s.systemPrompt}
      </Text>
      <TextInput
        accessibilityLabel={s.systemPrompt}
        editable={!disabled && content.prompt !== null}
        multiline
        value={content.prompt ?? (content.failed ? "" : s.promptLoading)}
        onChangeText={content.edit}
        placeholder={s.systemPromptPlaceholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[
          styles.input,
          styles.textarea,
          {
            color: theme.colors.foreground,
            borderColor: theme.colors.border,
          },
        ]}
      />
      <Text
        style={[
          styles.meta,
          {
            color: content.failed
              ? theme.colors.statusDanger
              : theme.colors.foregroundMuted,
          },
        ]}
      >
        {content.failed ? s.promptLoadFailed : s.systemPromptHint}
      </Text>
    </View>
  );
}

const draftOf = (chat: AssistantChatSettings) => ({
  agent: {
    provider: chat.provider,
    modeId: chat.modeId ?? "",
    autoAccept: chat.autoAccept,
    thinkingOptionId: chat.thinkingOptionId ?? "",
  },
  skills: chat.skills,
  memory: chat.memory,
  wakeOnNeedsYou: chat.wakeOnNeedsYou, // CUSTOM(assistant-wake)
  wakeDelaySeconds: chat.wakeDelaySeconds, // CUSTOM(assistant-wake)
});

/** The Project Manager's fixed entry: the same editor, without project or schedule fields. */
export function AssistantProfileTab({
  theme,
  disabled,
  factoryOwned = false,
}: {
  theme: Theme;
  disabled: boolean;
  /** CUSTOM(factory): active mode; the chat settings and the prompt are saved to the factory. */
  factoryOwned?: boolean;
}) {
  const s = profileStrings(usePaseoLanguage());
  const factoryText = strings(usePaseoLanguage()).factory.writes;
  const callGet = useRpc(assistantSettingsGetRpc);
  const callSet = useRpc(assistantSettingsSetRpc);
  const toast = useToast();
  const settings = useQuery({
    queryKey: ["pwb-assistant-settings"],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => callGet({}),
  });
  const content = useProfileContent(ASSISTANT_PROFILE);
  const [draft, setDraft] = useState<ReturnType<typeof draftOf> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !draft) setDraft(draftOf(settings.data.settings.chat));
  }, [settings.data, draft]);
  const [dirty, setDirty] = useState(false);
  // CUSTOM(factory): entering or leaving active mode changes where the chat settings come from;
  // read them again so a save never sends the other side's values.
  const ownedSeen = useRef(factoryOwned);
  const refetchSettings = settings.refetch;
  useEffect(() => {
    if (ownedSeen.current === factoryOwned) return;
    ownedSeen.current = factoryOwned;
    setDraft(null);
    setDirty(false);
    void refetchSettings().then((result) => {
      if (result.data) setDraft(draftOf(result.data.settings.chat));
    });
  }, [factoryOwned, refetchSettings]);
  if (settings.isError)
    return (
      <Text style={[styles.empty, { color: theme.colors.statusDanger }]}>
        {s.assistantLoadFailed}
      </Text>
    );
  if (!draft)
    return (
      <Text style={[styles.empty, { color: theme.colors.foregroundMuted }]}>
        {s.catalogLoading}
      </Text>
    );
  const change = (next: Partial<typeof draft>) => {
    setDirty(true);
    setDraft({ ...draft, ...next });
  };
  const save = async () => {
    const chat = assistantChatSettingsSchema.safeParse({
      provider: draft.agent.provider,
      modeId: draft.agent.modeId.trim() || null,
      autoAccept: draft.agent.autoAccept,
      thinkingOptionId: draft.agent.thinkingOptionId.trim() || null,
      skills: draft.skills,
      memory: draft.memory,
      wakeOnNeedsYou: draft.wakeOnNeedsYou,
      wakeDelaySeconds: draft.wakeDelaySeconds,
    });
    if (!chat.success) {
      setError(
        chat.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(" · "),
      );
      return;
    }
    setError(null);
    try {
      // Read again so a policy saved meanwhile in Settings is not overwritten.
      const current = await callGet({});
      // CUSTOM(assistant-compact): the compaction limit is edited in Settings; keep the saved one.
      await callSet({
        settings: {
          ...current.settings,
          chat: {
            ...chat.data,
            compactAtTokens: current.settings.chat.compactAtTokens,
          },
        },
      });
      await content.save();
      setDirty(false);
      toast.show(s.done, { variant: "success" });
    } catch (failure) {
      setError(
        `${s.saveFailed}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.foreground }]}>
          {s.assistantName}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={disabled || !(dirty || content.touched)}
          onPress={() => void save()}
          style={[
            styles.save,
            {
              backgroundColor: theme.colors.accent,
              opacity: disabled || !(dirty || content.touched) ? 0.5 : 1,
            },
          ]}
        >
          <Text style={{ color: theme.colors.accentForeground }}>{s.save}</Text>
        </Pressable>
      </View>
      <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
        {s.assistantHint}
      </Text>
      {factoryOwned && (
        <Text style={[styles.meta, { color: theme.colors.foregroundMuted }]}>
          {factoryText}
        </Text>
      )}
      {error && (
        <Text style={[styles.meta, { color: theme.colors.statusDanger }]}>
          {error}
        </Text>
      )}
      <View style={styles.column}>
        <SettingsCard>
          <SettingsSwitch
            label={s.wake}
            hint={s.wakeHint}
            value={draft.wakeOnNeedsYou}
            onValueChange={(wakeOnNeedsYou) => change({ wakeOnNeedsYou })}
            disabled={disabled}
          />
        </SettingsCard>
        <AgentFields
          value={draft.agent}
          onChange={(agent) => change({ agent })}
          disabled={disabled}
          theme={theme}
          s={s}
        />
        <ProfileFields
          profile={ASSISTANT_PROFILE}
          content={content}
          skills={draft.skills}
          memory={draft.memory}
          provider={draft.agent.provider}
          onSkills={(skills) => change({ skills })}
          onMemory={(memory) => change({ memory })}
          disabled={disabled}
          theme={theme}
          s={s}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 800 },
  column: { gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 18, fontWeight: "600" },
  meta: { fontSize: 12, lineHeight: 16 },
  empty: { padding: 24, textAlign: "center" },
  save: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stack: { gap: 6 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  field: { gap: 6, flexGrow: 1 },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    minHeight: 36,
    minWidth: 120,
    flexGrow: 1,
  },
  textarea: { minHeight: 160, textAlignVertical: "top" },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  disabled: { opacity: 0.5 },
  skillRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  skillText: { flex: 1, gap: 2 },
  path: { flexShrink: 1 },
  picker: { gap: 8, flex: 1, minHeight: 0 },
  pickerList: { flex: 1, minHeight: 0 },
  section: {
    height: SECTION_HEIGHT,
    paddingTop: 8,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  modelRow: {
    height: MODEL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  modelCheck: { width: 16, alignItems: "center" },
  modelText: { flex: 1, gap: 2 },
  modelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    minHeight: 36,
    minWidth: 120,
    maxWidth: 420,
  },
  modelButtonText: { flexShrink: 1 },
});
