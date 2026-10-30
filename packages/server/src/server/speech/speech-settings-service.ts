// CUSTOM(voice-settings): backs Settings > Voice and dictation. Assembles the live status of
// the local speech engine (worker process, memory, GPU, models, readiness, recent speech
// log lines), synthesizes voice previews, and inspects model folders before they are added.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  SpeechCustomModel,
  SpeechLocalStatus,
  SpeechModelInfo,
} from "@getpaseo/protocol/speech-settings";

import { VOICE_AGENT_SYSTEM_INSTRUCTION } from "../voice-config.js";
import { checkCudaAvailability, resolveCudaLibDir } from "./providers/local/local-speech-gpu.js";
import {
  countKokoroVoices,
  detectLocalSpeechModelKind,
  folderSizeBytes,
  resolveSttModelFiles,
  resolveTtsModelFiles,
} from "./providers/local/model-files.js";
import { getLocalSpeechModelDir, listLocalSpeechModels } from "./providers/local/models.js";
import { isSherpaOnnxModelInstalled } from "./providers/local/sherpa/model-downloader.js";
import type {
  LocalSpeechRuntimeStatus,
  SpeechService,
  SpeechVoicePreviewRequest,
} from "./speech-runtime.js";

export interface SpeechSettingsService {
  getStatus(options: { includeLogs: boolean }): Promise<SpeechLocalStatus>;
  previewVoice(request: SpeechVoicePreviewRequest): Promise<{ audio: string; format: string }>;
  inspectModelFolder(folder: string): SpeechCustomModel;
}

const ENV_CONTROLLED_SETTINGS: ReadonlyArray<[string, string]> = [
  ["PASEO_DICTATION_LOCAL_STT_MODEL", "dictationSttModel"],
  ["PASEO_VOICE_LOCAL_STT_MODEL", "voiceSttModel"],
  ["PASEO_VOICE_LOCAL_TTS_MODEL", "voiceTtsModel"],
  ["PASEO_VOICE_LOCAL_TTS_SPEAKER_ID", "voiceTtsSpeakerId"],
  ["PASEO_VOICE_LOCAL_TTS_SPEED", "voiceTtsSpeed"],
  ["PASEO_LOCAL_MODELS_DIR", "modelsDir"],
];

const SIZE_CACHE_TTL_MS = 5 * 60 * 1000;
const NVIDIA_SMI_TIMEOUT_MS = 2000;
const LOG_TAIL_BYTES = 2 * 1024 * 1024;
const LOG_LIMIT = 120;
const CLOCK_TICKS_PER_SECOND = 100;

interface ProcessSample {
  ticks: number;
  at: number;
}

interface GpuProbe {
  device: SpeechLocalStatus["gpuDevice"];
  vramByPid: Map<number, number>;
}

function runNvidiaSmi(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", args, { timeout: NVIDIA_SMI_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

async function probeGpu(): Promise<GpuProbe> {
  const [gpus, apps] = await Promise.all([
    runNvidiaSmi([
      "--query-gpu=name,memory.total,memory.used,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]),
    runNvidiaSmi(["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"]),
  ]);
  const vramByPid = new Map<number, number>();
  for (const line of apps?.split("\n") ?? []) {
    const [pid, usedMb] = line.split(",").map((part) => Number(part.trim()));
    if (Number.isFinite(pid) && Number.isFinite(usedMb)) {
      vramByPid.set(pid, usedMb * 1024 * 1024);
    }
  }
  const first = gpus?.split("\n").find((line) => line.trim().length > 0);
  if (!first) return { device: null, vramByPid };
  const [name, totalMb, usedMb, utilization] = first.split(",").map((part) => part.trim());
  return {
    device: {
      name: name ?? "GPU",
      memoryTotalBytes: Number(totalMb) * 1024 * 1024,
      memoryUsedBytes: Number(usedMb) * 1024 * 1024,
      utilizationPercent: Number.isFinite(Number(utilization)) ? Number(utilization) : null,
    },
    vramByPid,
  };
}

function readRssBytes(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function readCpuTicks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Fields after the parenthesised command name; utime and stime are fields 14 and 15.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(fields[11]) + Number(fields[12]);
  } catch {
    return null;
  }
}

function readTail(file: string, maxBytes: number): string {
  const size = statSync(file).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString("utf8");
  return length < size ? text.slice(text.indexOf("\n") + 1) : text;
}

const SPEECH_COMPONENTS = new Set([
  "tts-manager",
  "voice-turn-controller",
  "local-speech-worker-client",
  "local-worker",
  "offline-recognizer",
  "tts",
]);
const SPEECH_MESSAGE =
  /^(set_voice_mode|Voice mode|Transcription result|Voice speak tool|Dictation)/;
const NOISY_MESSAGE = /^(Voice input chunk summary|voice_input_state)/;
const LOG_CONTEXT_KEYS = new Set([
  "level",
  "time",
  "pid",
  "hostname",
  "daemonVersion",
  "module",
  "component",
  "msg",
  "connectionId",
  "clientId",
  "sessionId",
  "userAgent",
  "origin",
  "host",
  "remoteAddress",
  "peer",
  "transport",
]);
const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

type LogEntry = SpeechLocalStatus["logs"][number];

// Matches the pretty format dev daemons write: "[17:43:27.357] INFO: message {json}".
const PRETTY_LOG_LINE = /^\[(\d\d:\d\d:\d\d\.\d+)\]\s+(\w+):\s+(.*?)\s*(\{.*\})?$/;
// oxlint-disable-next-line no-control-regex -- strips ANSI colors from pretty log lines
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const LEVEL_NUMBERS: Record<string, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
};

function parseLogRecord(line: string): Record<string, unknown> | null {
  if (line.startsWith("{")) {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const match = PRETTY_LOG_LINE.exec(line.replace(ANSI_ESCAPE, ""));
  if (!match) return null;
  const [, clock, level, msg, json] = match;
  let fields: Record<string, unknown> = {};
  try {
    fields = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    fields = {};
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...fields,
    msg,
    level: LEVEL_NUMBERS[level] ?? level,
    time: Date.parse(`${today}T${clock}`),
  };
}

export function parseSpeechLogLine(line: string): LogEntry | null {
  const record = parseLogRecord(line);
  if (!record) return null;
  const message = typeof record.msg === "string" ? record.msg : "";
  const isSpeech =
    record.module === "speech-runtime" ||
    record.module === "speech" ||
    SPEECH_COMPONENTS.has(String(record.component)) ||
    SPEECH_MESSAGE.test(message);
  if (!isSpeech || NOISY_MESSAGE.test(message)) return null;
  const detail = Object.fromEntries(
    Object.entries(record).filter(([key]) => !LOG_CONTEXT_KEYS.has(key)),
  );
  const detailText = Object.keys(detail).length > 0 ? JSON.stringify(detail) : null;
  return {
    time: new Date(Number(record.time)).toISOString(),
    level: LEVEL_NAMES[Number(record.level)] ?? String(record.level),
    message,
    detail: detailText && detailText.length > 400 ? `${detailText.slice(0, 400)}…` : detailText,
  };
}

// The newest log first: daemon.log, then rotated <stamp>-daemon.log files.
function readSpeechLogs(paseoHome: string): LogEntry[] {
  let rotated: string[] = [];
  try {
    rotated = readdirSync(paseoHome)
      .filter((name) => name.endsWith("-daemon.log"))
      .sort()
      .toReversed();
  } catch {
    rotated = [];
  }
  const files = ["daemon.log", ...rotated].map((name) => path.join(paseoHome, name));
  const entries: LogEntry[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const lines = readTail(file, LOG_TAIL_BYTES).split("\n");
    const fileEntries = lines.map(parseSpeechLogLine).filter((entry) => entry !== null);
    entries.unshift(...fileEntries);
    if (entries.length >= LOG_LIMIT) break;
  }
  return entries.slice(-LOG_LIMIT).toReversed();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "model"
  );
}

function expandHome(folder: string): string {
  return folder === "~" || folder.startsWith("~/")
    ? path.join(os.homedir(), folder.slice(1))
    : folder;
}

export function createSpeechSettingsService(params: {
  speech: SpeechService;
  paseoHome: string;
  env: NodeJS.ProcessEnv;
}): SpeechSettingsService {
  const { speech, paseoHome, env } = params;
  const sizeCache = new Map<string, { size: number; at: number }>();
  const cpuSamples = new Map<number, ProcessSample>();

  const cachedSize = (dir: string): number => {
    const cached = sizeCache.get(dir);
    if (cached && Date.now() - cached.at < SIZE_CACHE_TTL_MS) return cached.size;
    const size = folderSizeBytes(dir);
    sizeCache.set(dir, { size, at: Date.now() });
    return size;
  };

  const cpuPercent = (pid: number): number | null => {
    const ticks = readCpuTicks(pid);
    if (ticks === null) return null;
    const now = Date.now();
    const previous = cpuSamples.get(pid);
    cpuSamples.set(pid, { ticks, at: now });
    if (!previous || now <= previous.at) return null;
    const cpuSeconds = (ticks - previous.ticks) / CLOCK_TICKS_PER_SECOND;
    return Math.max(0, Math.round((cpuSeconds / ((now - previous.at) / 1000)) * 1000) / 10);
  };

  const listModels = async (): Promise<SpeechModelInfo[]> => {
    const local = speech.resolveSpeechConfig()?.local;
    const modelsDir = local?.modelsDir ?? null;
    const catalog = await Promise.all(
      listLocalSpeechModels().map(async (spec): Promise<SpeechModelInfo> => {
        const installed = modelsDir ? await isSherpaOnnxModelInstalled(modelsDir, spec.id) : false;
        const dir = modelsDir ? getLocalSpeechModelDir(modelsDir, spec.id) : null;
        return {
          id: spec.id,
          kind: spec.kind === "tts" ? "tts" : "stt",
          label: spec.label,
          source: "catalog",
          languages: spec.languagesLabel ?? spec.languages.join(", "),
          installed,
          path: installed ? dir : null,
          sizeBytes: installed && dir ? cachedSize(dir) : null,
          downloadSizeMb: Math.round(spec.downloadSizeBytes / 1_000_000),
          speakers: [...(spec.speakers ?? [])],
        };
      }),
    );
    const custom = (local?.customModels ?? []).map((model): SpeechModelInfo => {
      let installed = true;
      try {
        if (model.kind === "tts") resolveTtsModelFiles(model.path);
        else resolveSttModelFiles(model.path, "cpu");
      } catch {
        installed = false;
      }
      const voices = model.kind === "tts" ? countKokoroVoices(model.path).count : 0;
      return {
        id: model.id,
        kind: model.kind,
        label: model.label ?? path.basename(model.path),
        source: "custom",
        languages: null,
        installed,
        path: model.path,
        sizeBytes: installed ? cachedSize(model.path) : null,
        downloadSizeMb: null,
        speakers: Array.from({ length: voices }, (_, index) => `Voice ${index}`),
      };
    });
    return [...catalog, ...custom];
  };

  const workerStatus = (
    worker: LocalSpeechRuntimeStatus["worker"],
    gpu: GpuProbe,
  ): SpeechLocalStatus["worker"] => {
    if (!worker?.running || worker.pid === null) {
      return {
        running: false,
        pid: null,
        startedAt: null,
        rssBytes: null,
        cpuPercent: null,
        vramBytes: null,
        loadedModels: [],
        activeSessions: worker?.activeSessions ?? 0,
        inFlightRequests: worker?.inFlightRequests ?? 0,
      };
    }
    const pid = worker.pid;
    return {
      running: true,
      pid,
      startedAt: worker.startedAt,
      rssBytes: readRssBytes(pid),
      cpuPercent: cpuPercent(pid),
      vramBytes: gpu.vramByPid.get(pid) ?? null,
      loadedModels: worker.loadedModels,
      activeSessions: worker.activeSessions,
      inFlightRequests: worker.inFlightRequests,
    };
  };

  const engineStatus = (runtime: LocalSpeechRuntimeStatus): SpeechLocalStatus["engine"] => {
    const local = speech.resolveSpeechConfig()?.local;
    const execution = runtime.execution;
    const cudaLibDir = execution?.cudaLibDir ?? resolveCudaLibDir(env, local?.cudaLibDir);
    const cuda = checkCudaAvailability(cudaLibDir);
    return {
      configured: runtime.configured,
      requestedProvider: execution?.requested ?? local?.executionProvider ?? "cpu",
      effectiveProvider: execution?.effective ?? "cpu",
      gpuAvailable: cuda.available,
      gpuUnavailableReason: cuda.available ? null : cuda.reason,
      cudaLibDir,
      modelsDir: local?.modelsDir ?? null,
    };
  };

  const readinessStatus = (): SpeechLocalStatus["readiness"] => {
    const readiness = speech.getReadiness();
    return {
      dictation: {
        available: readiness.dictation.available,
        message: readiness.dictation.message,
      },
      voice: {
        available: readiness.realtimeVoice.available,
        message: readiness.realtimeVoice.message,
      },
      downloadInProgress: readiness.download.inProgress,
      downloadModelIds: readiness.missingLocalModelIds,
      downloadError: readiness.download.error,
    };
  };

  const getStatus: SpeechSettingsService["getStatus"] = async ({ includeLogs }) => {
    const [runtime, gpu, models] = await Promise.all([
      speech.getLocalStatus(),
      probeGpu(),
      listModels(),
    ]);
    return {
      engine: engineStatus(runtime),
      worker: workerStatus(runtime.worker, gpu),
      gpuDevice: gpu.device,
      readiness: readinessStatus(),
      models,
      envControlled: ENV_CONTROLLED_SETTINGS.filter(([name]) => env[name] !== undefined).map(
        ([, setting]) => setting,
      ),
      defaultVoiceInstructions: VOICE_AGENT_SYSTEM_INSTRUCTION,
      logs: includeLogs ? readSpeechLogs(paseoHome) : [],
    };
  };

  const previewVoice: SpeechSettingsService["previewVoice"] = async (request) => {
    const text = request.text.trim().slice(0, 400);
    if (!text) throw new Error("Nothing to say.");
    const result = await speech.previewVoice({ ...request, text });
    return { audio: result.audio.toString("base64"), format: result.format };
  };

  const inspectModelFolder: SpeechSettingsService["inspectModelFolder"] = (folder) => {
    const resolved = path.resolve(expandHome(folder.trim()));
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`Folder not found on this host: ${resolved}`);
    }
    const kind = detectLocalSpeechModelKind(resolved);
    const name = path.basename(resolved);
    const hash = createHash("sha1").update(resolved).digest("hex").slice(0, 6);
    return { id: `custom-${slug(name)}-${hash}`, kind, path: resolved, label: name };
  };

  return { getStatus, previewVoice, inspectModelFolder };
}
