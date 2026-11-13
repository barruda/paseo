import { describe, expect, it } from "vitest";
import {
  mergePluginValues,
  parseBrunoConfig,
  serializeBrunoConfig,
  stripAccountSettings,
} from "./config-file";

const NOW = new Date("2026-11-13T10:00:00.000Z");

describe("bruno config file", () => {
  it("round trips a full snapshot", () => {
    const snapshot = {
      app: { chatLinksEnabled: false, chatOptions: { a: false }, chatOptionOrder: { left: ["x"] } },
      desktop: { flexibleTabMovement: true },
      host: {
        github: { configDir: "~/.config/gh" },
        speech: { providers: { local: { enabled: true } } },
        features: { dictation: { enabled: true } },
        plugins: { "jev-router": { router: { enabled: true } } },
      },
    };
    const result = parseBrunoConfig(serializeBrunoConfig(snapshot, NOW));
    expect(result).toEqual({
      ok: true,
      config: { paseoBrunoConfig: 1, savedAt: NOW.toISOString(), ...snapshot },
    });
  });

  it("loads a partial file", () => {
    const result = parseBrunoConfig('{"paseoBrunoConfig":1,"app":{"showCriticToggle":false}}');
    expect(result).toEqual({
      ok: true,
      config: { paseoBrunoConfig: 1, app: { showCriticToggle: false } },
    });
  });

  it("keeps unknown extra keys", () => {
    const result = parseBrunoConfig('{"paseoBrunoConfig":1,"future":{"a":1}}');
    expect(result.ok && (result.config as Record<string, unknown>).future).toEqual({ a: 1 });
  });

  it("refuses invalid JSON", () => {
    expect(parseBrunoConfig("{nope")).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("refuses the wrong shape", () => {
    expect(parseBrunoConfig('{"format":"paseo-shortcuts"}')).toEqual({
      ok: false,
      reason: "invalid-format",
    });
    expect(parseBrunoConfig('{"paseoBrunoConfig":1,"app":{"deskPreviewTabs":"yes"}}')).toEqual({
      ok: false,
      reason: "invalid-format",
    });
  });

  it("refuses a newer version even when the shape changed", () => {
    expect(parseBrunoConfig('{"paseoBrunoConfig":2,"app":42}')).toEqual({
      ok: false,
      reason: "newer-version",
    });
  });
});

describe("stripAccountSettings", () => {
  const full = {
    app: { chatLinksEnabled: true },
    host: {
      github: { configDir: "~/.config/gh" },
      speech: {
        dictationSttProvider: "openai",
        voiceSttProvider: "claude",
        voiceTtsProvider: "claude",
        claudeSttConfigDir: "~/.claude",
        dictationPrompt: "hello",
      },
      features: {
        dictation: { enabled: true, stt: { provider: "openai", apiKey: "k" } },
        voiceMode: {
          enabled: false,
          stt: {},
          tts: {},
          llm: {},
          turnDetection: {},
        },
      },
      plugins: {
        "jev-router": {
          router: { enabled: true, apiKey: "k", apiUrl: "u", jevModel: "m", python: "python3" },
        },
        delegation: { settings: { a: 1 } },
      },
    },
  };

  it("removes every account field and keeps the rest", () => {
    expect(stripAccountSettings(full)).toEqual({
      app: { chatLinksEnabled: true },
      host: {
        speech: { dictationPrompt: "hello" },
        features: { dictation: { enabled: true }, voiceMode: { enabled: false } },
        plugins: {
          "jev-router": { router: { enabled: true, python: "python3" } },
          delegation: { settings: { a: 1 } },
        },
      },
    });
  });

  it("does not mutate the input", () => {
    stripAccountSettings(full);
    expect(full.host.github.configDir).toBe("~/.config/gh");
    expect(full.host.plugins["jev-router"].router.apiKey).toBe("k");
  });

  it("drops sections that end up empty", () => {
    const result = stripAccountSettings({
      host: {
        github: { configDir: "x" },
        speech: { voiceTtsProvider: "claude" },
        features: { voiceMode: { stt: {} } },
      },
    });
    expect(result).toEqual({ host: {} });
  });

  it("leaves a config without host untouched", () => {
    const config = { app: { deskPreviewTabs: true } };
    expect(stripAccountSettings(config)).toEqual(config);
  });

  it("ignores a Jev router value that is not an object", () => {
    const config = { host: { plugins: { "jev-router": { router: "odd" } } } };
    expect(stripAccountSettings(config)).toEqual(config);
  });
});

describe("mergePluginValues", () => {
  it("keeps current keys the file lacks", () => {
    expect(mergePluginValues({ apiKey: "k", enabled: true }, { enabled: false })).toEqual({
      apiKey: "k",
      enabled: false,
    });
  });

  it("writes the file value when either side is not an object", () => {
    expect(mergePluginValues(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergePluginValues({ a: 1 }, [1])).toEqual([1]);
  });
});
