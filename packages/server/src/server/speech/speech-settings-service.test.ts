import { describe, expect, it } from "vitest";

import { parseSpeechLogLine } from "./speech-settings-service.js";

// CUSTOM(voice-settings)
describe("speech log lines in Settings", () => {
  it("reads the JSON lines installed daemons write", () => {
    const entry = parseSpeechLogLine(
      JSON.stringify({
        level: 40,
        time: Date.UTC(2026, 9, 13, 15, 0, 0),
        pid: 1,
        module: "speech-runtime",
        msg: "GPU speech selected but unavailable; using the CPU",
        reason: "No NVIDIA driver found.",
      }),
    );
    expect(entry).toEqual({
      time: "2026-10-13T15:00:00.000Z",
      level: "warn",
      message: "GPU speech selected but unavailable; using the CPU",
      detail: '{"reason":"No NVIDIA driver found."}',
    });
  });

  it("reads the colored lines dev daemons write", () => {
    const entry = parseSpeechLogLine(
      '[17:43:27.357] \u001b[32mINFO\u001b[39m: \u001b[36mSpeech settings changed; reloading the speech engine\u001b[39m \u001b[90m{"module":"speech-runtime","daemonVersion":"0.11.2"}\u001b[39m',
    );
    expect(entry?.level).toBe("info");
    expect(entry?.message).toBe("Speech settings changed; reloading the speech engine");
    expect(entry?.detail).toBeNull();
    expect(new Date(entry!.time).toTimeString().slice(0, 8)).toBe("17:43:27");
  });

  it("skips lines that aren't about speech and the per-chunk noise", () => {
    expect(
      parseSpeechLogLine(JSON.stringify({ level: 30, time: 0, module: "session", msg: "x" })),
    ).toBeNull();
    expect(
      parseSpeechLogLine(
        JSON.stringify({ level: 30, time: 0, module: "speech", msg: "Voice input chunk summary" }),
      ),
    ).toBeNull();
    expect(parseSpeechLogLine("not a log line")).toBeNull();
  });
});
