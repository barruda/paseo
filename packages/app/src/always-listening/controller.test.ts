import { describe, expect, it, vi } from "vitest";
import { WakeDictationController, type WakeDictationPhase } from "./controller";

function chunk(value: number): string {
  const samples = new Int16Array(16000);
  samples.fill(value);
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WakeDictationController", () => {
  it("arms, wakes, copies text on done, and rearms", async () => {
    const phases: WakeDictationPhase[] = [];
    const copy = vi.fn(async () => {});
    const transcribe = vi
      .fn<(_chunks: string[]) => Promise<string>>()
      .mockResolvedValueOnce("other words")
      .mockResolvedValueOnce("Wake up!")
      .mockResolvedValueOnce("Write a short note")
      .mockResolvedValueOnce("and send it. Done.");
    const controller = new WakeDictationController({
      transcribe,
      copy,
      onPhase: (phase) => phases.push(phase),
      onCopied: vi.fn(),
      onError: vi.fn(),
    });
    for (let i = 0; i < 4; i++) {
      controller.pushPcm(chunk(3000));
      controller.pushPcm(chunk(0));
      await settle();
    }
    expect(copy).toHaveBeenCalledWith("Write a short note and send it.");
    expect(phases).toEqual([
      "armed",
      "processing",
      "armed",
      "processing",
      "capturing",
      "processing",
      "capturing",
      "processing",
      "armed",
    ]);
  });

  it("does not transcribe silence or copy after stop", async () => {
    const copy = vi.fn(async () => {});
    let resolve!: (value: string) => void;
    const controller = new WakeDictationController({
      transcribe: () => new Promise((done) => (resolve = done)),
      copy,
      onPhase: vi.fn(),
      onCopied: vi.fn(),
      onError: vi.fn(),
    });
    controller.pushPcm(chunk(0));
    controller.pushPcm(chunk(3000));
    controller.pushPcm(chunk(0));
    controller.stop();
    resolve("Wake up! done");
    await settle();
    expect(copy).not.toHaveBeenCalled();
  });

  it("keeps speech arriving while the wake phrase is being transcribed", async () => {
    let resolveWake!: (value: string) => void;
    const copy = vi.fn(async () => {});
    const transcribe = vi
      .fn<(_chunks: string[]) => Promise<string>>()
      .mockImplementationOnce(() => new Promise((done) => (resolveWake = done)))
      .mockResolvedValueOnce("Hello there, done");
    const controller = new WakeDictationController({
      transcribe,
      copy,
      onPhase: vi.fn(),
      onCopied: vi.fn(),
      onError: vi.fn(),
    });
    controller.pushPcm(chunk(3000));
    controller.pushPcm(chunk(0));
    controller.pushPcm(chunk(3000));
    controller.pushPcm(chunk(0));
    resolveWake("Wake up");
    await settle();
    expect(copy).toHaveBeenCalledWith("Hello there,");
  });
});
