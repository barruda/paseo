import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import type { AudioEngine } from "@/audio";
import { createVoiceRuntime, type VoiceSessionAdapter } from "@/voice/voice-runtime";
import { REALTIME_VOICE_VAD_CONFIG } from "@/voice/realtime-voice-config";
import { DEFAULT_THINKING_TONE, type ThinkingToneSettings } from "@/voice/thinking-tone-settings";

const CUE_MIME_TYPE = "audio/pcm;rate=16000;bits=16";
const THINKING_TONE_MIN_SILENCE_MS = 1500;
const SEGMENT_MIME_TYPE = "audio/pcm;rate=24000;bits=16";

function createAudioEngineMock(): AudioEngine {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    startCapture: vi.fn().mockResolvedValue(undefined),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    toggleMute: vi.fn().mockReturnValue(true),
    isMuted: vi.fn().mockReturnValue(false),
    play: vi.fn().mockResolvedValue(0.1),
    stop: vi.fn(),
    clearQueue: vi.fn(),
    isPlaying: vi.fn().mockReturnValue(false),
  };
}

function createSessionAdapter(serverId = "server-1"): VoiceSessionAdapter {
  return {
    serverId,
    setVoiceMode: vi.fn().mockResolvedValue(undefined),
    sendVoiceAudioChunk: vi.fn().mockResolvedValue(undefined),
    audioPlayed: vi.fn().mockResolvedValue(undefined),
    abortRequest: vi.fn().mockResolvedValue(undefined),
    setAssistantAudioPlaying: vi.fn(),
  };
}

function createAudioPayload(args: {
  id: string;
  groupId: string;
  chunkIndex: number;
  isLastChunk: boolean;
  isVoiceMode?: boolean;
  utteranceId?: string;
}) {
  return {
    id: args.id,
    groupId: args.groupId,
    chunkIndex: args.chunkIndex,
    isLastChunk: args.isLastChunk,
    isVoiceMode: args.isVoiceMode ?? true,
    utteranceId: args.utteranceId,
    format: "pcm",
    audio: Buffer.from(`chunk-${args.chunkIndex}`).toString("base64"),
  } as const;
}

function createServerInfo(): DaemonServerInfo {
  return {
    serverId: "server-1",
    hostname: "host",
    version: "1.0.0",
    capabilities: {
      voice: {
        dictation: { enabled: true, reason: "" },
        voice: { enabled: true, reason: "" },
      },
    },
  };
}

function createRuntime(options?: {
  engine?: AudioEngine;
  getServerInfo?: (serverId: string) => DaemonServerInfo | null;
  getThinkingTone?: () => ThinkingToneSettings;
}) {
  const engine = options?.engine ?? createAudioEngineMock();
  const runtime = createVoiceRuntime({
    engine,
    getServerInfo: options?.getServerInfo ?? (() => createServerInfo()),
    activateKeepAwake: vi.fn().mockResolvedValue(undefined),
    deactivateKeepAwake: vi.fn().mockResolvedValue(undefined),
    getThinkingTone: options?.getThinkingTone,
  });

  return { runtime, engine };
}

describe("voice runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts voice when adapter is ready", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");

    expect(engine.initialize).toHaveBeenCalled();
    expect(adapter.setVoiceMode).toHaveBeenCalledWith(true, "agent-1");
    expect(engine.startCapture).toHaveBeenCalled();
    expect(runtime.getSnapshot()).toMatchObject({
      phase: "listening",
      isVoiceMode: true,
      activeServerId: "server-1",
      activeAgentId: "agent-1",
    });
  });

  it("streams continuous PCM chunks and waits after receiving a transcript", async () => {
    const adapter = createSessionAdapter();
    const { runtime } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.handleCapturePcm(new Uint8Array(32000));
    expect(runtime.getSnapshot().phase).toBe("listening");

    expect(adapter.sendVoiceAudioChunk).toHaveBeenLastCalledWith(
      expect.any(String),
      "audio/pcm;rate=16000;bits=16",
    );

    runtime.onTranscriptionResult("server-1", "hello");
    expect(runtime.getSnapshot().phase).toBe("waiting");
  });

  it("moves from listening to playing on the first assistant audio", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine: _engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onAssistantAudioStarted("server-1");

    expect(runtime.getSnapshot().phase).toBe("playing");
    expect(adapter.setAssistantAudioPlaying).toHaveBeenCalledWith(true);
  });

  it("starts playback on the first chunk before isLastChunk arrives", async () => {
    const adapter = createSessionAdapter();
    let resolvePlay!: (duration: number) => void;
    const engine = createAudioEngineMock();
    vi.mocked(engine.play).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    vi.mocked(engine.play).mockClear();

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-0",
        groupId: "group-1",
        chunkIndex: 0,
        isLastChunk: false,
      }),
    );

    await vi.waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1);
      expect(runtime.getSnapshot().phase).toBe("playing");
      expect(adapter.audioPlayed).not.toHaveBeenCalled();
    });

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-1",
        groupId: "group-1",
        chunkIndex: 1,
        isLastChunk: true,
      }),
    );

    expect(engine.play).toHaveBeenCalledTimes(1);
    resolvePlay(0.1);

    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("chunk-0");
      expect(engine.play).toHaveBeenCalledTimes(2);
    });
  });

  it("acknowledges chunks only after they are consumed and finishes after the final chunk", async () => {
    const adapter = createSessionAdapter();
    const playResolvers: Array<(duration: number) => void> = [];
    const engine = createAudioEngineMock();
    vi.mocked(engine.play).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          playResolvers.push(resolve);
        }),
    );
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    vi.mocked(engine.play).mockClear();
    playResolvers.length = 0;

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-0",
        groupId: "group-1",
        chunkIndex: 0,
        isLastChunk: false,
      }),
    );
    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-1",
        groupId: "group-1",
        chunkIndex: 1,
        isLastChunk: true,
      }),
    );

    await vi.waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1);
    });
    expect(adapter.audioPlayed).not.toHaveBeenCalled();

    playResolvers.shift()!(0.1);
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("chunk-0");
      expect(engine.play).toHaveBeenCalledTimes(2);
    });

    playResolvers.shift()!(0.1);
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("chunk-1");
      expect(runtime.getSnapshot().phase).toBe("waiting");
    });
  });

  it("leaves playback phase unchanged after assistant playback while the turn is still active", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    runtime.onAssistantAudioStarted("server-1");
    runtime.onAssistantAudioFinished("server-1");

    expect(runtime.getSnapshot().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(THINKING_TONE_MIN_SILENCE_MS);
    expect(engine.play).toHaveBeenCalled();
  });

  it("starts the thinking tone once the wait for a reply outlasts an inter-segment gap", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");

    expect(runtime.getSnapshot().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(THINKING_TONE_MIN_SILENCE_MS - 1);
    expect(engine.play).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(engine.play).toHaveBeenCalled();
  });

  it("waits the configured silence between thinking tones, and plays none when off", async () => {
    const adapter = createSessionAdapter();
    let tone: ThinkingToneSettings = { ...DEFAULT_THINKING_TONE, intervalSeconds: 5 };
    const { runtime, engine } = createRuntime({ getThinkingTone: () => tone });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    await vi.advanceTimersByTimeAsync(THINKING_TONE_MIN_SILENCE_MS);
    expect(engine.play).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(engine.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.play).toHaveBeenCalledTimes(2);

    tone = { ...tone, enabled: false };
    runtime.onTurnEvent("server-1", "agent-1", "turn_completed");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(engine.play).toHaveBeenCalledTimes(2);
  });

  it("does not restart the thinking tone from local detection jitter while waiting", async () => {
    const adapter = createSessionAdapter();
    let resolvePlay!: (duration: number) => void;
    const engine = createAudioEngineMock();
    vi.mocked(engine.play).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");

    expect(runtime.getSnapshot().phase).toBe("waiting");
    await vi.advanceTimersByTimeAsync(THINKING_TONE_MIN_SILENCE_MS);
    expect(engine.play).toHaveBeenCalledTimes(1);
    vi.mocked(engine.stop).mockClear();
    vi.mocked(engine.clearQueue).mockClear();

    runtime.handleCaptureVolume(REALTIME_VOICE_VAD_CONFIG.volumeThreshold + 0.05);
    runtime.handleCaptureVolume(0);

    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.clearQueue).not.toHaveBeenCalled();
    expect(engine.play).toHaveBeenCalledTimes(1);

    runtime.onServerSpeechStateChanged("server-1", true);

    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.clearQueue).not.toHaveBeenCalled();
    expect(vi.mocked(engine.play).mock.calls[0][1]?.aborted).toBe(true);

    resolvePlay(0.1);
  });

  it("does not play the thinking tone in the gap between two segments of one reply", async () => {
    const adapter = createSessionAdapter();
    const engine = createAudioEngineMock();
    const played: string[] = [];
    vi.mocked(engine.play).mockImplementation(async (source: { type: string }) => {
      played.push(source.type);
      return 0.1;
    });
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "seg-1-chunk-0",
        groupId: "seg-1",
        chunkIndex: 0,
        isLastChunk: true,
      }),
    );
    await vi.waitFor(() => {
      expect(runtime.getSnapshot().phase).toBe("waiting");
    });

    await vi.advanceTimersByTimeAsync(400);

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "seg-2-chunk-0",
        groupId: "seg-2",
        chunkIndex: 0,
        isLastChunk: true,
      }),
    );
    await vi.waitFor(() => {
      expect(played).toContain(SEGMENT_MIME_TYPE);
    });

    const replyStart = played.indexOf(SEGMENT_MIME_TYPE);
    expect(replyStart).toBeGreaterThanOrEqual(0);
    expect(played.slice(replyStart).filter((type) => type === CUE_MIME_TYPE)).toEqual([]);
  });

  it("returns to listening after assistant playback once the turn is complete", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    await vi.advanceTimersByTimeAsync(THINKING_TONE_MIN_SILENCE_MS);
    runtime.onAssistantAudioStarted("server-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_completed");
    runtime.onAssistantAudioFinished("server-1");

    expect(runtime.getSnapshot().phase).toBe("listening");
    expect(engine.play).toHaveBeenCalled();
  });

  it("keeps local volume alone non-authoritative for playback interruption", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    runtime.onAssistantAudioStarted("server-1");
    vi.mocked(engine.stop).mockClear();
    vi.mocked(engine.clearQueue).mockClear();

    runtime.handleCaptureVolume(0.5);
    expect(runtime.getTelemetrySnapshot().isSpeaking).toBe(false);
    expect(adapter.abortRequest).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().phase).toBe("playing");
  });

  it("keeps the meter white state driven by server speech detection", async () => {
    const adapter = createSessionAdapter();
    const { runtime } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.handleCaptureVolume(0.7);

    expect(runtime.getTelemetrySnapshot()).toMatchObject({
      volume: expect.any(Number),
      isSpeaking: false,
    });

    runtime.onServerSpeechStateChanged("server-1", true);
    expect(runtime.getTelemetrySnapshot().isSpeaking).toBe(true);

    runtime.onServerSpeechStateChanged("server-1", false);
    expect(runtime.getTelemetrySnapshot().isSpeaking).toBe(false);
  });

  it("stops assistant playback immediately when server speech starts", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onAssistantAudioStarted("server-1");

    runtime.onServerSpeechStateChanged("server-1", true);

    expect(engine.stop).toHaveBeenCalled();
    expect(engine.clearQueue).toHaveBeenCalled();
    expect(adapter.setAssistantAudioPlaying).toHaveBeenCalledWith(false);
    expect(runtime.getTelemetrySnapshot().isSpeaking).toBe(true);
  });

  it("drops queued voice chunks that arrive after server speech interrupts playback", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    vi.mocked(engine.play).mockClear();

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-0",
        groupId: "group-1",
        chunkIndex: 0,
        isLastChunk: false,
      }),
    );
    await vi.waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1);
    });

    runtime.onServerSpeechStateChanged("server-1", true);
    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "chunk-1",
        groupId: "group-1",
        chunkIndex: 1,
        isLastChunk: true,
      }),
    );

    expect(engine.stop).toHaveBeenCalled();
    expect(engine.clearQueue).toHaveBeenCalled();
    expect(vi.mocked(adapter.audioPlayed).mock.calls.flat()).not.toContain("chunk-1");
  });

  it("muting replies cuts the sentence playing and confirms the rest of the message unplayed", async () => {
    const adapter = createSessionAdapter();
    const engine = createAudioEngineMock();
    let rejectPlay: ((error: Error) => void) | null = null;
    vi.mocked(engine.play).mockImplementation(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectPlay = reject;
        }),
    );
    vi.mocked(engine.stop).mockImplementation(() => {
      rejectPlay?.(new Error("Playback stopped"));
    });
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    vi.mocked(engine.play).mockClear();

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "s0:0",
        groupId: "s0",
        chunkIndex: 0,
        isLastChunk: true,
        utteranceId: "message-1",
      }),
    );
    await vi.waitFor(() => {
      expect(runtime.getSnapshot().phase).toBe("playing");
    });

    runtime.toggleReplyMute();

    expect(runtime.getSnapshot().isReplyMuted).toBe(true);
    expect(engine.stop).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("s0:0");
      expect(runtime.getSnapshot().phase).toBe("waiting");
    });

    runtime.handleAudioOutput(
      "server-1",
      createAudioPayload({
        id: "s1:0",
        groupId: "s1",
        chunkIndex: 0,
        isLastChunk: true,
        utteranceId: "message-1",
      }),
    );
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("s1:0");
    });
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("unmuting replies speaks again from the agent's next message", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.onTurnEvent("server-1", "agent-1", "turn_started");
    vi.mocked(engine.play).mockClear();
    runtime.toggleReplyMute();

    const sentence = (groupId: string, utteranceId: string) =>
      runtime.handleAudioOutput(
        "server-1",
        createAudioPayload({
          id: `${groupId}:0`,
          groupId,
          chunkIndex: 0,
          isLastChunk: true,
          utteranceId,
        }),
      );

    sentence("s0", "message-1");
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("s0:0");
    });

    runtime.toggleReplyMute();
    expect(runtime.getSnapshot().isReplyMuted).toBe(false);

    sentence("s1", "message-1");
    await vi.waitFor(() => {
      expect(adapter.audioPlayed).toHaveBeenCalledWith("s1:0");
    });
    expect(engine.play).not.toHaveBeenCalled();

    sentence("s2", "message-2");
    await vi.waitFor(() => {
      expect(engine.play).toHaveBeenCalledTimes(1);
      expect(adapter.audioPlayed).toHaveBeenCalledWith("s2:0");
    });
  });

  it("starts each voice session with replies audible", async () => {
    const adapter = createSessionAdapter();
    const { runtime } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    runtime.toggleReplyMute();
    await runtime.stopVoice();
    await runtime.startVoice("server-1", "agent-1");

    expect(runtime.getSnapshot().isReplyMuted).toBe(false);
  });

  it("authoritatively stops and suppresses later voice audio", async () => {
    const adapter = createSessionAdapter();
    const { runtime, engine } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    await runtime.stopVoice();

    expect(adapter.setVoiceMode).toHaveBeenLastCalledWith(false);
    expect(engine.stopCapture).toHaveBeenCalled();
    expect(runtime.getSnapshot().phase).toBe("disabled");
    expect(runtime.shouldPlayVoiceAudio("server-1")).toBe(false);
  });

  it("rolls daemon voice mode back when capture fails after enabling it", async () => {
    const adapter = createSessionAdapter();
    const engine = createAudioEngineMock();
    vi.mocked(engine.startCapture).mockRejectedValue(new Error("audio focus unavailable"));
    const { runtime } = createRuntime({ engine });
    runtime.registerSession(adapter);

    await expect(runtime.startVoice("server-1", "agent-1")).rejects.toThrow(
      "audio focus unavailable",
    );

    expect(adapter.setVoiceMode).toHaveBeenNthCalledWith(1, true, "agent-1");
    expect(adapter.setVoiceMode).toHaveBeenNthCalledWith(2, false);
    expect(runtime.getSnapshot().phase).toBe("disabled");
  });

  it("returns an explicit not-ready error when the adapter is missing", async () => {
    const { runtime } = createRuntime();
    await expect(runtime.startVoice("server-1", "agent-1")).rejects.toThrow(
      "Voice runtime is not ready for host server-1",
    );
  });

  it("resyncs voice mode after connection recovers", async () => {
    const adapter = createSessionAdapter();
    const { runtime } = createRuntime();
    runtime.registerSession(adapter);

    await runtime.startVoice("server-1", "agent-1");
    vi.mocked(adapter.setVoiceMode).mockClear();

    runtime.updateSessionConnection("server-1", false);
    runtime.updateSessionConnection("server-1", true);
    await Promise.resolve();

    expect(adapter.setVoiceMode).toHaveBeenCalledWith(true, "agent-1");
  });

  it("does not emit when the snapshot is unchanged", async () => {
    const adapter = createSessionAdapter();
    const { runtime } = createRuntime();
    runtime.registerSession(adapter);
    await runtime.startVoice("server-1", "agent-1");

    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    runtime.handleCaptureVolume(0);
    runtime.handleCaptureVolume(0);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
