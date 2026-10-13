import type { Logger } from "pino";

import type { PaseoSpeechConfig } from "../../../bootstrap.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech-provider.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { TurnDetectionProvider } from "../../turn-detection-provider.js";
import { checkCudaAvailability, type LocalSpeechExecutionProvider } from "./local-speech-gpu.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  type LocalSpeechModelId,
} from "./models.js";
import {
  getSherpaOnnxModelSpec,
  kokoroLanguageForSpeaker,
  SHERPA_ONNX_MODEL_CATALOG,
} from "./sherpa/model-catalog.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
  WorkerBackedTextToSpeechProvider,
  WorkerBackedTurnDetectionProvider,
} from "./worker-client.js";

interface ResolvedLocalModels {
  dictationLocalSttModel: string;
  voiceLocalSttModel: string;
  voiceLocalTtsModel: string;
}

// CUSTOM(voice-settings): GPU only when selected and the CUDA build is usable; otherwise
// the worker runs on the CPU and Settings shows why.
export interface LocalSpeechExecutionState {
  requested: LocalSpeechExecutionProvider;
  effective: LocalSpeechExecutionProvider;
  cudaLibDir: string;
  cudaUnavailableReason: string | null;
}

function isCatalogModelId(id: string): id is LocalSpeechModelId {
  return Object.hasOwn(SHERPA_ONNX_MODEL_CATALOG, id);
}

export function resolveTtsLanguage(
  modelId: string,
  speakerId: number | undefined,
): string | undefined {
  if (!isCatalogModelId(modelId)) return undefined;
  const { speakers } = getSherpaOnnxModelSpec(modelId);
  return speakers ? kokoroLanguageForSpeaker(speakers[speakerId ?? 0]) : undefined;
}

interface LocalSpeechAvailability {
  configured: boolean;
  modelsDir: string | null;
}

export interface InitializedLocalSpeech {
  turnDetectionService: TurnDetectionProvider | null;
  sttService: SpeechToTextProvider | null;
  ttsService: TextToSpeechProvider | null;
  dictationSttService: SpeechToTextProvider | null;
  localVoiceTtsProvider: TextToSpeechProvider | null;
  localModelConfig: {
    modelsDir: string;
    defaultModelIds: LocalSpeechModelId[];
  } | null;
  availability: LocalSpeechAvailability;
  cleanup: () => void;
  // CUSTOM(voice-settings)
  workerClient: LocalSpeechWorkerClient | null;
  execution: LocalSpeechExecutionState | null;
}

function resolveConfiguredLocalModels(speechConfig: PaseoSpeechConfig | null): ResolvedLocalModels {
  return {
    dictationLocalSttModel: speechConfig?.local?.models.dictationStt ?? DEFAULT_LOCAL_STT_MODEL,
    voiceLocalSttModel: speechConfig?.local?.models.voiceStt ?? DEFAULT_LOCAL_STT_MODEL,
    voiceLocalTtsModel: speechConfig?.local?.models.voiceTts ?? DEFAULT_LOCAL_TTS_MODEL,
  };
}

export function getLocalSpeechAvailability(
  speechConfig: PaseoSpeechConfig | null,
): LocalSpeechAvailability {
  const localConfig = speechConfig?.local ?? null;
  return {
    configured: Boolean(localConfig),
    modelsDir: localConfig?.modelsDir ?? null,
  };
}

function computeRequiredLocalModelIds(params: {
  providers: RequestedSpeechProviders;
  models: ResolvedLocalModels;
}): LocalSpeechModelId[] {
  // Custom folders are never downloaded, so only catalog models can be missing.
  const ids = new Set<string>();
  if (
    params.providers.dictationStt.enabled !== false &&
    params.providers.dictationStt.provider === "local"
  ) {
    ids.add(params.models.dictationLocalSttModel);
  }
  if (
    params.providers.voiceStt.enabled !== false &&
    params.providers.voiceStt.provider === "local"
  ) {
    ids.add(params.models.voiceLocalSttModel);
  }
  if (
    params.providers.voiceTts.enabled !== false &&
    params.providers.voiceTts.provider === "local"
  ) {
    ids.add(params.models.voiceLocalTtsModel);
  }
  return Array.from(ids).filter(isCatalogModelId);
}

function isLocalProviderEnabled(provider: { enabled?: boolean; provider: string }): boolean {
  return provider.enabled !== false && provider.provider === "local";
}

function warnLocalConfigMissing(logger: Logger, feature: string): void {
  logger.warn(
    { configured: false },
    `Local ${feature} selected but local provider config is missing; ${feature} will be unavailable`,
  );
}

function initializeLocalTurnDetection(params: {
  client: LocalSpeechWorkerClient;
}): TurnDetectionProvider {
  const { client } = params;
  return new WorkerBackedTurnDetectionProvider(client);
}

function initializeLocalVoiceStt(params: {
  client: LocalSpeechWorkerClient;
}): SpeechToTextProvider {
  const { client } = params;
  return new WorkerBackedSpeechToTextProvider(client, "voiceStt");
}

function initializeLocalDictationStt(params: {
  client: LocalSpeechWorkerClient;
}): SpeechToTextProvider {
  const { client } = params;
  return new WorkerBackedSpeechToTextProvider(client, "dictationStt");
}

function initializeLocalVoiceTts(params: {
  client: LocalSpeechWorkerClient;
}): TextToSpeechProvider {
  const { client } = params;
  return new WorkerBackedTextToSpeechProvider(client);
}

function resolveExecutionState(
  localConfig: NonNullable<PaseoSpeechConfig["local"]>,
  logger: Logger,
): LocalSpeechExecutionState {
  const requested = localConfig.executionProvider;
  if (requested !== "cuda") {
    return {
      requested,
      effective: "cpu",
      cudaLibDir: localConfig.cudaLibDir,
      cudaUnavailableReason: null,
    };
  }
  const cuda = checkCudaAvailability(localConfig.cudaLibDir);
  if (!cuda.available) {
    logger.warn(
      { cudaLibDir: cuda.libDir, reason: cuda.reason },
      "GPU speech selected but unavailable; using the CPU",
    );
    return {
      requested,
      effective: "cpu",
      cudaLibDir: cuda.libDir,
      cudaUnavailableReason: cuda.reason,
    };
  }
  return { requested, effective: "cuda", cudaLibDir: cuda.libDir, cudaUnavailableReason: null };
}

function createWorkerClient(params: {
  localConfig: NonNullable<PaseoSpeechConfig["local"]>;
  execution: LocalSpeechExecutionState;
  localModels: ResolvedLocalModels;
  speechConfig: PaseoSpeechConfig | null;
  logger: Logger;
}): LocalSpeechWorkerClient {
  const { localConfig, execution, localModels, speechConfig, logger } = params;
  const speakerId = speechConfig?.local?.models.voiceTtsSpeakerId;
  const voiceTtsLanguage = resolveTtsLanguage(localModels.voiceLocalTtsModel, speakerId);
  return new LocalSpeechWorkerClient({
    logger,
    execution: { provider: execution.effective, cudaLibDir: execution.cudaLibDir },
    config: {
      modelsDir: localConfig.modelsDir,
      voiceSttModel: localModels.voiceLocalSttModel,
      dictationSttModel: localModels.dictationLocalSttModel,
      voiceTtsModel: localModels.voiceLocalTtsModel,
      voiceTtsSpeakerId: speakerId,
      voiceTtsSpeed: speechConfig?.local?.models.voiceTtsSpeed,
      modelDirs: Object.fromEntries(
        localConfig.customModels.map((model) => [model.id, model.path]),
      ),
      ...(voiceTtsLanguage ? { voiceTtsLanguage } : {}),
    },
  });
}

export async function initializeLocalSpeechServices(params: {
  providers: RequestedSpeechProviders;
  speechConfig: PaseoSpeechConfig | null;
  logger: Logger;
}): Promise<InitializedLocalSpeech> {
  const { providers, logger, speechConfig } = params;
  const localConfig = speechConfig?.local ?? null;
  const localModels = resolveConfiguredLocalModels(speechConfig);

  let sttService: SpeechToTextProvider | null = null;
  let ttsService: TextToSpeechProvider | null = null;
  let dictationSttService: SpeechToTextProvider | null = null;
  let turnDetectionService: TurnDetectionProvider | null = null;
  let localVoiceTtsProvider: TextToSpeechProvider | null = null;

  const requiredLocalModelIds = computeRequiredLocalModelIds({
    providers,
    models: localModels,
  });

  const execution = localConfig ? resolveExecutionState(localConfig, logger) : null;
  const workerClient =
    localConfig && execution
      ? createWorkerClient({ localConfig, execution, localModels, speechConfig, logger })
      : null;

  if (isLocalProviderEnabled(providers.voiceTurnDetection)) {
    if (workerClient) {
      turnDetectionService = initializeLocalTurnDetection({ client: workerClient });
    } else {
      warnLocalConfigMissing(logger, "turn detection");
    }
  }

  if (isLocalProviderEnabled(providers.voiceStt)) {
    if (workerClient) {
      sttService = initializeLocalVoiceStt({ client: workerClient });
    } else {
      warnLocalConfigMissing(logger, "voice STT");
    }
  }

  if (isLocalProviderEnabled(providers.dictationStt)) {
    if (workerClient) {
      dictationSttService = initializeLocalDictationStt({ client: workerClient });
    } else {
      warnLocalConfigMissing(logger, "dictation STT");
    }
  }

  if (isLocalProviderEnabled(providers.voiceTts)) {
    if (workerClient) {
      localVoiceTtsProvider = initializeLocalVoiceTts({ client: workerClient });
    } else {
      warnLocalConfigMissing(logger, "voice TTS");
    }
    if (localVoiceTtsProvider) {
      ttsService = localVoiceTtsProvider;
    }
  }

  const cleanup = () => {
    workerClient?.shutdown();
  };

  return {
    turnDetectionService,
    sttService,
    ttsService,
    dictationSttService,
    localVoiceTtsProvider,
    localModelConfig: localConfig
      ? {
          modelsDir: localConfig.modelsDir,
          defaultModelIds: requiredLocalModelIds,
        }
      : null,
    availability: getLocalSpeechAvailability(speechConfig),
    cleanup,
    workerClient,
    execution,
  };
}
