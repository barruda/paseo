import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { ClaudeTTS, clampClaudeTtsSpeed, splitTtsText, type ClaudeTtsOptions } from "./tts.js";

const logger = pino({ level: "silent" });

interface FakeConnection {
  socket: WebSocket;
  request: IncomingMessage;
  textFrames: string[];
}

async function startFakeServer(options: {
  rejectStatus?: number;
  onCloseStream?: (connection: FakeConnection) => void;
}): Promise<{ url: string; connections: FakeConnection[]; close: () => Promise<void> }> {
  const connections: FakeConnection[] = [];
  const server = new WebSocketServer({
    port: 0,
    verifyClient: (_info, callback) => {
      if (options.rejectStatus) callback(false, options.rejectStatus);
      else callback(true);
    },
  });
  server.on("connection", (socket, request) => {
    const connection: FakeConnection = { socket, request, textFrames: [] };
    connections.push(connection);
    socket.on("message", (data) => {
      const text = data.toString();
      connection.textFrames.push(text);
      if (text.includes("close_stream")) options.onCloseStream?.(connection);
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/api/ws/text_to_speech/text_stream`,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

function createTts(url: string, extra: Partial<ClaudeTtsOptions> = {}): ClaudeTTS {
  return new ClaudeTTS(
    {
      configDir: "/unused",
      language: "pt-BR",
      voice: "airy",
      speed: 1.2,
      url,
      getAccessToken: async () => "test-token",
      ...extra,
    },
    logger,
  );
}

async function readAll(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("splitTtsText", () => {
  test("keeps short text whole and packs sentences up to the limit", () => {
    expect(splitTtsText("  Hello there.  ")).toEqual(["Hello there."]);
    const sentence = `${"a".repeat(38)}. `;
    const text = sentence.repeat(30).trim();
    const chunks = splitTtsText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  test("clamps the speed", () => {
    expect(clampClaudeTtsSpeed(0.2)).toBe(0.7);
    expect(clampClaudeTtsSpeed(3)).toBe(1.5);
    expect(clampClaudeTtsSpeed(undefined)).toBe(1);
  });
});

describe("ClaudeTTS", () => {
  test("sends the text in chunks, streams the audio and reports the 24 kHz format", async () => {
    const server = await startFakeServer({
      onCloseStream: (connection) => {
        connection.socket.send(Buffer.alloc(4800, 1));
        // An odd-sized frame: the stream keeps its chunks on sample boundaries.
        connection.socket.send(Buffer.alloc(3, 2));
        connection.socket.send(Buffer.alloc(3, 3));
        connection.socket.send(JSON.stringify({ type: "SpeechComplete", audio_sent_ms: 200 }));
      },
    });
    servers.push(server);

    const long = `${"Uma frase de teste. ".repeat(60)}`.trim();
    const result = await createTts(server.url).synthesizeSpeech(long);
    expect(result.format).toBe("pcm;rate=24000");
    const audio = await readAll(result.stream);
    expect(audio.length).toBe(4806);

    const [connection] = server.connections;
    const url = new URL(connection.request.url ?? "", "http://x");
    expect(url.searchParams.get("output_format")).toBe("pcm_24000");
    expect(url.searchParams.get("voice")).toBe("airy");
    expect(url.searchParams.get("tts_speed")).toBe("1.20");
    expect(url.searchParams.get("language")).toBe("pt-BR");
    expect(url.searchParams.get("client_platform")).toBe("cli");
    expect(connection.request.headers.authorization).toBe("Bearer test-token");
    expect(connection.request.headers["x-app"]).toBe("cli");

    const frames = connection.textFrames.map((frame) => JSON.parse(frame));
    const textChunks = frames.filter((frame) => frame.type === "text_chunk");
    expect(textChunks.length).toBeGreaterThan(1);
    expect(textChunks.every((frame) => frame.text.length <= 800)).toBe(true);
    expect(frames[frames.length - 1]).toEqual({ type: "close_stream" });
  });

  test("overrides the voice and speed per call", async () => {
    const server = await startFakeServer({
      onCloseStream: (connection) => {
        connection.socket.send(Buffer.alloc(400));
        connection.socket.send(JSON.stringify({ type: "SpeechComplete", audio_sent_ms: 8 }));
      },
    });
    servers.push(server);
    const result = await createTts(server.url).synthesizeSpeech("Oi.", {
      voice: "mellow",
      speed: 9,
    });
    await readAll(result.stream);
    const url = new URL(server.connections[0].request.url ?? "", "http://x");
    expect(url.searchParams.get("voice")).toBe("mellow");
    expect(url.searchParams.get("tts_speed")).toBe("1.50");
  });

  test("rejects empty text without connecting", async () => {
    const server = await startFakeServer({});
    servers.push(server);
    await expect(createTts(server.url).synthesizeSpeech("   ")).rejects.toThrow(/some text/);
    expect(server.connections).toHaveLength(0);
  });

  test("rejects when the server sends an error frame before any audio", async () => {
    const server = await startFakeServer({
      onCloseStream: (connection) => {
        connection.socket.send(JSON.stringify({ type: "SpeechError", error_code: "rate_limited" }));
        connection.socket.close(1000);
      },
    });
    servers.push(server);
    await expect(createTts(server.url).synthesizeSpeech("Oi.")).rejects.toThrow(/rate_limited/);
  });

  test("errors the stream when the server fails after the first audio", async () => {
    const server = await startFakeServer({
      onCloseStream: (connection) => {
        connection.socket.send(Buffer.alloc(960));
        setTimeout(() => {
          connection.socket.send(JSON.stringify({ type: "error", message: "boom" }));
        }, 20);
      },
    });
    servers.push(server);
    const result = await createTts(server.url).synthesizeSpeech("Oi.");
    await expect(readAll(result.stream)).rejects.toThrow(/boom/);
  });

  test("rejects a refused login", async () => {
    const server = await startFakeServer({ rejectStatus: 401 });
    servers.push(server);
    await expect(createTts(server.url).synthesizeSpeech("Oi.")).rejects.toThrow(/refused.*401/);
  });

  test("rejects when no audio arrives in time", async () => {
    const server = await startFakeServer({});
    servers.push(server);
    await expect(
      createTts(server.url, { idleTimeoutMs: 150 }).synthesizeSpeech("Oi."),
    ).rejects.toThrow(/timed out/);
  });
});
