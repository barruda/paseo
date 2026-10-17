import { describe, expect, it, vi } from "vitest";
import { WakeDictationController, type WakeDictationPhase } from "./wake-dictation";

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
    expect(copy).toHaveBeenCalledWith("Hello there");
  });

  async function dictate(transcripts: string[]): Promise<string[]> {
    const copied: string[] = [];
    const transcribe = vi.fn<(_chunks: string[]) => Promise<string>>();
    for (const text of transcripts) transcribe.mockResolvedValueOnce(text);
    const controller = new WakeDictationController({
      transcribe,
      copy: async (text) => {
        copied.push(text);
      },
      onPhase: vi.fn(),
      onCopied: vi.fn(),
      onError: vi.fn(),
    });
    for (let i = 0; i < transcripts.length; i++) {
      controller.pushPcm(chunk(3000));
      controller.pushPcm(chunk(0));
      await settle();
    }
    return copied;
  }

  it("ends at a spoken done in the middle of an utterance", async () => {
    await expect(
      dictate(["Wake up.", "I will be talking until 5, 6, done, 8, 7, 9."]),
    ).resolves.toEqual(["I will be talking until 5, 6"]);
  });

  it("ends at done when the recognizer leaves out the comma after it", async () => {
    await expect(
      dictate(["Wake up! So I will be talking until 1, 2, 3, 4, done 5, 6, 7, 8."]),
    ).resolves.toEqual(["So I will be talking until 1, 2, 3, 4"]);
  });

  it("keeps done that is part of a sentence", async () => {
    await expect(
      dictate(["Wake up.", "I'm done with the review.", "Ship it. Done."]),
    ).resolves.toEqual(["I'm done with the review. Ship it."]);
  });

  it("ends at done without any punctuation around it", async () => {
    await expect(
      dictate(["Wake up.", "So I will be talking until 1234 done 5678."]),
    ).resolves.toEqual(["So I will be talking until 1234"]);
  });

  it("keeps done after words that make it part of a sentence", async () => {
    await expect(
      dictate(["Wake up.", "Get it done today, it's done when tests pass, done."]),
    ).resolves.toEqual(["Get it done today, it's done when tests pass"]);
  });

  it("starts again when wake up follows done in the same utterance", async () => {
    await expect(
      dictate(["Wake up, first note. Done. Wake up, second note, done"]),
    ).resolves.toEqual(["first note.", "second note"]);
  });
});
