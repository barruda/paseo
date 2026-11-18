// CUSTOM(agent-profiles): the profile editor shared by the orchestrator form and the Projects
// Assistant's entry: agent pickers backed by the daemon's catalog, the skills chip, the system
// prompt and the memory switch. Content (prompt, skills) lives in the profile folder; the settings
// (provider, skills selection, memory) are saved by the caller.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useRpc,
  usePaseo,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  ScrollView,
  TextInput,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
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
import { profileStrings, type ProfileStrings } from "./profiles-strings";

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
  thinkingOptionId: string;
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
            s.freeMode,
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

  const modelList = models.data ?? [];
  const chosen = modelList.find((entry) => entry.id === model);
  const thinking = chosen?.thinkingOptions ?? [];
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
  return (
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
      {models.isError
        ? text(
            s.model,
            model,
            (next) => onChange({ ...value, provider: `${provider}/${next}` }),
            "",
          )
        : select(
            s.model,
            model,
            [
              ...(model ? [] : [none]),
              ...modelList
                .filter((entry) => entry.isSelectable !== false)
                .map((entry) => ({ value: entry.id, label: entry.label })),
            ],
            (next) => {
              const entry = modelList.find(
                (candidate) => candidate.id === next,
              );
              onChange({
                ...value,
                provider: `${provider}/${next}`,
                thinkingOptionId: entry?.thinkingOptions?.some(
                  (o) => o.id === value.thinkingOptionId,
                )
                  ? value.thinkingOptionId
                  : "",
              });
            },
          )}
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

/** Both halves, one after the other: the Projects Assistant tab uses this. */
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
    thinkingOptionId: chat.thinkingOptionId ?? "",
  },
  skills: chat.skills,
  memory: chat.memory,
  wakeOnNeedsYou: chat.wakeOnNeedsYou, // CUSTOM(assistant-wake)
});

/** The Projects Assistant's fixed entry: the same editor, without project or schedule fields. */
export function AssistantProfileTab({
  theme,
  disabled,
}: {
  theme: Theme;
  disabled: boolean;
}) {
  const s = profileStrings(usePaseoLanguage());
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
      thinkingOptionId: draft.agent.thinkingOptionId.trim() || null,
      skills: draft.skills,
      memory: draft.memory,
      wakeOnNeedsYou: draft.wakeOnNeedsYou,
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
      await callSet({ settings: { ...current.settings, chat: chat.data } });
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
});
