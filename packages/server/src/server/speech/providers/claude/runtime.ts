// CUSTOM(claude-stt, claude-tts): builds the Claude speech providers for the features that pick it.
import type { Logger } from "pino";

import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { SpeechServices } from "../openai/runtime.js";
import type { ClaudeSpeechConfig } from "./config.js";
import { resolveClaudeConfigDir } from "./credentials.js";
import { ClaudeSTT } from "./stt.js";
import { ClaudeTTS, DEFAULT_CLAUDE_TTS_SPEED, DEFAULT_CLAUDE_TTS_VOICE } from "./tts.js";

export function initializeClaudeSpeechServices(params: {
  providers: RequestedSpeechProviders;
  claudeConfig: ClaudeSpeechConfig | undefined;
  existing: SpeechServices;
  logger: Logger;
}): SpeechServices {
  const { providers, existing } = params;
  const wantsVoice =
    !existing.sttService &&
    providers.voiceStt.enabled !== false &&
    providers.voiceStt.provider === "claude";
  const wantsDictation =
    !existing.dictationSttService &&
    providers.dictationStt.enabled !== false &&
    providers.dictationStt.provider === "claude";
  const wantsTts =
    !existing.ttsService &&
    providers.voiceTts.enabled !== false &&
    providers.voiceTts.provider === "claude";
  if (!wantsVoice && !wantsDictation && !wantsTts) {
    return existing;
  }
  const config = params.claudeConfig ?? {
    language: "en",
    keyterms: [],
    tts: { voice: DEFAULT_CLAUDE_TTS_VOICE, speed: DEFAULT_CLAUDE_TTS_SPEED },
  };
  const configDir = resolveClaudeConfigDir(config.configDir);
  const tts = wantsTts
    ? new ClaudeTTS(
        {
          configDir,
          language: config.language,
          voice: config.tts.voice,
          speed: config.tts.speed,
        },
        params.logger,
      )
    : null;
  if (!wantsVoice && !wantsDictation) {
    return { ...existing, ttsService: tts ?? existing.ttsService };
  }
  const stt = new ClaudeSTT(
    {
      configDir,
      language: config.language,
      keyterms: config.keyterms,
    },
    params.logger,
  );
  return {
    ...existing,
    sttService: wantsVoice ? stt : existing.sttService,
    dictationSttService: wantsDictation ? stt : existing.dictationSttService,
    ttsService: tts ?? existing.ttsService,
  };
}

// With Claude speaking, a voice preview reads `request.model` as the Claude voice to try and
// `request.speed` as the speed, so the app needs no new request shape.
export async function previewClaudeVoice(params: {
  request: { text: string; model?: string; speed?: number };
  claudeConfig: ClaudeSpeechConfig | undefined;
  activeTts: unknown;
  logger: Logger;
}): Promise<{ audio: Buffer; format: string }> {
  const { request, claudeConfig, activeTts } = params;
  const tts =
    activeTts instanceof ClaudeTTS
      ? activeTts
      : new ClaudeTTS(
          {
            configDir: resolveClaudeConfigDir(claudeConfig?.configDir),
            language: claudeConfig?.language ?? "en",
          },
          params.logger,
        );
  const result = await tts.synthesizeSpeech(request.text, {
    voice: request.model ?? claudeConfig?.tts.voice,
    speed: request.speed ?? claudeConfig?.tts.speed,
  });
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { audio: Buffer.concat(chunks), format: result.format };
}
