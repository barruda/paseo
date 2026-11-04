import { describe, expect, it, vi } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { DictationStreamSender } from "@/dictation/dictation-stream-sender";

interface FakeFinish {
  dictationId: string;
  finalSeq: number;
}
interface FakeStart {
  dictationId: string;
  format: string;
}
interface FakeChunk {
  dictationId: string;
  seq: number;
  audio: string;
  format: string;
}

interface FakeAck {
  type: "dictation_stream_ack";
  payload: {
    dictationId: string;
    ackSeq: number;
  };
}

type FakeRawMessageListener = (message: SessionOutboundMessage) => void;

class FakeDaemonClient {
  isConnected = true;
  autoAck = true;
  throwOnNextChunk = false;
  disconnectOnChunkError = false;
  starts: FakeStart[] = [];
  chunks: FakeChunk[] = [];
  finishes: FakeFinish[] = [];
  cancels: string[] = [];
  private readonly rawMessageListeners = new Set<FakeRawMessageListener>();

  get rawMessageListenerCount(): number {
    return this.rawMessageListeners.size;
  }

  async startDictationStream(dictationId: string, format: string): Promise<void> {
    this.starts.push({ dictationId, format });
  }

  sendDictationStreamChunk(dictationId: string, seq: number, audio: string, format: string): void {
    if (this.throwOnNextChunk) {
      this.throwOnNextChunk = false;
      if (this.disconnectOnChunkError) {
        this.isConnected = false;
      }
      throw new Error("WebSocket is closing");
    }
    this.chunks.push({ dictationId, seq, audio, format });
    if (this.autoAck) {
      this.emitAck(dictationId, seq);
    }
  }

  subscribeRawMessages(handler: FakeRawMessageListener): () => void {
    this.rawMessageListeners.add(handler);
    return () => this.rawMessageListeners.delete(handler);
  }

  setConnected(isConnected: boolean): void {
    this.isConnected = isConnected;
  }

  emitStreamError(dictationId: string, retryable: boolean): void {
    const message = {
      type: "dictation_stream_error",
      payload: { dictationId, error: "Local speech worker exited", retryable },
    } as SessionOutboundMessage;
    for (const listener of this.rawMessageListeners) {
      listener(message);
    }
  }

  emitAck(dictationId: string, ackSeq: number): void {
    const message: FakeAck = {
      type: "dictation_stream_ack",
      payload: { dictationId, ackSeq },
    };
    for (const listener of this.rawMessageListeners) {
      listener(message);
    }
  }

  async finishDictationStream(
    dictationId: string,
    finalSeq: number,
  ): Promise<{ dictationId: string; text: string }> {
    this.finishes.push({ dictationId, finalSeq });
    return { dictationId, text: "ok" };
  }

  cancelDictationStream(dictationId: string): void {
    this.cancels.push(dictationId);
  }
}

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const promiseOutcome = async <T>(promise: Promise<T>, timeoutMs: number) => {
  return Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), timeoutMs)),
  ]);
};

let nextId = 0;
const chunksOf = (client: FakeDaemonClient, dictationId: string | null) =>
  client.chunks.filter((chunk) => chunk.dictationId === dictationId);
const startedSender = async (onStreamInterrupted = vi.fn()) => {
  const client = new FakeDaemonClient();
  const sender = new DictationStreamSender({
    client,
    format: "audio/pcm;rate=16000;bits=16",
    createDictationId: () => `dictation-${(nextId += 1)}`,
    onStreamInterrupted,
  });
  await sender.restartStream("start");
  return { client, sender, onStreamInterrupted };
};

// CUSTOM(dictation-live-text)
describe("a stream that dies while recording", () => {
  it("reports it and replays every captured segment on a new stream", async () => {
    const { client, sender, onStreamInterrupted } = await startedSender();
    sender.enqueueSegment("a");
    sender.enqueueSegment("b");
    const deadId = sender.getDictationId()!;

    client.emitStreamError(deadId, true);
    await tick();
    sender.enqueueSegment("c");

    expect(onStreamInterrupted).toHaveBeenCalledTimes(1);
    expect(onStreamInterrupted.mock.calls[0][0].message).toBe("Local speech worker exited");
    expect(sender.getDictationId()).not.toBe(deadId);
    const replayed = chunksOf(client, sender.getDictationId());
    expect(replayed.map((c) => [c.seq, c.audio])).toEqual([
      [0, "a"],
      [1, "b"],
      [2, "c"],
    ]);
  });

  it("ignores errors from a stream it already left", async () => {
    const { client, sender, onStreamInterrupted } = await startedSender();
    const currentId = sender.getDictationId();

    client.emitStreamError("some-other-stream", true);
    await tick();

    expect(onStreamInterrupted).not.toHaveBeenCalled();
    expect(sender.getDictationId()).toBe(currentId);
  });

  it("stops sending after a permanent error, keeps the audio, and finish still delivers it", async () => {
    const { client, sender } = await startedSender();
    sender.enqueueSegment("a");

    client.emitStreamError(sender.getDictationId()!, false);
    await tick();
    const startsAfterError = client.starts.length;
    const chunksAfterError = client.chunks.length;
    sender.enqueueSegment("b");
    await tick();

    expect(client.starts.length).toBe(startsAfterError);
    expect(client.chunks.length).toBe(chunksAfterError);
    expect(sender.getSegmentCount()).toBe(2);

    await expect(sender.finish(sender.getFinalSeq())).resolves.toMatchObject({ text: "ok" });
    const delivered = chunksOf(client, client.finishes[0].dictationId);
    expect(delivered.map((c) => c.audio)).toEqual(["a", "b"]);
  });

  it("gives up replaying when the stream keeps dying", async () => {
    const { client, sender } = await startedSender();
    sender.enqueueSegment("a");

    for (let attempt = 0; attempt < 10 && sender.getDictationId(); attempt += 1) {
      client.emitStreamError(sender.getDictationId()!, true);
      await tick();
    }

    // One start for the recording plus at most three restarts.
    expect(client.starts.length).toBe(4);
    expect(sender.getDictationId()).toBeNull();
    expect(sender.getSegmentCount()).toBe(1);
  });

  it("leaves an error during finish to the finish call", async () => {
    const { client, sender, onStreamInterrupted } = await startedSender();
    sender.enqueueSegment("a");
    const id = sender.getDictationId()!;
    let resolveFinish: (value: { dictationId: string; text: string }) => void = () => undefined;
    client.finishDictationStream = () =>
      new Promise((resolve) => {
        resolveFinish = resolve;
      });

    const finishing = sender.finish(sender.getFinalSeq());
    await tick();
    client.emitStreamError(id, true);
    await tick();

    expect(onStreamInterrupted).not.toHaveBeenCalled();
    expect(client.starts.length).toBe(1);
    resolveFinish({ dictationId: id, text: "done" });
    await expect(finishing).resolves.toMatchObject({ text: "done" });
  });
});

describe("DictationStreamSender", () => {
  it("enqueues segments and sends them after stream start", async () => {
    const client = new FakeDaemonClient();
    const ids = ["d1"];
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => ids.shift() ?? "dX",
    });

    sender.enqueueSegment("seg0");
    sender.enqueueSegment("seg1");

    await tick();

    expect(client.starts).toEqual([{ dictationId: "d1", format: "audio/pcm;rate=16000;bits=16" }]);
    expect(client.chunks).toEqual([
      { dictationId: "d1", seq: 0, audio: "seg0", format: "audio/pcm;rate=16000;bits=16" },
      { dictationId: "d1", seq: 1, audio: "seg1", format: "audio/pcm;rate=16000;bits=16" },
    ]);
  });

  it("restarts stream and resends from seq=0 on reconnect", async () => {
    const client = new FakeDaemonClient();
    const ids = ["d1", "d2"];
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => ids.shift() ?? "dX",
    });

    sender.enqueueSegment("seg0");
    sender.enqueueSegment("seg1");
    await tick();

    await sender.restartStream("reconnect");

    expect(client.starts.map((s) => s.dictationId)).toEqual(["d1", "d2"]);
    const d2Chunks = client.chunks.filter((c) => c.dictationId === "d2");
    expect(d2Chunks.map((c) => [c.seq, c.audio])).toEqual([
      [0, "seg0"],
      [1, "seg1"],
    ]);
  });

  it("finish flushes all queued segments and sends finish with finalSeq", async () => {
    const client = new FakeDaemonClient();
    const ids = ["d1"];
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => ids.shift() ?? "dX",
    });

    sender.enqueueSegment("seg0");
    sender.enqueueSegment("seg1");

    const finalSeq = sender.getFinalSeq();
    const result = await sender.finish(finalSeq);

    expect(result.text).toBe("ok");
    expect(client.chunks.map((c) => c.seq)).toEqual([0, 1]);
    expect(client.finishes).toEqual([{ dictationId: "d1", finalSeq: 1 }]);
  });

  it("keeps segments while disconnected and sends them after restart when reconnected", async () => {
    const client = new FakeDaemonClient();
    client.isConnected = false;
    const ids = ["d1"];
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => ids.shift() ?? "dX",
    });

    sender.enqueueSegment("seg0");
    sender.enqueueSegment("seg1");

    expect(client.starts).toHaveLength(0);
    expect(client.chunks).toHaveLength(0);

    client.isConnected = true;
    await sender.restartStream("reconnect");

    expect(client.chunks.map((c) => c.seq)).toEqual([0, 1]);
  });

  it("keeps capture safe and buffers later segments when a chunk send throws", async () => {
    const client = new FakeDaemonClient();
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => "d1",
    });

    sender.enqueueSegment("before-outage");
    await tick();

    client.throwOnNextChunk = true;
    client.disconnectOnChunkError = true;

    expect(() => sender.enqueueSegment("during-outage")).not.toThrow();
    expect(() => sender.enqueueSegment("after-outage")).not.toThrow();
    expect(sender.getSegmentCount()).toBe(3);
  });

  it("removes its raw-message listener when disposed", () => {
    const client = new FakeDaemonClient();
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
    });

    expect(client.rawMessageListenerCount).toBe(1);
    sender.dispose();
    expect(client.rawMessageListenerCount).toBe(0);
  });

  it("replays segments captured before, during, and after an outage from seq 0", async () => {
    const client = new FakeDaemonClient();
    const ids = ["d1", "d2"];
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => ids.shift() ?? "dX",
    });

    sender.enqueueSegment("before-outage");
    await tick();

    client.throwOnNextChunk = true;
    client.disconnectOnChunkError = true;
    expect(() => sender.enqueueSegment("during-outage")).not.toThrow();
    sender.enqueueSegment("after-outage");

    client.setConnected(true);
    await sender.restartStream("reconnect");

    const replay = client.chunks
      .filter((chunk) => chunk.dictationId === "d2")
      .map((chunk) => [chunk.seq, chunk.audio]);
    expect(replay).toEqual([
      [0, "before-outage"],
      [1, "during-outage"],
      [2, "after-outage"],
    ]);
  });

  it("fails finish after a transport transition without losing buffered audio", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeDaemonClient();
      client.setConnected(false);
      const ids = ["d1", "d2"];
      const sender = new DictationStreamSender({
        client,
        format: "audio/pcm;rate=16000;bits=16",
        createDictationId: () => ids.shift() ?? "dX",
      });

      for (let seq = 0; seq < 129; seq += 1) {
        sender.enqueueSegment(`segment-${seq}`);
      }

      client.setConnected(true);
      const finish = sender.finish(sender.getFinalSeq());
      const outcome = promiseOutcome(finish, 1);

      await tick();
      client.setConnected(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toBe("rejected");
      expect(sender.getSegmentCount()).toBe(129);
      expect(sender.getFinalSeq()).toBe(128);

      client.setConnected(true);
      sender.resetStreamForReplay();
      await sender.restartStream("retry");
      await expect(sender.finish(128)).resolves.toEqual({ dictationId: "d2", text: "ok" });
      expect(client.chunks.filter((chunk) => chunk.dictationId === "d2")).toHaveLength(129);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for server delivery acknowledgement before finishing", async () => {
    const client = new FakeDaemonClient();
    client.autoAck = false;
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => "d1",
    });

    sender.enqueueSegment("seg0");
    sender.enqueueSegment("seg1");
    await tick();

    const finish = sender.finish(1);
    await tick();
    expect(client.finishes).toEqual([]);

    client.emitAck("d1", 1);
    await expect(finish).resolves.toEqual({ dictationId: "d1", text: "ok" });
  });

  it("does not replay long buffered native dictation in one synchronous burst", async () => {
    const client = new FakeDaemonClient();
    client.isConnected = false;
    const sender = new DictationStreamSender({
      client,
      format: "audio/pcm;rate=16000;bits=16",
      createDictationId: () => "d1",
    });

    for (let seq = 0; seq < 480; seq += 1) {
      sender.enqueueSegment(`native-frame-${seq}`);
    }

    client.isConnected = true;
    const finish = sender.finish(sender.getFinalSeq());

    await tick();

    expect(client.chunks.length).toBeLessThanOrEqual(128);
    await expect(finish).resolves.toEqual({
      dictationId: "d1",
      text: "ok",
    });
    expect(client.finishes).toEqual([{ dictationId: "d1", finalSeq: 479 }]);
  });
});
