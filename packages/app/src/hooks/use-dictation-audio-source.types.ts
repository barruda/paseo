export interface DictationAudioSourceConfig {
  onPcmSegment: (pcm16Base64: string) => void;
  onError?: (error: Error) => void;
  onInterruption?: () => void;
}

export interface DictationAudioSource {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  volume: number;
  isPaused: boolean;
  // CUSTOM(dictation-live-mic): false from start() until the microphone delivers audio.
  isLive: boolean;
}
