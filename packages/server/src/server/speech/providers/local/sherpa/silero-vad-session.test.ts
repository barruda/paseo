import { describe, expect, it, vi } from "vitest";

// Scripted Silero: each 512-sample window reports the next value of `detections`.
const detections: boolean[] = [];

vi.mock("./sherpa-onnx-node-loader.js", () => ({
  loadSherpaOnnxNode: () => ({
    Vad: class {
      private current = false;
      acceptWaveform() {
        this.current = detections.shift() ?? false;
      }
      isDetected() {
        return this.current;
      }
      isEmpty() {
        return true;
      }
      flush() {}
      reset() {}
    },
    CircularBuffer: class {
      private samples: number[] = [];
      private start = 0;
      push(input: Float32Array) {
        this.samples.push(...input);
      }
      get(startIndex: number, n: number) {
        const offset = startIndex - this.start;
        return Float32Array.from(this.samples.slice(offset, offset + n));
      }
      pop(n: number) {
        this.samples.splice(0, n);
        this.start += n;
      }
      size() {
        return this.samples.length;
      }
      head() {
        return this.start;
      }
      reset() {
        this.samples = [];
        this.start = 0;
      }
    },
  }),
}));

const { SherpaSileroVadSession } = await import("./silero-vad-session.js");

const WINDOW_MS = 32;

// Feeds `speechMs` of detected speech, then one silent window.
async function speechStartsAfter(speechMs: number, assistantSpeaking: boolean) {
  const session = new SherpaSileroVadSession({ logger: { debug: () => {} } });
  await session.connect();
  session.setAssistantSpeaking(assistantSpeaking);
  const started = vi.fn();
  session.on("speech_started", started);

  const windows = Math.ceil(speechMs / WINDOW_MS);
  detections.length = 0;
  detections.push(...Array<boolean>(windows).fill(true), false);
  // One extra window: the buffer only hands over full windows once it holds more than one.
  session.appendPcm16(Buffer.alloc((windows + 2) * 512 * 2));
  return started.mock.calls.length > 0;
}

describe("SherpaSileroVadSession", () => {
  it("needs 800 ms of speech to start a turn", async () => {
    expect(await speechStartsAfter(500, false)).toBe(false);
    expect(await speechStartsAfter(900, false)).toBe(true);
  });

  it("confirms a short word while the assistant speaks", async () => {
    expect(await speechStartsAfter(200, true)).toBe(false);
    expect(await speechStartsAfter(500, true)).toBe(true);
  });
});
