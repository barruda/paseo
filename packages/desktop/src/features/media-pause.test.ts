import { describe, expect, it } from "vitest";
import { createMediaDucker, type AudioStreams } from "./media-pause";

interface FakeStream {
  own?: boolean;
  volume: number | null;
}

function fakeStreams(initial: Record<number, FakeStream>) {
  const streams = new Map(Object.entries(initial).map(([id, stream]) => [Number(id), stream]));
  const calls: string[] = [];
  const audio: AudioStreams = {
    listPlaying: async () => [...streams].map(([id, { own }]) => ({ id, own: own === true })),
    getVolume: async (id) => streams.get(id)?.volume ?? null,
    setVolume: async (id, volume) => {
      calls.push(`${id}=${volume.toFixed(2)}`);
      streams.get(id)!.volume = volume;
    },
  };
  return { audio, streams, calls };
}

describe("media ducking", () => {
  it("turns other apps down to a tenth and restores them, leaving Paseo and muted streams", async () => {
    const { audio, streams, calls } = fakeStreams({
      1: { volume: 0.8 },
      2: { own: true, volume: 1 },
      3: { volume: null },
    });
    const ducker = createMediaDucker(audio, 0);
    await ducker.setActive(1, true);
    expect(calls).toEqual(["1=0.08"]);
    await ducker.setActive(1, false);
    expect(calls).toEqual(["1=0.08", "1=0.80"]);
    expect(streams.get(2)!.volume).toBe(1);
  });

  it("waits for the last holder before restoring", async () => {
    const { audio, calls } = fakeStreams({ 1: { volume: 1 } });
    const ducker = createMediaDucker(audio, 0);
    await ducker.setActive(1, true);
    await ducker.setActive(2, true);
    await ducker.setActive(1, false);
    expect(calls).toEqual(["1=0.10"]);
    await ducker.setActive(2, false);
    expect(calls).toEqual(["1=0.10", "1=1.00"]);
  });

  it("keeps the volume the user set meanwhile", async () => {
    const { audio, streams, calls } = fakeStreams({ 1: { volume: 1 } });
    const ducker = createMediaDucker(audio, 0);
    await ducker.setActive(1, true);
    streams.get(1)!.volume = 0.5;
    await ducker.setActive(1, false);
    expect(calls).toEqual(["1=0.10"]);
  });

  it("keeps media ducked when a new holder arrives during the restore delay", async () => {
    const { audio, calls } = fakeStreams({ 1: { volume: 1 } });
    const ducker = createMediaDucker(audio, 20);
    await ducker.setActive(1, true);
    const restoring = ducker.setActive(1, false);
    await ducker.setActive(2, true);
    await restoring;
    expect(calls).toEqual(["1=0.10"]);
    await ducker.setActive(2, false);
    expect(calls).toEqual(["1=0.10", "1=1.00"]);
  });

  it("keeps ducking other streams when one fails", async () => {
    const { audio, calls } = fakeStreams({
      1: { volume: 1 },
      2: { volume: 1 },
    });
    const ducker = createMediaDucker(
      {
        ...audio,
        setVolume: async (id, volume) => {
          if (id === 1) throw new Error("gone");
          await audio.setVolume(id, volume);
        },
      },
      0,
    );
    await ducker.setActive(1, true);
    await ducker.setActive(1, false);
    expect(calls).toEqual(["2=0.10", "2=1.00"]);
  });
});
