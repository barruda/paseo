import pino from "pino";

import type { StreamingTranscriptionSession } from "../../speech-provider.js";
import type { TurnDetectionSession } from "../../turn-detection-provider.js";
import { resolveLocalSpeechExecutionProvider } from "./local-speech-gpu.js";
import { resolveSttModelFiles } from "./model-files.js";
import { getLocalSpeechModelDir, type LocalSpeechModelId } from "./models.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa/sherpa-offline-recognizer.js";
import { SherpaOnnxParakeetSTT } from "./sherpa/sherpa-parakeet-stt.js";
import { SherpaParakeetRealtimeTranscriptionSession } from "./sherpa/sherpa-parakeet-realtime-session.js";
import { SherpaOnnxTTS } from "./sherpa/sherpa-tts.js";
import {
  ensureSileroVadModel,
  SherpaSileroTurnDetectionProvider,
} from "./sherpa/silero-vad-provider.js";
import type {
  LocalSpeechWorkerConfig,
  LocalSpeechWorkerRequest,
  LocalSpeechWorkerToParentMessage,
} from "./worker-protocol.js";
import { bufferToWorkerBytes, workerBytesToBuffer } from "./worker-bytes.js";

process.title = "Paseo Voice";

type LocalSttEngine = SherpaOfflineRecognizerEngine;

const logger = pino({
  level: process.env.PASEO_LOG_LEVEL ?? "info",
}).child({ module: "speech", component: "local-worker" });

const sttEngines = new Map<string, LocalSttEngine>();
const sttProviders = new Map<string, SherpaOnnxParakeetSTT>();
const ttsProviders = new Map<string, SherpaOnnxTTS>();
const loadedModelIds = new Set<string>();
const sessions = new Map<string, StreamingTranscriptionSession | TurnDetectionSession>();
const unsubscribeBySessionId = new Map<string, Array<() => void>>();
let ipcClosing = false;
// CUSTOM(local-speech-gpu): CUDA when the daemon points us at a CUDA build of sherpa-onnx.
const executionProvider = resolveLocalSpeechExecutionProvider();
if (executionProvider === "cuda") {
  // Node's default SIGTERM teardown deadlocks once the CUDA runtime is loaded, leaving a
  // hung worker that pins GPU memory. The client sends SIGTERM on every idle shutdown.
  // SIGKILL is safe here: the kernel releases the GPU context.
  process.on("SIGTERM", () => process.kill(process.pid, "SIGKILL"));
}

function sendToParent(message: LocalSpeechWorkerToParentMessage): void {
  if (ipcClosing || !process.connected || !process.send) {
    return;
  }
  try {
    process.send(message, (error) => {
      if (error) {
        ipcClosing = true;
      }
    });
  } catch {
    ipcClosing = true;
  }
}

function sttModelId(config: LocalSpeechWorkerConfig, model: "voice" | "dictation"): string {
  return model === "voice" ? config.voiceSttModel : config.dictationSttModel;
}

function ttsModelId(config: LocalSpeechWorkerConfig): string {
  return config.voiceTtsModel;
}

// CUSTOM(voice-settings): folders registered in Settings come with their own path.
function modelDirFor(config: LocalSpeechWorkerConfig, modelId: string): string {
  return (
    config.modelDirs?.[modelId] ??
    getLocalSpeechModelDir(config.modelsDir, modelId as LocalSpeechModelId)
  );
}

function sttEngineKey(config: LocalSpeechWorkerConfig, modelId: string): string {
  return `${config.modelsDir}:${modelId}`;
}

// CUSTOM(voice-settings): speaker and speed are passed per synthesis, so one loaded model
// serves every voice of the same language.
function ttsKey(config: LocalSpeechWorkerConfig): string {
  return [config.modelsDir, config.voiceTtsModel, config.voiceTtsLanguage ?? ""].join(":");
}

function getSttEngine(
  config: LocalSpeechWorkerConfig,
  model: "voice" | "dictation",
): LocalSttEngine {
  const modelId = sttModelId(config, model);
  const key = sttEngineKey(config, modelId);
  const existing = sttEngines.get(key);
  if (existing) {
    return existing;
  }
  // CUSTOM(voice-settings): pick the files by folder contents and execution provider.
  const files = resolveSttModelFiles(modelDirFor(config, modelId), executionProvider);
  const created = new SherpaOfflineRecognizerEngine(
    {
      model: {
        kind: "nemo_transducer",
        ...files,
      },
      numThreads: 2,
      provider: executionProvider,
      debug: 0,
    },
    logger,
  );
  sttEngines.set(key, created);
  loadedModelIds.add(modelId);
  return created;
}

function getSttProvider(
  config: LocalSpeechWorkerConfig,
  model: "voice" | "dictation",
): SherpaOnnxParakeetSTT {
  const modelId = sttModelId(config, model);
  const key = sttEngineKey(config, modelId);
  const existing = sttProviders.get(key);
  if (existing) {
    return existing;
  }
  const created = new SherpaOnnxParakeetSTT({ engine: getSttEngine(config, model) }, logger);
  sttProviders.set(key, created);
  return created;
}

function getTtsProvider(config: LocalSpeechWorkerConfig): SherpaOnnxTTS {
  const key = ttsKey(config);
  const existing = ttsProviders.get(key);
  if (existing) {
    return existing;
  }
  // CUSTOM(voice-settings): a multi-language Kokoro loads once per language; drop the other
  // languages of the same model so previews across languages don't stack copies in memory.
  const modelPrefix = `${config.modelsDir}:${config.voiceTtsModel}:`;
  for (const [otherKey, other] of ttsProviders) {
    if (otherKey.startsWith(modelPrefix)) {
      other.free();
      ttsProviders.delete(otherKey);
    }
  }
  const modelDir = modelDirFor(config, ttsModelId(config));
  const created = new SherpaOnnxTTS(
    {
      preset: ttsModelId(config),
      modelDir,
      speakerId: config.voiceTtsSpeakerId,
      speed: config.voiceTtsSpeed,
      provider: executionProvider,
      language: config.voiceTtsLanguage,
    },
    logger,
  );
  ttsProviders.set(key, created);
  loadedModelIds.add(ttsModelId(config));
  return created;
}

function cleanupSession(sessionId: string): void {
  const unsubscribe = unsubscribeBySessionId.get(sessionId);
  if (unsubscribe) {
    for (const fn of unsubscribe) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }
  unsubscribeBySessionId.delete(sessionId);
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  try {
    session?.close();
  } catch {
    // ignore
  }
}

function trackTranscriptionSession(
  sessionId: string,
  session: StreamingTranscriptionSession,
): void {
  session.on("committed", (payload) => {
    sendToParent({ type: "session.committed", sessionId, payload });
  });
  session.on("transcript", (payload) => {
    sendToParent({ type: "session.transcript", sessionId, payload });
  });
  session.on("error", (err) => {
    sendToParent({
      type: "session.error",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  unsubscribeBySessionId.set(sessionId, []);
}

function trackTurnDetectionSession(sessionId: string, session: TurnDetectionSession): void {
  session.on("speech_started", () => {
    sendToParent({ type: "session.speech_started", sessionId });
  });
  session.on("speech_stopped", () => {
    sendToParent({ type: "session.speech_stopped", sessionId });
  });
  session.on("error", (err) => {
    sendToParent({
      type: "session.error",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  unsubscribeBySessionId.set(sessionId, []);
}

async function createSession(
  message: Extract<LocalSpeechWorkerRequest, { type: "session.create" }>,
) {
  cleanupSession(message.sessionId);
  if (message.kind === "vad") {
    let vadModelPath: string | undefined;
    try {
      vadModelPath = await ensureSileroVadModel(message.config.modelsDir, logger);
    } catch (err) {
      logger.warn({ err }, "Failed to provision Silero VAD model, falling back to bundled");
    }
    const provider = new SherpaSileroTurnDetectionProvider({ modelPath: vadModelPath }, logger);
    const session = provider.createSession({ logger });
    trackTurnDetectionSession(message.sessionId, session);
    await session.connect();
    sessions.set(message.sessionId, session);
    return { requiredSampleRate: session.requiredSampleRate };
  }

  const model = message.kind === "voiceStt" ? "voice" : "dictation";
  const engine = getSttEngine(message.config, model);
  const session =
    message.kind === "voiceStt"
      ? getSttProvider(message.config, "voice").createSession({ logger })
      : new SherpaParakeetRealtimeTranscriptionSession({ engine });
  trackTranscriptionSession(message.sessionId, session);
  await session.connect();
  sessions.set(message.sessionId, session);
  return { requiredSampleRate: session.requiredSampleRate };
}

function sendOk(requestId: string, result?: unknown): void {
  sendToParent({ type: "response", requestId, ok: true, result });
}

type LocalSpeechWorkerSessionRequest = Extract<
  LocalSpeechWorkerRequest,
  {
    type:
      | "session.append"
      | "session.commit"
      | "session.clear"
      | "session.flush"
      | "session.reset"
      | "session.close";
  }
>;

function handleSessionRequest(message: LocalSpeechWorkerSessionRequest): void {
  if (message.type === "session.close") {
    cleanupSession(message.sessionId);
    sendOk(message.requestId);
    return;
  }

  const session = sessions.get(message.sessionId);
  switch (message.type) {
    case "session.append":
      session?.appendPcm16(workerBytesToBuffer(message.audio));
      break;
    case "session.commit":
      if (session && "commit" in session) {
        session.commit();
      }
      break;
    case "session.clear":
      if (session && "clear" in session) {
        session.clear();
      }
      break;
    case "session.flush":
      if (session && "flush" in session) {
        session.flush();
      }
      break;
    case "session.reset":
      if (session && "reset" in session) {
        session.reset();
      }
      break;
  }
  sendOk(message.requestId);
}

async function handleRequest(message: LocalSpeechWorkerRequest): Promise<void> {
  // CUSTOM(voice-settings): what Settings shows as loaded in this worker.
  if (message.type === "status.get") {
    sendOk(message.requestId, {
      executionProvider,
      loadedModels: Array.from(loadedModelIds),
      activeSessions: sessions.size,
    });
    return;
  }

  if (message.type === "tts.synthesize") {
    const result = await getTtsProvider(message.config).synthesizeSpeech(message.text, {
      speakerId: message.config.voiceTtsSpeakerId,
      speed: message.config.voiceTtsSpeed,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    sendOk(message.requestId, {
      audio: bufferToWorkerBytes(Buffer.concat(chunks)),
      format: result.format,
    });
    return;
  }

  if (message.type === "stt.transcribe") {
    const result = await getSttProvider(message.config, message.model).transcribeAudio(
      workerBytesToBuffer(message.audio),
      message.format,
    );
    sendOk(message.requestId, result);
    return;
  }

  if (message.type === "session.create") {
    const result = await createSession(message);
    sendOk(message.requestId, result);
    return;
  }

  handleSessionRequest(message);
}

process.on("message", (message: LocalSpeechWorkerRequest) => {
  void handleRequest(message).catch((error: unknown) => {
    sendToParent({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Local speech worker request failed",
    });
  });
});

process.once("disconnect", () => {
  ipcClosing = true;
  for (const sessionId of Array.from(sessions.keys())) {
    cleanupSession(sessionId);
  }
  for (const tts of ttsProviders.values()) {
    try {
      tts.free();
    } catch {
      // ignore
    }
  }
  for (const engine of sttEngines.values()) {
    engine.free();
  }
});
