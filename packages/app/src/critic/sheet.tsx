import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ImagePlus, X } from "lucide-react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { CriticImage, CriticMode, CriticTools } from "@getpaseo/protocol/critic";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { pickAndPersistImages } from "@/composer/actions";
import {
  deleteAttachments,
  encodeAttachmentsForSend,
  persistAttachmentFromBlob,
  persistAttachmentFromDataUrl,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import { openCriticForm, type CriticFormModel } from "./form-model";
import { loadCriticConfig, saveCriticConfig } from "./rpc";
import { useCriticStore } from "./store";

// CUSTOM(critic): the critic settings, opened from the composer icon. Mounted fresh per open; the
// form model owns every value (docs/forms.md), this file renders it and dispatches intent.

const MODE_OPTIONS: { value: CriticMode; label: string }[] = [
  { value: "per-request", label: "Per request" },
  { value: "persistent", label: "Persistent" },
];
const TOOLS_OPTIONS: { value: CriticTools; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read only" },
];
const ROUND_OPTIONS = ["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }));
const IMAGE_PERSISTER = {
  persistFromBlob: persistAttachmentFromBlob,
  persistFromDataUrl: persistAttachmentFromDataUrl,
  persistFromFileUri: persistAttachmentFromFileUri,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Model lifetime adapter: one model per mount, loaded once from the plugin. */
function useCriticFormModel(serverId: string, agentId: string, isDraft: boolean): CriticFormModel {
  const [form] = useState(openCriticForm);
  useEffect(() => {
    // CUSTOM(draft-composer-ready): a draft reopens what it saved; the first open loads the
    // plugin's defaults (the plugin has no entry under the draft's key).
    const draftSetup = isDraft ? useCriticStore.getState().drafts[agentId] : undefined;
    if (draftSetup) {
      form.applyLoaded(draftSetup.config);
      return () => form.close();
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      form.applyLoadError("Host is disconnected.");
      return () => form.close();
    }
    async function load(loadClient: NonNullable<typeof client>) {
      try {
        const config = await loadCriticConfig(loadClient, agentId);
        useCriticStore.getState().setModel(agentId, `${config.provider}/${config.model}`);
        form.applyLoaded(config);
      } catch (error) {
        form.applyLoadError(`Could not reach the critic plugin: ${errorMessage(error)}`);
      }
    }
    void load(client);
    return () => form.close();
  }, [agentId, form, isDraft, serverId]);
  return form;
}

export function CriticSettingsSheet({
  serverId,
  agentId,
  isDraft = false,
  onClose,
}: {
  serverId: string;
  /** The agent, or with `isDraft` the draft's key. */
  agentId: string;
  /** CUSTOM(draft-composer-ready): save to the draft; its create request applies it. */
  isDraft?: boolean;
  onClose: () => void;
}) {
  const form = useCriticFormModel(serverId, agentId, isDraft);
  const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
  const { draft } = state;
  const snapshot = useProvidersSnapshot(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const { pickImages } = useImageAttachmentPicker();
  const header = useMemo<SheetHeader>(() => ({ title: "Critic" }), []);

  const handleModelSelect = useCallback(
    (provider: AgentProvider, model: string) => form.setModel(provider, model),
    [form],
  );
  const handleSelectorOpen = useCallback(() => {
    snapshot.refetchIfStale(draft.provider);
  }, [draft.provider, snapshot]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => snapshot.refresh([provider]),
    [snapshot],
  );
  const handleMaxRounds = useCallback((value: string) => form.setMaxRounds(Number(value)), [form]);

  const handleAddImages = useCallback(async () => {
    const persisted = await pickAndPersistImages({ pickImages, persister: IMAGE_PERSISTER });
    if (persisted.length === 0) return;
    try {
      const encoded = (await encodeAttachmentsForSend(persisted)) ?? [];
      const images: CriticImage[] = encoded.map((image, index) => ({
        name: persisted[index]?.fileName ?? `image-${index + 1}`,
        mimeType: image.mimeType,
        data: image.data,
      }));
      form.addImages(images);
    } finally {
      await deleteAttachments(persisted);
    }
  }, [form, pickImages]);
  const handleAddImagesPress = useCallback(() => {
    void handleAddImages();
  }, [handleAddImages]);

  const handleSave = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      form.saveFailed("Host is disconnected.");
      return;
    }
    const current = form.getState();
    if (isDraft) {
      useCriticStore
        .getState()
        .setDraft(agentId, { config: current.draft, saveAsDefault: current.saveAsDefault });
      onClose();
      return;
    }
    form.beginSave();
    try {
      const { enabledChanged } = await saveCriticConfig({
        client,
        agentId,
        config: current.draft,
        saved: current.saved,
        saveAsDefault: current.saveAsDefault,
      });
      const store = useCriticStore.getState();
      store.setModel(agentId, `${current.draft.provider}/${current.draft.model}`);
      if (enabledChanged) store.toggleNotice(agentId, current.draft.enabled);
      form.saveSucceeded();
      onClose();
    } catch (error) {
      form.saveFailed(errorMessage(error));
    }
  }, [agentId, form, isDraft, onClose, serverId]);
  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="critic-settings">
      {state.load.status === "loading" ? (
        <View style={styles.loading}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
        </View>
      ) : null}
      {state.load.status === "error" ? (
        <Text style={styles.errorText}>{state.load.message}</Text>
      ) : null}
      {state.load.status === "ready" ? (
        <View style={styles.body}>
          <Text style={styles.intro}>
            A second model reads each answer before you do. Rejected answers go back to the agent
            with its review; you see the approved one.
          </Text>
          <Row title="Critic on">
            <Switch
              value={draft.enabled}
              onValueChange={form.setEnabled}
              accessibilityLabel="Critic on"
              testID="critic-enabled"
            />
          </Row>
          <Row title="Model">
            <CombinedModelSelector
              providers={providers}
              selectedProvider={draft.provider}
              selectedModel={draft.model}
              onSelect={handleModelSelect}
              isLoading={snapshot.isLoading || snapshot.isFetching}
              onOpen={handleSelectorOpen}
              onRetryProvider={handleRetryProvider}
              isRetryingProvider={snapshot.isRefreshing}
              disabled={state.saving}
              serverId={serverId}
              desktopPlacement="bottom-start"
              desktopMinWidth={320}
            />
          </Row>
          <View style={styles.field}>
            <Text style={styles.label}>Critic prompt</Text>
            <AdaptiveTextInput
              initialValue={draft.prompt}
              onChangeText={form.setPrompt}
              placeholder="What the critic checks: the bar the answer must meet, what to look for…"
              multiline
              editable={!state.saving}
              style={styles.promptInput}
              testID="critic-prompt"
            />
          </View>
          <View style={styles.field}>
            <View style={styles.fieldHeader}>
              <Text style={styles.label}>Reference images</Text>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={ImagePlus}
                onPress={handleAddImagesPress}
                disabled={state.saving}
                testID="critic-add-images"
              >
                Add
              </Button>
            </View>
            {draft.images.length > 0 ? (
              <View style={styles.thumbnails}>
                {draft.images.map((image, index) => (
                  <Thumbnail
                    key={`${image.name}:${image.data.length}:${image.data.slice(-24)}`}
                    image={image}
                    index={index}
                    onRemove={form.removeImage}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>Mockups or screenshots the critic compares against.</Text>
            )}
          </View>
          <Row title="Mode" hint="Per request: a new critic for each of your messages.">
            <SegmentedControl
              options={MODE_OPTIONS}
              value={draft.mode}
              onValueChange={form.setMode}
              size="sm"
              testID="critic-mode"
            />
          </Row>
          <Row title="Critic tools" hint="Read only lets it open and search the repository.">
            <SegmentedControl
              options={TOOLS_OPTIONS}
              value={draft.tools}
              onValueChange={form.setTools}
              size="sm"
              testID="critic-tools"
            />
          </Row>
          <Row title="Include workspace diff">
            <Switch
              value={draft.includeDiff}
              onValueChange={form.setIncludeDiff}
              accessibilityLabel="Include workspace diff"
              testID="critic-include-diff"
            />
          </Row>
          <Row title="Max rounds" hint="After the last round the answer reaches you as it is.">
            <SegmentedControl
              options={ROUND_OPTIONS}
              value={String(Math.min(draft.maxRounds, 5))}
              onValueChange={handleMaxRounds}
              size="sm"
              testID="critic-max-rounds"
            />
          </Row>
          <Row title="Save as default" hint="New agents start from these settings, critic off.">
            <Switch
              value={state.saveAsDefault}
              onValueChange={form.setSaveAsDefault}
              accessibilityLabel="Save as default"
              testID="critic-save-default"
            />
          </Row>
          {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
          <View style={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              onPress={onClose}
              disabled={state.saving}
              testID="critic-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              style={styles.actionButton}
              onPress={handleSavePress}
              disabled={!state.canSave}
              testID="critic-save"
            >
              {state.saving ? "Saving…" : "Save"}
            </Button>
          </View>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.label}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Thumbnail({
  image,
  index,
  onRemove,
}: {
  image: CriticImage;
  index: number;
  onRemove: (index: number) => void;
}) {
  const source = useMemo(
    () => ({ uri: `data:${image.mimeType};base64,${image.data}` }),
    [image.data, image.mimeType],
  );
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <View style={styles.thumbnail}>
      <Image source={source} style={styles.thumbnailImage} accessibilityLabel={image.name} />
      <ToolbarButton
        label={`Remove ${image.name}`}
        onPress={handleRemove}
        compact
        round
        style={styles.thumbnailRemove}
      >
        <X size={12} color={styles.thumbnailRemoveIcon.color} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  field: {
    gap: theme.spacing[2],
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  promptInput: {
    minHeight: 96,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    textAlignVertical: "top",
  },
  thumbnails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  thumbnail: {
    width: 64,
    height: 64,
  },
  thumbnailImage: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  thumbnailRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  thumbnailRemoveIcon: {
    color: theme.colors.foreground,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
