import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import type {
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech-provider.js";
import { ClaudeSTT, formatKeytermsHeader } from "./stt.js";

const logger = pino({ level: "silent" });

interface FakeConnection {
  socket: WebSocket;
  request: IncomingMessage;
  audioBytes: number;
  textFrames: string[];
}

// Speaks the voice_stream protocol: each script step runs when a frame arrives.
async function startFakeServer(options: {
  rejectStatus?: number;
  onAudio?: (connection: FakeConnection) => void;
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
    const connection: FakeConnection = { socket, request, audioBytes: 0, textFrames: [] };
    connections.push(connection);
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        connection.audioBytes += (data as Buffer).length;
        options.onAudio?.(connection);
        return;
      }
      const text = data.toString();
      connection.textFrames.push(text);
      if (text.includes("CloseStream")) options.onCloseStream?.(connection);
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/api/ws/speech_to_text/voice_stream`,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

function send(connection: FakeConnection, type: string, data?: string): void {
  connection.socket.send(JSON.stringify(data === undefined ? { type } : { type, data }));
}

function createSession(url: string, keyterms: string[] = []): StreamingTranscriptionSession {
  const stt = new ClaudeSTT(
    {
      configDir: "/unused",
      language: "pt",
      keyterms,
      url,
      getAccessToken: async () => "test-token",
    },
    logger,
  );
  return stt.createSession({ logger });
}

function collect(session: StreamingTranscriptionSession) {
  const events: Array<
    | { kind: "committed"; segmentId: string }
    | ({ kind: "transcript" } & StreamingTranscriptionEvent)
    | { kind: "error"; message: string }
  > = [];
  session.on("committed", ({ segmentId }) => events.push({ kind: "committed", segmentId }));
  session.on("transcript", (event) => events.push({ kind: "transcript", ...event }));
  session.on("error", (error) =>
    events.push({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
  );
  return events;
}

type CollectedEvents = ReturnType<typeof collect>;

function finals(events: CollectedEvents) {
  return events.filter((e) => e.kind === "transcript" && e.isFinal);
}

function hasTranscript(events: CollectedEvents, text?: string): boolean {
  return events.some(
    (e) => e.kind === "transcript" && (text === undefined || e.transcript === text),
  );
}

function hasKind(events: CollectedEvents, kind: "committed" | "error"): boolean {
  return events.some((e) => e.kind === kind);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const audio = Buffer.alloc(3200, 1);
let cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of cleanup.toReversed()) await fn();
  cleanup = [];
});

describe("ClaudeSTT", () => {
  test("streams partials and finishes the segment on commit", async () => {
    const server = await startFakeServer({
      onAudio: (connection) => {
        if (connection.audioBytes === audio.length) send(connection, "TranscriptInterim", "olá");
        if (connection.audioBytes === audio.length * 2) {
          send(connection, "TranscriptInterim", "olá mundo");
        }
      },
      onCloseStream: (connection) => {
        send(connection, "TranscriptText", "Olá, mundo.");
        send(connection, "TranscriptEndpoint");
        connection.socket.close(1000);
      },
    });
    cleanup.push(server.close);
    const session = createSession(server.url, ["Paseo", "Magic, Wings", "Paseo"]);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.appendPcm16(audio);
    session.appendPcm16(audio);
    await waitFor(() => hasTranscript(events, "olá mundo"));
    session.commit();
    await waitFor(() => finals(events).length > 0);

    const [connection] = server.connections;
    expect(connection.request.headers.authorization).toBe("Bearer test-token");
    expect(connection.request.headers["x-config-keyterms"]).toBe("Paseo,Magic Wings");
    expect(connection.request.url).toContain("language=pt");
    expect(connection.request.url).toContain("sample_rate=16000");
    expect(connection.textFrames[0]).toBe('{"type":"KeepAlive"}');

    const committed = events.find((e) => e.kind === "committed");
    const [final] = finals(events);
    expect(committed).toBeDefined();
    expect(events.indexOf(committed!)).toBeLessThan(events.indexOf(final!));
    expect(final).toMatchObject({ segmentId: committed!.segmentId, transcript: "Olá, mundo." });
  });

  test("joins every utterance the server ended inside one segment", async () => {
    const server = await startFakeServer({
      onAudio: (connection) => {
        if (connection.audioBytes === audio.length) {
          send(connection, "TranscriptText", "primeira frase.");
          send(connection, "TranscriptEndpoint");
          send(connection, "TranscriptInterim", "segunda");
        }
      },
      onCloseStream: (connection) => {
        send(connection, "TranscriptText", "segunda frase.");
        send(connection, "TranscriptEndpoint");
      },
    });
    cleanup.push(server.close);
    const session = createSession(server.url);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.appendPcm16(audio);
    await waitFor(() => hasTranscript(events, "primeira frase. segunda"));
    session.commit();
    await waitFor(() => finals(events).length > 0);

    const [final] = finals(events);
    expect(final).toMatchObject({ transcript: "primeira frase. segunda frase." });
  });

  test("a commit without audio ends the segment empty and the next audio opens a new socket", async () => {
    const server = await startFakeServer({
      onCloseStream: (connection) => {
        send(connection, "TranscriptText", "depois");
        send(connection, "TranscriptEndpoint");
      },
    });
    cleanup.push(server.close);
    const session = createSession(server.url);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.commit();
    await waitFor(() => finals(events).length > 0);
    expect(events.find((e) => e.kind === "transcript")).toMatchObject({ transcript: "" });
    expect(server.connections).toHaveLength(0);

    session.appendPcm16(audio);
    session.commit();
    await waitFor(() => finals(events).length === 2);
    expect(server.connections).toHaveLength(1);
    expect(finals(events)[1]).toMatchObject({ transcript: "depois" });
  });

  test("ends the segment when the server sends nothing after CloseStream", async () => {
    const server = await startFakeServer({});
    cleanup.push(server.close);
    const session = createSession(server.url);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.appendPcm16(audio);
    await waitFor(() => server.connections[0]?.audioBytes === audio.length);
    const started = Date.now();
    session.commit();
    await waitFor(() => finals(events).length > 0, 4000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("reports a refused login", async () => {
    const server = await startFakeServer({ rejectStatus: 401 });
    cleanup.push(server.close);
    const session = createSession(server.url);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.appendPcm16(audio);
    await waitFor(() => hasKind(events, "error"));
    expect(events.find((e) => e.kind === "error")).toMatchObject({
      message: expect.stringContaining("HTTP 401"),
    });
  });

  test("clear drops the open segment without a final transcript", async () => {
    const server = await startFakeServer({
      onAudio: (connection) => send(connection, "TranscriptInterim", "ruído"),
    });
    cleanup.push(server.close);
    const session = createSession(server.url);
    cleanup.push(() => session.close());
    const events = collect(session);

    await session.connect();
    session.appendPcm16(audio);
    await waitFor(() => hasTranscript(events));
    session.clear();
    await waitFor(() => server.connections[0]?.socket.readyState === 3);
    expect(hasKind(events, "committed")).toBe(false);
    expect(finals(events)).toHaveLength(0);
  });
});

describe("formatKeytermsHeader", () => {
  test("cleans, de-duplicates and caps the terms", () => {
    expect(formatKeytermsHeader(["  Paseo ", "a,b", "LiorahéGround", "Paseo", ""])).toBe(
      "Paseo,a b,LiorahGround",
    );
    const long = Array.from({ length: 300 }, (_, i) => `term${i}`);
    expect(formatKeytermsHeader(long).length).toBeLessThanOrEqual(1024);
  });
});
