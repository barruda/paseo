// CUSTOM(dictation-live-mic): when a microphone really delivers audio. Some microphones, like
// Bluetooth speakerphones, open and then send about a second of exact digital silence before
// the first real sample; dictation shows the recording look only once audio flows.

// Float samples; digital silence is exactly 0, so anything above this is signal.
export const MIC_LIVE_THRESHOLD = 1e-4;
// A working but truly silent microphone must not stay in the warming state.
export const MIC_LIVE_FALLBACK_MS = 2500;

export function blockHasSignal(block: ArrayLike<number>, threshold = MIC_LIVE_THRESHOLD): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (Math.abs(block[i]) > threshold) return true;
  }
  return false;
}

export interface MicLiveDetector {
  // Starts the fallback timer; call when the stream opens.
  start: () => void;
  // Reports one block of input samples.
  feed: (block: ArrayLike<number>) => void;
  // Marks the microphone live now, for sources that can't tell.
  markLive: () => void;
  dispose: () => void;
}

export function createMicLiveDetector(
  onLive: () => void,
  fallbackMs: number = MIC_LIVE_FALLBACK_MS,
): MicLiveDetector {
  let live = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const markLive = () => {
    if (live) return;
    live = true;
    clear();
    onLive();
  };
  return {
    start: () => {
      if (live || timer !== null) return;
      timer = setTimeout(markLive, fallbackMs);
    },
    feed: (block) => {
      if (!live && blockHasSignal(block)) markLive();
    },
    markLive,
    // Disposing before live never reports it.
    dispose: () => {
      live = true;
      clear();
    },
  };
}
