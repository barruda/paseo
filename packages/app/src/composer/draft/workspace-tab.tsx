import { isFocusedComposerCaretAtEnd } from "@/jev-router/cycle"; // CUSTOM(jev-router)
import { isComposerKeyboardTarget } from "@/composer/focused-composer"; // CUSTOM(model-picker-focus)
import { useModelFavoritesStore } from "@/model-picker/favorites-store";
import { getEffortFavorites } from "@/composer/effort-favorites-store";
import { useProjectFavoritesStore } from "@/composer/project-favorites-store";
import {
  nextProjectId,
  previousProjectId,
  projectCycleIds,
  nextEffortId,
  previousModelSelection,
  resolveDraftModelId,
} from "@/composer/empty-shortcuts";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { Keyboard, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import type { ComposerOptionControls } from "@/agent-controls/option-controls";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { CHAT_COLUMN_RAIL_DATASET } from "@/chat-rail";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import invariant from "tiny-invariant";
import { Composer } from "@/composer";
import { type ComposerEditingSession, useComposerFullscreen } from "@/composer/editing-session";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import { COMPOSER_PILL_CLEARANCE } from "@/composer/pill-styles";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { useDraftAgentCreateFlow, type DraftCreateAttempt } from "@/composer/draft/create-flow";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { Agent } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { encodeImages } from "@/utils/encode-images";
import { shouldAutoFocusWorkspaceDraftComposer } from "@/screens/workspace/workspace-draft-pane-focus";
import {
  resolveDraftWorkingDirectory,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "@/composer/draft/workspace-tab-core";
import { DRAFT_CAPABILITIES } from "@/composer/draft/timeline";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  useDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { UserMessageImageAttachment } from "@/types/stream";
import { COMPACT_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useVoiceOptional } from "@/contexts/voice-context";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";
import { openWorkspaceChanges } from "@/workspace-tabs/open-supporting-view";
import { useSettings } from "@/hooks/use-settings";
// CUSTOM(model-picker-project)
import { useDraftTabProjectSource } from "@/model-picker/use-draft-tab-project-source";
// CUSTOM(draft-worktree)
import { createDraftAgentInWorktree } from "@/draft-worktree/create";
import {
  type DraftWorktreeRequest,
  resolveDraftWorktreeRequest,
  useDraftWorktreeStore,
} from "@/draft-worktree/model";
import { DraftWorktreePicker, useDraftWorktreeSource } from "@/draft-worktree/picker";
import { useDraftAgentTitleStore, withDraftAgentTitle } from "@/draft-agent-title/store";
import { routeDraftAgent } from "@/jev-router/route"; // CUSTOM(jev-router)
import { useJevDefaultPickForNewDraft } from "@/jev-router/new-draft-default"; // CUSTOM(jev-router)
import { applyDraftComposerExtras, draftComposerCreateExtras } from "./composer-extras"; // CUSTOM(draft-composer-ready)

import { draftCreationKey } from "@/composer/draft/creation-key";

interface AutoSubmitConfig {
  provider: string;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  providerOptions: Record<string, unknown>;
}

function resolveAutoSubmitConfig(
  pending: {
    provider: string;
    modeId?: string | null;
    model?: string | null;
    thinkingOptionId?: string | null;
    providerOptions?: Record<string, unknown>;
  } | null,
): AutoSubmitConfig | null {
  if (!pending) return null;
  return {
    provider: pending.provider,
    modeId: pending.modeId ?? null,
    model: pending.model ?? null,
    thinkingOptionId: pending.thinkingOptionId ?? null,
    providerOptions: pending.providerOptions ?? {},
  };
}

function resolveDraftModeIdOverride(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  effectiveModeId: string;
}): { modeId: string } | Record<string, never> {
  const { autoSubmitConfig, effectiveModeId } = input;
  if (autoSubmitConfig?.modeId) {
    return { modeId: autoSubmitConfig.modeId };
  }
  if (effectiveModeId !== "") {
    return { modeId: effectiveModeId };
  }
  return {};
}

function resolveDraftModeId(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  effectiveModeId: string;
}): string | null {
  const { autoSubmitConfig, effectiveModeId } = input;
  if (autoSubmitConfig?.modeId !== undefined) {
    return autoSubmitConfig.modeId;
  }
  if (effectiveModeId !== "") {
    return effectiveModeId;
  }
  return null;
}

async function submitDraftCreateRequest(input: {
  draftId: string;
  serverId: string;
  attempt: { clientMessageId: string };
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: unknown;
  cwd: string;
  client: DaemonClient | null;
  workspaceDirectory: string | null;
  workspaceId: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    selectedProvider: string | null;
    effectiveModeId: string;
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    providerOptions: Record<string, unknown> | undefined;
    metadata: Record<string, JsonValue>;
  };
  hostDisconnectedMessage: string;
  selectModelMessage: string;
  /** CUSTOM(draft-worktree): set when the session starts in a new worktree. */
  worktree: DraftWorktreeRequest | null;
}): Promise<{ agentId: string | null; result: AgentSnapshotPayload }> {
  const {
    attempt,
    text,
    images,
    attachments,
    cwd,
    client,
    workspaceDirectory,
    workspaceId,
    autoSubmitConfig,
    composerState,
  } = input;

  invariant(workspaceDirectory, "Workspace directory is required");
  invariant(workspaceId, "Workspace id is required");
  if (!client) {
    throw new Error(input.hostDisconnectedMessage);
  }

  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const modeIdOverride = resolveDraftModeIdOverride({
    autoSubmitConfig,
    effectiveModeId: composerState.effectiveModeId,
  });
  const selectedConfig = buildWorkspaceDraftAgentConfig({
    provider,
    cwd,
    ...modeIdOverride,
    model: autoSubmitConfig?.model ?? (composerState.effectiveModelId || undefined),
    thinkingOptionId:
      autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || undefined),
    providerOptions: autoSubmitConfig?.providerOptions ?? composerState.providerOptions,
  });
  // CUSTOM(jev-router): a first message typed by the user may start on a cheaper model; the
  // labels record Jev's pick either way.
  const { config, createOptions: jevOptions } = await routeDraftAgent({
    serverId: input.serverId,
    prompt: text,
    images,
    autoSubmitted: Boolean(autoSubmitConfig),
    attachments,
    config: selectedConfig,
  });

  // CUSTOM(draft-composer-ready): what the flame and critic were set to before the session.
  const extras = draftComposerCreateExtras({
    draftKey: input.draftId,
    prompt: text,
    labels: jevOptions.labels,
  });

  const attachmentsArray = Array.isArray(attachments) ? attachments : undefined;
  const imagesData = await encodeImages(images);
  const request = {
    config: withDraftAgentTitle(input.draftId, config), // CUSTOM(draft-agent-title)
    workspaceId,
    initialPrompt: extras.prompt, // CUSTOM(draft-composer-ready)
    clientMessageId: attempt.clientMessageId,
    ...extras.createOptions, // CUSTOM(jev-router, draft-composer-ready): labels
    ...(Object.keys(composerState.metadata).length > 0 ? { metadata: composerState.metadata } : {}),
    ...(imagesData && imagesData.length > 0 ? { images: imagesData } : {}),
    ...(attachmentsArray && attachmentsArray.length > 0 ? { attachments: attachmentsArray } : {}),
  };
  // CUSTOM(draft-worktree): a new worktree gets its own workspace, created with the agent.
  if (input.worktree) {
    const { workspaceId: _sourceWorkspaceId, ...agent } = request;
    const result = await createDraftAgentInWorktree({
      client,
      serverId: input.serverId,
      draftId: input.draftId,
      sourceDirectory: workspaceDirectory,
      worktree: input.worktree,
      agent,
    });
    await applyDraftComposerExtras({
      client,
      serverId: input.serverId,
      draftKey: input.draftId,
      agentId: result.id,
      prompt: text,
    });
    return { agentId: result.id, result };
  }
  const result = await client.createAgent({
    ...request,
    idempotencyKey: draftCreationKey(input.draftId, request),
  });
  await applyDraftComposerExtras({
    client,
    serverId: input.serverId,
    draftKey: input.draftId,
    agentId: result.id,
    prompt: text,
  });

  return {
    agentId: result.id,
    result,
  };
}

function buildDraftAgentSnapshot(input: {
  attempt: { timestamp: Date };
  serverId: string;
  tabId: string;
  workspaceDirectory: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    effectiveModeId: string;
    selectedProvider: string | null;
    agentControls: { optionControls?: ComposerOptionControls };
  };
  selectModelMessage: string;
}): Agent {
  const { attempt, serverId, tabId, workspaceDirectory, autoSubmitConfig, composerState } = input;
  invariant(workspaceDirectory, "Workspace directory is required");
  const now = attempt.timestamp;
  const model = autoSubmitConfig?.model ?? (composerState.effectiveModelId || null);
  const thinkingOptionId =
    autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || null);
  const modeId = resolveDraftModeId({
    autoSubmitConfig,
    effectiveModeId: composerState.effectiveModeId,
  });
  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  return {
    serverId,
    id: tabId,
    provider,
    status: "running",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: DRAFT_CAPABILITIES,
    currentModeId: modeId,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: { provider, sessionId: null, model, modeId },
    title: "Agent",
    cwd: workspaceDirectory,
    model,
    options: composerState.agentControls.optionControls?.options,
    controls: composerState.agentControls.optionControls?.controls,
    thinkingOptionId,
    parentAgentId: null,
    labels: {},
  };
}

function buildDraftInitialValues(input: {
  initialSetup: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (!input.initialSetup) return undefined;
  return {
    provider: input.initialSetup.provider,
    modeId: input.initialSetup.modeId,
    model: input.initialSetup.model,
    thinkingOptionId: input.initialSetup.thinkingOptionId,
  };
}

/** CUSTOM(draft-composer-ready): a command waiting for the draft's agent to exist. */
interface CommandCreateRequest {
  resolve: (agentId: string) => void;
  reject: (error: Error) => void;
}

/** Voice and agent-needing commands start the session with no first message. */
function resolveAllowsEmptyDraftText(input: {
  autoSubmitAllowsEmpty: boolean;
  voiceStartRequested: boolean;
  commandCreateRequest: CommandCreateRequest | null;
}): boolean {
  return (
    input.autoSubmitAllowsEmpty || input.voiceStartRequested || input.commandCreateRequest !== null
  );
}

interface WorkspaceDraftComposerProps {
  serverId: string;
  workspaceId: string;
  tabId: string;
  draftId: string;
  initialSetup?: WorkspaceDraftTabSetup;
  isPaneFocused: boolean;
  editingSession: ComposerEditingSession;
  onCreated: (snapshot: AgentSnapshotPayload) => void;
  onOpenImportSheet?: () => void;
}

function resolveImportPillPress(
  onOpenImportSheet: (() => void) | undefined,
  isSubmitting: boolean,
): (() => void) | null {
  if (isSubmitting) {
    return null;
  }
  return onOpenImportSheet ?? null;
}

/**
 * Creates the agent from the draft's first prompt. The conversation panel shows that prompt in
 * the timeline from the create-flow store while the agent is created.
 */
export function WorkspaceDraftComposer({
  serverId,
  workspaceId,
  tabId,
  draftId,
  initialSetup = undefined,
  isPaneFocused,
  editingSession,
  onCreated,
  onOpenImportSheet,
}: WorkspaceDraftComposerProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.workspaceDirectory,
    id: w.id,
  }));
  const workspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const draftSetup = initialSetup ?? null;
  const draftWorkingDirectory = resolveDraftWorkingDirectory({
    workspaceDirectory,
    initialSetup: draftSetup,
  });
  const draftInitialValues = buildDraftInitialValues({
    initialSetup: draftSetup,
  });
  const draftStoreKey = useMemo(
    () =>
      buildDraftStoreKey({
        serverId,
        agentId: tabId,
        draftId,
      }),
    [draftId, serverId, tabId],
  );
  const draftInput = useAgentInputDraft({
    draftKey: draftStoreKey,
    composer: {
      initialServerId: serverId,
      initialValues: draftInitialValues,
      initialProviderOptions: draftSetup?.providerOptions,
      isVisible: true,
      lockedWorkingDir: draftWorkingDirectory ?? undefined,
    },
  });
  const composerState = draftInput.composerState;
  if (!composerState) {
    throw new Error("Workspace draft composer state is required");
  }

  // CUSTOM(jev-router): a new tab starts on Effort focused's Default pick when the router is on.
  useJevDefaultPickForNewDraft({
    serverId,
    draftId: `${tabId}:${draftId}`,
    flashKey: draftId,
    isFreshDraft: draftSetup === null,
    provider: composerState.selectedProvider,
    modelId: composerState.effectiveModelId,
    effort: composerState.effectiveThinkingOptionId,
    isLoading: composerState.isModelLoading,
    availableModels: composerState.availableModels,
    apply: composerState.setModelAndThinkingFromUser,
    isFocused: isPaneFocused,
  });

  const clearDraftInput = draftInput.clear;
  const replaceDraftText = draftInput.replaceText;
  const setDraftAttachments = draftInput.setAttachments;
  const pendingAutoSubmit = useWorkspaceDraftSubmissionStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.workspaceId === workspaceId ? pending : null;
  });
  const pendingCreateAttempt = useCreateFlowStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.lifecycle === "active" ? pending : null;
  });
  const consumePendingAutoSubmit = useWorkspaceDraftSubmissionStore(
    (state) => state.consumePending,
  );
  const autoSubmitConfig = resolveAutoSubmitConfig(pendingAutoSubmit);
  const initialCreateAttempt = useMemo<DraftCreateAttempt | null>(() => {
    if (!pendingCreateAttempt) {
      return null;
    }
    return {
      clientMessageId: pendingCreateAttempt.clientMessageId,
      text: pendingCreateAttempt.text,
      timestamp: new Date(pendingCreateAttempt.timestamp),
      ...(pendingCreateAttempt.images && pendingCreateAttempt.images.length > 0
        ? { images: pendingCreateAttempt.images }
        : {}),
      ...(pendingCreateAttempt.attachments && pendingCreateAttempt.attachments.length > 0
        ? { attachments: pendingCreateAttempt.attachments }
        : {}),
    };
  }, [pendingCreateAttempt]);
  // CUSTOM(voice-new-agent): the voice button creates the agent with no first message, then
  // starts voice mode on it. A new workspace started from voice arrives here the same way.
  const voice = useVoiceOptional();
  const toast = useToast();
  const [voiceStartRequested, setVoiceStartRequested] = useState(
    () => pendingAutoSubmit?.startVoice === true,
  );
  // CUSTOM(draft-composer-ready): a plugin command that needs an agent (`!`, `/sh`, ...) creates
  // the session with no first message and then runs on it.
  const [commandCreateRequest, setCommandCreateRequest] = useState<CommandCreateRequest | null>(
    null,
  );
  const allowsEmptyAutoSubmit = resolveAllowsEmptyDraftText({
    autoSubmitAllowsEmpty: pendingAutoSubmit?.allowEmptyText === true,
    voiceStartRequested,
    commandCreateRequest,
  });
  const isCompactFormFactor = useIsCompactFormFactor();
  const isComposerFullscreen = useComposerFullscreen(editingSession);
  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_CONTENT_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd: composerState.workingDir,
    workspaceId,
  });
  const draftAttachmentScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const attachmentScopeKeys = useMemo(
    () => [draftAttachmentScopeKey, workspaceAttachmentScopeKey].filter(Boolean),
    [draftAttachmentScopeKey, workspaceAttachmentScopeKey],
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      openWorkspaceChanges({
        isCompact: isCompactFormFactor,
        workspaceKey: buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? "" }),
        preferences: openInSidePane,
      });
    },
    [isCompactFormFactor, openInSidePane, serverId, workspaceId],
  );

  // CUSTOM(draft-worktree): Tasks mode has no New workspace step, so the draft offers the worktree.
  const worktreeSource = useDraftWorktreeSource(serverId, workspaceId, !pendingAutoSubmit);

  const { formErrorMessage, isSubmitting, handleCreateFromInput, continueCreateFromAttempt } =
    useDraftAgentCreateFlow<Agent, AgentSnapshotPayload>({
      draftId,
      getPendingServerId: () => serverId,
      initialAttempt: initialCreateAttempt,
      allowEmptyText: allowsEmptyAutoSubmit,
      validateBeforeSubmit: ({ text, attachments }) => {
        const allowsEmptyDraftText = shouldAllowEmptyDraftText({
          allowsEmptyAutoSubmit,
          attachments,
        });
        return validateDraftSubmission({
          text,
          allowsEmptyAutoSubmit: allowsEmptyDraftText,
          composerState,
          autoSubmitConfig,
          workspaceDirectory: draftWorkingDirectory,
          isConnected,
        });
      },
      onBeforeSubmit: async () => {
        await composerState.persistFormPreferences();
        if (isWeb) {
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
        Keyboard.dismiss();
      },
      buildDraftAgent: (attempt) =>
        buildDraftAgentSnapshot({
          attempt,
          serverId,
          tabId,
          workspaceDirectory: draftWorkingDirectory,
          autoSubmitConfig,
          composerState,
          selectModelMessage: t("workspaceSetup.errors.selectModel"),
        }),
      createRequest: async ({ attempt, text, images, attachments, cwd }) => {
        if (pendingAutoSubmit?.agentCreation) {
          const result = await pendingAutoSubmit.agentCreation.result;
          return { agentId: result.id, result };
        }
        return submitDraftCreateRequest({
          draftId,
          serverId,
          attempt,
          text,
          images,
          attachments,
          cwd,
          client,
          workspaceDirectory: draftWorkingDirectory,
          workspaceId: workspaceFields?.id ?? null,
          autoSubmitConfig,
          composerState,
          hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
          selectModelMessage: t("workspaceSetup.errors.selectModel"),
          worktree: resolveDraftWorktreeRequest(draftId, worktreeSource), // CUSTOM(draft-worktree)
        });
      },
      onCreateSuccess: ({ result }) => {
        useDraftWorktreeStore.getState().clear(draftId); // CUSTOM(draft-worktree)
        useDraftAgentTitleStore.getState().clear(draftId); // CUSTOM(draft-agent-title)
        clearDraftInput("sent");
        clearWorkspaceAttachments({ scopeKey: draftAttachmentScopeKey });
        useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId });
        onCreated(result);
        // CUSTOM(draft-composer-ready): the command waiting on this agent runs now.
        if (commandCreateRequest) {
          setCommandCreateRequest(null);
          commandCreateRequest.resolve(result.id);
        }
        if (voiceStartRequested) {
          setVoiceStartRequested(false);
          void voice?.startVoice(serverId, result.id).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
          });
        }
      },
    });
  const voiceCreateStartedRef = useRef(false);
  useEffect(() => {
    if (!voiceStartRequested || voiceCreateStartedRef.current || pendingAutoSubmit) return;
    voiceCreateStartedRef.current = true;
    // What is typed becomes the first message; with nothing typed the agent starts idle.
    void handleCreateFromInput({
      text: draftInput.textSource.getSnapshot(),
      attachments: draftInput.attachments,
      cwd: composerState.workingDir,
    }).catch(() => {
      voiceCreateStartedRef.current = false;
      setVoiceStartRequested(false);
    });
  }, [
    composerState.workingDir,
    draftInput.attachments,
    draftInput.textSource,
    handleCreateFromInput,
    pendingAutoSubmit,
    voiceStartRequested,
  ]);
  const handleStartVoice = useCallback(() => setVoiceStartRequested(true), []);
  // CUSTOM(draft-composer-ready): the composer already took the command's text, so the session
  // starts idle; attachments stay in the draft and go nowhere, as on a running agent.
  const commandCreateStartedRef = useRef<CommandCreateRequest | null>(null);
  useEffect(() => {
    if (!commandCreateRequest || commandCreateStartedRef.current === commandCreateRequest) return;
    commandCreateStartedRef.current = commandCreateRequest;
    const request = commandCreateRequest;
    void handleCreateFromInput({ text: "", attachments: [], cwd: composerState.workingDir }).catch(
      (error: unknown) => {
        setCommandCreateRequest(null);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }, [commandCreateRequest, composerState.workingDir, handleCreateFromInput]);
  const handleCreateAgentForCommand = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        setCommandCreateRequest((current) => {
          if (current) {
            reject(new Error(t("composer.errors.alreadyLoading")));
            return current;
          }
          return { resolve, reject };
        });
      }),
    [t],
  );
  const isReadyForPendingAutoSubmit = Boolean(
    pendingAutoSubmit &&
    draftInput.isHydrated &&
    draftWorkingDirectory &&
    client &&
    !composerState.isModelLoading,
  );
  const autoSubmitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReadyForPendingAutoSubmit) {
      return;
    }
    const submitKey = `${serverId}:${workspaceId}:${draftId}`;
    if (autoSubmitKeyRef.current === submitKey) {
      return;
    }
    const submission = consumePendingAutoSubmit({ serverId, workspaceId, draftId });
    if (!submission) {
      return;
    }
    autoSubmitKeyRef.current = submitKey;
    replaceDraftText("");
    setDraftAttachments([]);
    const preparedAttempt =
      initialCreateAttempt?.clientMessageId === submission.clientMessageId
        ? initialCreateAttempt
        : null;
    const createPromise = preparedAttempt
      ? continueCreateFromAttempt({
          attempt: preparedAttempt,
          cwd: submission.cwd,
        })
      : handleCreateFromInput({
          text: submission.text,
          attachments: submission.attachments,
          cwd: submission.cwd,
        });
    void createPromise.catch(() => {
      replaceDraftText(submission.text);
      setDraftAttachments(composerWorkspaceAttachment.userAttachmentsOnly(submission.attachments));
      autoSubmitKeyRef.current = null;
    });
  }, [
    continueCreateFromAttempt,
    consumePendingAutoSubmit,
    draftId,
    handleCreateFromInput,
    initialCreateAttempt,
    isReadyForPendingAutoSubmit,
    serverId,
    setDraftAttachments,
    replaceDraftText,
    workspaceId,
  ]);

  const focusInputRef = useRef<(() => void) | null>(null);

  const handleFocusInputCallback = useCallback((focus: () => void) => {
    focusInputRef.current = focus;
  }, []);

  const handleDropdownCloseFocus = useCallback(() => {
    focusInputRef.current?.();
  }, []);
  const importPillPress = resolveImportPillPress(onOpenImportSheet, isSubmitting);
  // CUSTOM(task-shortcuts): carry the selected configuration to the draft's new source workspace.
  const projectSetup = useMemo(
    () =>
      composerState.selectedProvider
        ? {
            provider: composerState.selectedProvider,
            modeId: composerState.selectedMode || null,
            model: composerState.effectiveModelId,
            thinkingOptionId: composerState.effectiveThinkingOptionId,
            providerOptions: composerState.providerOptions ?? {},
          }
        : undefined,
    [
      composerState.selectedProvider,
      composerState.selectedMode,
      composerState.effectiveModelId,
      composerState.effectiveThinkingOptionId,
      composerState.providerOptions,
    ],
  );
  const modelPickerProject = useDraftTabProjectSource(serverId, workspaceId, tabId, projectSetup);
  // CUSTOM(model-picker-focus): ←/↑/↓/→ only drive this draft while its composer has the caret.
  const composerKeyboardTargetId = `draft-tab:${tabId}`;
  // CUSTOM(task-shortcuts): only an untouched prompt yields arrow keys to draft selection.
  useKeyboardActionHandler({
    handlerId: `draft-selection:${tabId}`,
    actions: [
      "task.draft.project",
      "task.draft.project.next",
      "task.draft.model",
      "task.draft.effort",
    ],
    enabled: isPaneFocused,
    priority: 200,
    isActive: () => isComposerKeyboardTarget(composerKeyboardTargetId),
    handle: (action) => {
      // CUSTOM(jev-router): with text, → still changes the effort when the caret is at the end.
      const hasText = draftInput.textSource.getSnapshot().length > 0;
      const caretAtEnd = action.id === "task.draft.effort" && isFocusedComposerCaretAtEnd();
      if (isSubmitting || (hasText && !caretAtEnd)) return false;
      if (
        (action.id === "task.draft.project" || action.id === "task.draft.project.next") &&
        modelPickerProject
      ) {
        const cycle = action.id === "task.draft.project" ? previousProjectId : nextProjectId;
        const next = cycle(
          // CUSTOM(project-favorites): only starred projects when any are starred.
          projectCycleIds(modelPickerProject.options, useProjectFavoritesStore.getState().keys),
          modelPickerProject.selectedId,
        );
        if (next === null) return false;
        modelPickerProject.select(next);
        return true;
      }
      if (action.id === "task.draft.model") {
        const next = previousModelSelection(
          composerState.modelSelectorProviders,
          composerState.selectedProvider,
          composerState.effectiveModelId,
          useModelFavoritesStore.getState().favoriteKeys,
        );
        if (!next) return false;
        composerState.setProviderAndModelFromUser(next.provider, next.modelId);
        return true;
      }
      if (action.id === "task.draft.effort") {
        const controls = composerState.agentControls;
        const next = nextEffortId(
          controls.thinkingOptions,
          composerState.effectiveThinkingOptionId,
          // CUSTOM(effort-favorites): the stars of the model the draft runs.
          getEffortFavorites(
            controls.selectedProvider,
            resolveDraftModelId(controls.selectedModel, controls.models),
          ),
        );
        if (!next) return false;
        controls.onSelectThinkingOption(next);
        return true;
      }
      return false;
    },
  });
  const composerAgentControls = useMemo(
    () => ({
      ...composerState.agentControls,
      onDropdownClose: handleDropdownCloseFocus,
      disabled: isSubmitting,
      modelPickerProject,
      draftKey: draftId, // CUSTOM(draft-composer-ready)
    }),
    [
      composerState.agentControls,
      draftId,
      handleDropdownCloseFocus,
      isSubmitting,
      modelPickerProject,
    ],
  );
  return (
    <View style={animatedStaticStyles.inputAreaWrapper} onLayout={onInputAreaLayout}>
      {formErrorMessage ? (
        <View
          style={styles.formErrorRow}
          dataSet={isComposerFullscreen ? undefined : CHAT_COLUMN_RAIL_DATASET}
        >
          <View style={styles.formError}>
            <Text style={styles.errorText}>{formErrorMessage}</Text>
          </View>
        </View>
      ) : null}
      {isComposerFullscreen ? null : (
        <View style={styles.formErrorRow} dataSet={CHAT_COLUMN_RAIL_DATASET}>
          {/* CUSTOM(draft-worktree) */}
          <DraftWorktreePicker
            draftId={draftId}
            source={worktreeSource}
            onSubmitName={handleDropdownCloseFocus}
          />
        </View>
      )}
      {importPillPress && !isComposerFullscreen ? (
        <View style={styles.importPillRow} dataSet={CHAT_COLUMN_RAIL_DATASET}>
          <View style={styles.importPillContent}>
            <ComposerImportPill onPress={importPillPress} />
          </View>
        </View>
      ) : null}
      <Composer
        agentId={tabId}
        serverId={serverId}
        workspaceId={workspaceId}
        isPaneFocused={isPaneFocused}
        keyboardTargetId={composerKeyboardTargetId}
        onSubmitMessage={handleCreateFromInput}
        isSubmitLoading={isSubmitting}
        blurOnSubmit={true}
        textSource={draftInput.textSource}
        onChangeText={draftInput.editText}
        textReplacement={draftInput.textReplacement}
        attachments={draftInput.attachments}
        attachmentScopeKeys={attachmentScopeKeys}
        onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
        onChangeAttachments={draftInput.setAttachments}
        cwd={composerState.workingDir}
        clearDraft={draftInput.clear}
        editingSession={editingSession}
        autoFocus={shouldAutoFocusWorkspaceDraftComposer({ isPaneFocused, isSubmitting })}
        autoFocusKey={String(draftInput.attachmentFocusRequestId)}
        onFocusInput={handleFocusInputCallback}
        commandDraft={composerState.commandDraft}
        agentControls={composerAgentControls}
        isCompactLayout={isCompactComposerLayout}
        onStartVoice={voice ? handleStartVoice : undefined}
        onCreateAgentForCommand={handleCreateAgentForCommand}
      />
    </View>
  );
}

const animatedStaticStyles = RNStyleSheet.create({
  inputAreaWrapper: {
    width: "100%",
    flexShrink: 1,
    // Content-sized inline; fills the dock's fullscreen slot.
    flexGrow: 1,
  },
});

const styles = StyleSheet.create((theme) => ({
  formErrorRow: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
  },
  importPillRow: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    paddingBottom: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
    alignItems: "center",
  },
  importPillContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    flexDirection: "row",
  },
  formError: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    marginBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  errorText: {
    color: theme.colors.destructive,
  },
}));
