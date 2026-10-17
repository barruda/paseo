import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import {
  DictationUpload,
  PcmSegmenter,
  readRunningPid,
  type DictationStreamClient,
} from "./shared.js";

describe("PcmSegmenter", () => {
  it("cuts 100 ms segments and keeps whole samples in the tail", () => {
    const segmenter = new PcmSegmenter();
    expect(segmenter.push(Buffer.alloc(3000))).toEqual([]);
    const segments = segmenter.push(Buffer.alloc(3500));
    expect(segments.map((s) => Buffer.from(s, "base64").length)).toEqual([3200, 3200]);
    segmenter.push(Buffer.alloc(1));
    expect(Buffer.from(segmenter.flush() ?? "", "base64").length).toBe(100);
    expect(segmenter.flush()).toBeNull();
  });
});

function createFakeClient(text: string) {
  let handler: ((message: SessionOutboundMessage) => void) | null = null;
  let resolveStart: () => void = () => undefined;
  const sent: number[] = [];
  const calls: string[] = [];
  const client: DictationStreamClient = {
    startDictationStream: () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve;
      }),
    sendDictationStreamChunk: (dictationId, seq) => {
      sent.push(seq);
      queueMicrotask(() =>
        handler?.({ type: "dictation_stream_ack", payload: { dictationId, ackSeq: seq } }),
      );
    },
    finishDictationStream: async (dictationId, finalSeq) => {
      calls.push(`finish:${finalSeq}`);
      return { dictationId, text };
    },
    cancelDictationStream: () => {
      calls.push("cancel");
    },
    subscribeRawMessages: (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
  };
  return { client, sent, calls, start: () => resolveStart() };
}

describe("DictationUpload", () => {
  it("sends segments recorded before the stream starts, then finishes after the last ack", async () => {
    const fake = createFakeClient("  hello world ");
    const upload = new DictationUpload(fake.client, "d1");
    upload.push("a");
    upload.push("b");
    expect(fake.sent).toEqual([]);
    fake.start();
    upload.push("c");
    await expect(upload.finish()).resolves.toBe("hello world");
    expect(fake.sent).toEqual([0, 1, 2]);
    expect(fake.calls).toEqual(["finish:2"]);
  });

  it("cancels the stream when nothing was recorded", async () => {
    const fake = createFakeClient("unused");
    const upload = new DictationUpload(fake.client, "d2");
    fake.start();
    await expect(upload.finish()).resolves.toBe("");
    expect(fake.calls).toEqual(["cancel"]);
  });
});

describe("readRunningPid", () => {
  it("returns a live pid and clears a stale pid file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-dictate-"));
    const pidFile = path.join(dir, "paseo-dictate.pid");
    expect(readRunningPid(pidFile)).toBeNull();

    fs.writeFileSync(pidFile, String(process.ppid));
    expect(readRunningPid(pidFile)).toBe(process.ppid);

    fs.writeFileSync(pidFile, "999999999");
    expect(readRunningPid(pidFile)).toBeNull();
    expect(fs.existsSync(pidFile)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
