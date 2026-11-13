import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
// CUSTOM(voice-settings)
import { useThinkingToneStore } from "@/voice/thinking-tone-settings";
import { useHoldToTalkStore } from "@/voice/hold-to-talk-settings";
import { useVoiceHoldKey } from "@/voice/use-voice-hold-key";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSessionStore } from "@/stores/session-store";
import { createAudioEngine } from "@/audio";
// CUSTOM(media-pause)
import { usePauseMediaWhile } from "@/media-pause";
import type { AudioEngine } from "@/audio";
import {
  createVoiceRuntime,
  type VoiceRuntime,
  type VoiceRuntimeSnapshot,
  type VoiceRuntimeTelemetrySnapshot,
} from "@/voice/voice-runtime";

interface VoiceContextValue extends VoiceRuntimeSnapshot {
  startVoice: (serverId: string, agentId: string) => Promise<void>;
  stopVoice: () => Promise<void>;
  isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
  toggleMute: () => void;
  // CUSTOM(voice-reply-mute)
  toggleReplyMute: () => void;
  // CUSTOM(voice-hold-to-talk)
  setHold: (held: boolean) => void;
  supportsHold: boolean;
}

const EMPTY_SNAPSHOT: VoiceRuntimeSnapshot = {
  phase: "disabled",
  isVoiceMode: false,
  isVoiceSwitching: false,
  isMuted: false,
  isReplyMuted: false,
  activeServerId: null,
  activeAgentId: null,
};

const EMPTY_TELEMETRY: VoiceRuntimeTelemetrySnapshot = {
  volume: 0,
  isSpeaking: false,
  segmentDuration: 0,
  liveTranscript: "",
  isHolding: false,
};

const VoiceRuntimeContext = createContext<VoiceRuntime | null>(null);
const VoiceAudioEngineContext = createContext<AudioEngine | null>(null);

const noopSubscribe = () => () => {};
const getEmptySnapshot = () => EMPTY_SNAPSHOT;
const getEmptyTelemetry = () => EMPTY_TELEMETRY;

export function useVoice() {
  const value = useVoiceOptional();
  if (!value) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  return value;
}

export function useVoiceOptional(): VoiceContextValue | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribe : noopSubscribe,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
  );

  // CUSTOM(voice-hold-to-talk): the host takes `voice.set_hold.request`.
  const activeServerId = snapshot.activeServerId;
  const supportsHold = useSessionStore((state) =>
    activeServerId
      ? state.getSession(activeServerId)?.serverInfo?.features?.voiceHold === true
      : false,
  );

  // Methods on the runtime object literal close over factory-local state; they
  // don't use `this`, so no binding is needed. Memoising on [snapshot, runtime]
  // keeps the returned object reference stable across re-renders that don't
  // change either, preventing downstream memo/useMemo misses.
  return useMemo(() => {
    if (!runtime) {
      return null;
    }
    return {
      ...snapshot,
      startVoice: runtime.startVoice,
      stopVoice: runtime.stopVoice,
      isVoiceModeForAgent: runtime.isVoiceModeForAgent,
      toggleMute: runtime.toggleMute,
      toggleReplyMute: runtime.toggleReplyMute,
      setHold: runtime.setHold,
      supportsHold,
    };
  }, [snapshot, runtime, supportsHold]);
}

export function useVoiceTelemetry() {
  const telemetry = useVoiceTelemetryOptional();
  if (!telemetry) {
    throw new Error("useVoiceTelemetry must be used within VoiceProvider");
  }
  return telemetry;
}

export function useVoiceTelemetryOptional(): VoiceRuntimeTelemetrySnapshot | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribeTelemetry.bind(runtime) : noopSubscribe,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
  );

  return runtime ? snapshot : null;
}

export function useVoiceRuntimeOptional(): VoiceRuntime | null {
  return useContext(VoiceRuntimeContext);
}

export function useVoiceAudioEngineOptional(): AudioEngine | null {
  return useContext(VoiceAudioEngineContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const engineRef = useRef<AudioEngine | null>(null);
  const runtimeRef = useRef<VoiceRuntime | null>(null);

  if (!engineRef.current) {
    let runtime: VoiceRuntime | null = null;
    const engine = createAudioEngine({
      onCaptureData: (pcm) => {
        runtime?.handleCapturePcm(pcm);
      },
      onVolumeLevel: (level) => {
        runtime?.handleCaptureVolume(level);
      },
      onInterruption: () => {
        void runtime?.stopVoice().catch((error) => {
          console.error("[VoiceEngine] Failed to stop after audio interruption:", error);
        });
      },
      onError: (error) => {
        console.error("[VoiceEngine] Capture error:", error);
      },
    });

    runtime = createVoiceRuntime({
      engine,
      getServerInfo: (serverId) =>
        useSessionStore.getState().getSession(serverId)?.serverInfo ?? null,
      activateKeepAwake: async (tag) => {
        await activateKeepAwakeAsync(tag);
      },
      deactivateKeepAwake: async (tag) => {
        await deactivateKeepAwake(tag);
      },
      // CUSTOM(voice-settings)
      getThinkingTone: () => useThinkingToneStore.getState(),
      // CUSTOM(voice-hold-to-talk)
      getHoldToTalkOnly: () => useHoldToTalkStore.getState().holdToTalkOnly,
    });

    engineRef.current = engine;
    runtimeRef.current = runtime;
  }

  const engine = engineRef.current;
  const runtime = runtimeRef.current!;
  // CUSTOM(media-pause): music and videos pause for the whole voice session.
  const isVoiceMode = useSyncExternalStore(
    runtime.subscribe,
    () => runtime.getSnapshot().isVoiceMode,
    () => runtime.getSnapshot().isVoiceMode,
  );
  usePauseMediaWhile(isVoiceMode);
  // CUSTOM(voice-hold-to-talk)
  useVoiceHoldKey(runtime);

  useEffect(() => {
    return () => {
      void runtime.destroy().catch((error) => {
        console.error("[VoiceProvider] Failed to destroy voice runtime", error);
      });
    };
  }, [runtime]);

  return (
    <VoiceAudioEngineContext.Provider value={engine}>
      <VoiceRuntimeContext.Provider value={runtime}>{children}</VoiceRuntimeContext.Provider>
    </VoiceAudioEngineContext.Provider>
  );
}
