// CUSTOM(claude-stt): builds the Claude speech-to-text provider for the features that pick it.
import type { Logger } from "pino";

import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { SpeechServices } from "../openai/runtime.js";
import type { ClaudeSpeechConfig } from "./config.js";
import { resolveClaudeConfigDir } from "./credentials.js";
import { ClaudeSTT } from "./stt.js";

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
  if (!wantsVoice && !wantsDictation) {
    return existing;
  }
  const config = params.claudeConfig ?? { language: "en", keyterms: [] };
  const stt = new ClaudeSTT(
    {
      configDir: resolveClaudeConfigDir(config.configDir),
      language: config.language,
      keyterms: config.keyterms,
    },
    params.logger,
  );
  return {
    ...existing,
    sttService: wantsVoice ? stt : existing.sttService,
    dictationSttService: wantsDictation ? stt : existing.dictationSttService,
  };
}
