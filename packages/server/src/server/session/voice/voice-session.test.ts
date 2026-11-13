import { Readable } from "node:stream";
import type { VoiceSpeakHandler } from "../../voice-types.js";
import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import { VoiceSession, isAcknowledgementOnly, type VoiceSessionHost } from "./voice-session.js";
import { buildVoiceModeSystemPrompt } from "../../voice-config.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type {
  SpeechToTextProvider,
  TextToSpeechProvider,
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type {
  TurnDetectionProvider,
  TurnDetectionSession,
} from "../../speech/turn-detection-provider.js";

const VOICE_AGENT_ID = "11111111-1111-4111-8111-111111111111";

class FakeVoiceTurnDetectionSession extends EventEmitter implements TurnDetectionSession {
  public readonly requiredSampleRate = 16000;

  async connect(): Promise<void> {}

  appendPcm16(_chunk: Buffer): void {}

  flush(): void {}
  reset(): void {}
  close(): void {}
}

class FakeVoiceSttSession extends EventEmitter implements StreamingTranscriptionSession {
  public readonly requiredSampleRate = 16000;
  public commitCount = 0;

  async connect(): Promise<void> {}

  appendPcm16(_pcm16le: Buffer): void {}

  commit(): void {
    this.commitCount += 1;
  }

  clear(): void {}
  close(): void {}

  emitCommitted(event: StreamingTranscriptionCommittedEvent): void {
    this.emit("committed", event);
  }

  emitTranscript(event: StreamingTranscriptionEvent): void {
    this.emit("transcript", event);
  }
}

interface FakeVoiceHost extends VoiceSessionHost {
  readonly emitted: SessionOutboundMessage[];
  readonly spokenInput: Array<{ agentId: string; text: string }>;
}

function createFakeHost(): FakeVoiceHost {
  const emitted: SessionOutboundMessage[] = [];
  const spokenInput: Array<{ agentId: string; text: string }> = [];
  return {
    emitted,
    spokenInput,
    emit: (msg) => {
      emitted.push(msg);
    },
    loadAgent: async (agentId) =>
      ({ id: agentId, config: { systemPrompt: undefined } }) as unknown as ManagedAgent,
    reloadAgentSession: async (agentId) => ({ id: agentId }) as unknown as ManagedAgent,
    sendSpokenInput: async (agentId, text) => {
      spokenInput.push({ agentId, text });
    },
    interruptAgentIfRunning: async () => {},
    hasActiveAgentRun: () => false,
  };
}

function createVoiceSession(
  tts: TextToSpeechProvider | null = null,
  options: { bargeInConfirmMs?: number } = {},
) {
  let speakHandler: VoiceSpeakHandler | undefined;
  const detector = new FakeVoiceTurnDetectionSession();
  const sttSession = new FakeVoiceSttSession();
  const stt: SpeechToTextProvider = {
    id: "local",
    createSession: vi.fn(() => sttSession),
  };
  const turnDetection: TurnDetectionProvider = {
    id: "local",
    createSession: vi.fn(() => detector),
  };
  const host = createFakeHost();
  const voiceSession = new VoiceSession({
    host,
    logger: pino({ level: "silent" }),
    sessionId: "voice-session-test",
    sttLanguage: "en",
    tts,
    voiceBridge: {
      registerVoiceSpeakHandler: (_id, handler) => {
        speakHandler = handler;
      },
    },
    stt,
    voice: { turnDetection, bargeInConfirmMs: options.bargeInConfirmMs ?? 20 },
  });
  return {
    voiceSession,
    detector,
    sttSession,
    host,
    speak: (args: Parameters<VoiceSpeakHandler>[0]) => {
      if (!speakHandler) throw new Error("Voice speak handler not registered");
      return speakHandler(args);
    },
  };
}

function isTranscriptionResult(message: SessionOutboundMessage): boolean {
  return message.type === "transcription_result";
}

function isAudioOutput(message: SessionOutboundMessage): boolean {
  return message.type === "audio_output";
}

async function waitForAudioOutput(host: FakeVoiceHost): Promise<void> {
  await vi.waitFor(() => expect(host.emitted.filter(isAudioOutput)).toHaveLength(1));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("VoiceSession streaming transcription", () => {
  // CUSTOM(confirmed-barge-in)
  function createSpeakingSession(bargeInConfirmMs: number) {
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech() {
        return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
      },
    };
    const session = createVoiceSession(tts, { bargeInConfirmMs });
    const interrupted: string[] = [];
    async function recordInterruption(agentId: string) {
      interrupted.push(agentId);
    }
    session.host.interruptAgentIfRunning = recordInterruption;
    return { ...session, interrupted };
  }

  const SPEAKING = { type: "voice_input_state", payload: { isSpeaking: true } };

  test("interrupts the agent once speech lasts past the confirm window", async () => {
    const { voiceSession, detector, host, interrupted } = createSpeakingSession(20);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    try {
      detector.emit("speech_started");
      await settle();
      expect(host.emitted).not.toContainEqual(SPEAKING);
      expect(interrupted).toEqual([]);
      await vi.waitFor(() => expect(interrupted).toEqual([VOICE_AGENT_ID]));
      expect(host.emitted).toContainEqual(SPEAKING);
    } finally {
      await voiceSession.cleanup();
    }
  });

  test("long sound without words leaves the reply playing", async () => {
    const { voiceSession, detector, host, speak, interrupted } = createSpeakingSession(20);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(interrupted).toEqual([]);
      expect(host.emitted).not.toContainEqual(SPEAKING);
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("a short sound that transcribes to nothing leaves the reply playing", async () => {
    const { voiceSession, detector, sttSession, host, speak, interrupted } =
      createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "",
        isFinal: true,
        isLowConfidence: false,
      });
      await settle();
      expect(interrupted).toEqual([]);
      expect(host.emitted).not.toContainEqual(SPEAKING);
      expect(host.spokenInput).toEqual([]);
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("a short word interrupts once it is transcribed", async () => {
    const { voiceSession, detector, sttSession, host, speak, interrupted } =
      createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      detector.emit("speech_stopped");
      await settle();
      expect(interrupted).toEqual([]);
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "Stop.",
        isFinal: true,
        isLowConfidence: false,
      });
      await vi.waitFor(() => expect(interrupted).toEqual([VOICE_AGENT_ID]));
      await playback;
      const speechStates = host.emitted.filter((message) => message.type === "voice_input_state");
      expect(speechStates.at(-2)).toEqual(SPEAKING);
      expect(speechStates.at(-1)).toEqual({
        type: "voice_input_state",
        payload: { isSpeaking: false },
      });
      await vi.waitFor(() =>
        expect(host.spokenInput).toEqual([{ agentId: VOICE_AGENT_ID, text: "Stop." }]),
      );
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  // CUSTOM(voice-live-transcript)
  test("words in a partial transcript interrupt a playing reply and are sent live", async () => {
    const { voiceSession, detector, sttSession, host, speak, interrupted } =
      createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      sttSession.emitTranscript({ segmentId: "segment-1", transcript: "  ", isFinal: false });
      await settle();
      expect(interrupted).toEqual([]);
      expect(host.emitted).not.toContainEqual(SPEAKING);
      sttSession.emitTranscript({ segmentId: "segment-1", transcript: "wait a", isFinal: false });
      await vi.waitFor(() => expect(interrupted).toEqual([VOICE_AGENT_ID]));
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "wait a second",
        isFinal: false,
      });
      await vi.waitFor(() =>
        expect(host.emitted).toContainEqual({
          type: "voice_input_state",
          payload: { isSpeaking: true, transcript: "wait a second" },
        }),
      );
      expect(host.emitted).toContainEqual({
        type: "voice_input_state",
        payload: { isSpeaking: true, transcript: "wait a" },
      });
      expect(interrupted).toEqual([VOICE_AGENT_ID]);
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  // CUSTOM(voice-ack-silences-reply)
  test("an acknowledgement word silences the reply without interrupting the agent", async () => {
    const { voiceSession, detector, sttSession, host, speak, interrupted } =
      createSpeakingSession(20);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      sttSession.emitTranscript({ segmentId: "segment-1", transcript: "Okay.", isFinal: false });
      await vi.waitFor(() => expect(host.emitted).toContainEqual(SPEAKING));
      await playback;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(interrupted).toEqual([]);

      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "Okay okay.",
        isFinal: true,
        isLowConfidence: false,
      });
      await vi.waitFor(() => expect(host.emitted.filter(isTranscriptionResult)).toHaveLength(1));
      expect(interrupted).toEqual([]);
      expect(host.spokenInput).toEqual([]);
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("an acknowledgement that grows into words still interrupts the agent", async () => {
    const { voiceSession, detector, sttSession, host, speak, interrupted } =
      createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({ text: "A spoken response." });
    try {
      await waitForAudioOutput(host);
      detector.emit("speech_started");
      await settle();
      sttSession.emitTranscript({ segmentId: "segment-1", transcript: "ok", isFinal: false });
      await vi.waitFor(() => expect(host.emitted).toContainEqual(SPEAKING));
      expect(interrupted).toEqual([]);
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "ok but wait",
        isFinal: false,
      });
      await vi.waitFor(() => expect(interrupted).toEqual([VOICE_AGENT_ID]));
    } finally {
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("isAcknowledgementOnly ignores case and punctuation and rejects other words", () => {
    expect(isAcknowledgementOnly("OK!")).toBe(true);
    expect(isAcknowledgementOnly("okay, okay")).toBe(true);
    expect(isAcknowledgementOnly("Tá.")).toBe(true);
    expect(isAcknowledgementOnly("beleza")).toBe(true);
    expect(isAcknowledgementOnly("")).toBe(false);
    expect(isAcknowledgementOnly("okay stop")).toBe(false);
  });

  // CUSTOM(voice-hold-to-talk)
  test("pressing hold interrupts the agent and releasing it ends the utterance", async () => {
    const { voiceSession, sttSession, host, interrupted } = createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    try {
      await voiceSession.handleHold(true);
      expect(interrupted).toEqual([VOICE_AGENT_ID]);
      expect(host.emitted).toContainEqual(SPEAKING);
      expect(sttSession.commitCount).toBe(0);

      await voiceSession.handleHold(false);
      expect(sttSession.commitCount).toBe(1);
      expect(host.emitted).toContainEqual({
        type: "voice_input_state",
        payload: { isSpeaking: false },
      });
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
      sttSession.emitTranscript({
        segmentId: "segment-1",
        transcript: "run the tests",
        isFinal: true,
        isLowConfidence: false,
      });
      await vi.waitFor(() =>
        expect(host.spokenInput).toEqual([{ agentId: VOICE_AGENT_ID, text: "run the tests" }]),
      );
    } finally {
      await voiceSession.cleanup();
    }
  });

  test("the detector's speech stop does not end a held utterance", async () => {
    const { voiceSession, detector, sttSession } = createSpeakingSession(60_000);
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    try {
      await voiceSession.handleHold(true);
      detector.emit("speech_stopped");
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sttSession.commitCount).toBe(0);
      await voiceSession.handleHold(false);
      expect(sttSession.commitCount).toBe(1);
    } finally {
      await voiceSession.cleanup();
    }
  });

  test("session abort stops later audio even when the speak tool supplies its own signal", async () => {
    const tts: TextToSpeechProvider = {
      async synthesizeSpeech() {
        return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
      },
    };
    const { voiceSession, host, speak } = createVoiceSession(tts);
    const external = new AbortController();
    let abortRequested = false;
    const emit = host.emit;
    function acknowledgeLaterAudio(message: SessionOutboundMessage) {
      emit(message);
      if (message.type === "audio_output" && abortRequested)
        voiceSession.handleAudioPlayed(message.payload.id);
    }
    host.emit = acknowledgeLaterAudio;
    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    const playback = speak({
      text: "First sentence. Second sentence. Third sentence.",
      signal: external.signal,
    });
    try {
      await waitForAudioOutput(host);
      abortRequested = true;
      await voiceSession.handleAbort();
      await playback;
      expect(host.emitted.filter(isAudioOutput)).toHaveLength(1);
      expect(external.signal.aborted).toBe(false);
    } finally {
      external.abort();
      await voiceSession.cleanup();
      await playback.catch(() => {});
    }
  });

  test("surfaces a refused voice-mode agent interruption", async () => {
    const { voiceSession, host } = createVoiceSession();
    host.interruptAgentIfRunning = vi.fn(async () => {
      throw new Error("active run cancellation was not acknowledged");
    });

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);

    await expect(voiceSession.handleAbort()).rejects.toThrow(
      "active run cancellation was not acknowledged",
    );
    expect(host.interruptAgentIfRunning).toHaveBeenCalledWith(VOICE_AGENT_ID);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "activity_log",
        payload: expect.objectContaining({
          type: "error",
          content: "Voice interruption failed: active run cancellation was not acknowledged",
          metadata: { voiceAbortFailed: true },
        }),
      }),
    );

    await voiceSession.cleanup();
  });

  test("delivers the streaming final transcript to the agent exactly once", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "ship the streaming final",
      isFinal: true,
      language: "en",
      avgLogprob: -0.1,
      isLowConfidence: false,
    });
    await settle();

    expect(sttSession.commitCount).toBe(1);
    await vi.waitFor(() =>
      expect(host.spokenInput).toEqual([
        { agentId: VOICE_AGENT_ID, text: "ship the streaming final" },
      ]),
    );
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "ship the streaming final",
          language: "en",
          avgLogprob: -0.1,
        }),
      }),
    );

    await voiceSession.cleanup();
  });

  test("emits an empty transcript on finalization timeout without submitting to the agent", async () => {
    vi.useFakeTimers();
    try {
      const { voiceSession, detector, sttSession, host } = createVoiceSession();

      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      detector.emit("speech_started");
      await settle();
      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });

      await vi.advanceTimersByTimeAsync(10_000);
      await settle();

      expect(host.spokenInput).toEqual([]);
      expect(host.emitted).toContainEqual(
        expect.objectContaining({
          type: "transcription_result",
          payload: expect.objectContaining({ text: "" }),
        }),
      );

      await voiceSession.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  test("filters a low-confidence streaming final without submitting to the agent", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "background noise",
      isFinal: true,
      avgLogprob: -2.5,
      isLowConfidence: true,
    });
    await settle();

    expect(host.spokenInput).toEqual([]);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "",
          avgLogprob: -2.5,
          isLowConfidence: true,
        }),
      }),
    );

    await voiceSession.cleanup();
  });
});

describe("VoiceSession voice mode changes while the agent runs", () => {
  test("leaving voice mode waits for the run to end before reloading the agent", async () => {
    vi.useFakeTimers();
    const { voiceSession, host } = createVoiceSession();
    const reloads: Array<string | undefined> = [];
    host.reloadAgentSession = async (agentId, overrides) => {
      reloads.push(overrides.systemPrompt);
      return { id: agentId } as unknown as ManagedAgent;
    };
    try {
      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      expect(reloads).toHaveLength(1);

      let running = true;
      host.hasActiveAgentRun = () => running;
      await voiceSession.handleSetVoiceMode(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(reloads).toHaveLength(1);

      running = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(reloads).toHaveLength(2);
      expect(reloads[1]).toBe(buildVoiceModeSystemPrompt(undefined, false));
    } finally {
      vi.useRealTimers();
      await voiceSession.cleanup();
    }
  });

  test("going back into voice mode before the run ends keeps the voice instructions", async () => {
    vi.useFakeTimers();
    const { voiceSession, host } = createVoiceSession();
    let reloadCount = 0;
    host.reloadAgentSession = async (agentId) => {
      reloadCount += 1;
      return { id: agentId } as unknown as ManagedAgent;
    };
    try {
      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      let running = true;
      host.hasActiveAgentRun = () => running;
      await voiceSession.handleSetVoiceMode(false);
      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      running = false;
      await vi.advanceTimersByTimeAsync(3000);
      expect(reloadCount).toBe(1);
    } finally {
      vi.useRealTimers();
      await voiceSession.cleanup();
    }
  });
});
