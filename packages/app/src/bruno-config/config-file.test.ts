import { describe, expect, it } from "vitest";
import { parseBrunoConfig, serializeBrunoConfig } from "./config-file";

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
