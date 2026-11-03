import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "@/keyboard/keyboard-shortcuts";
import { diffShortcutOverrides, parseShortcutFile, serializeShortcutFile } from "./shortcut-file";

const bindingId = DEFAULT_BINDINGS[0]!.id;
const otherBindingId = DEFAULT_BINDINGS[1]!.id;

describe("shortcut file", () => {
  it("round-trips overrides, keeping unassigned shortcuts and extra slots", () => {
    const overrides = {
      [bindingId]: "Mod+K",
      [otherBindingId]: null,
      [`${bindingId}#2`]: "Alt+Shift+J",
    };

    const result = parseShortcutFile(serializeShortcutFile(overrides));

    expect(result).toEqual({ ok: true, overrides, skipped: [] });
  });

  it("writes readable JSON with sorted ids", () => {
    const text = serializeShortcutFile({ [otherBindingId]: "Mod+K", [bindingId]: "Mod+J" });

    expect(text.endsWith("\n")).toBe(true);
    expect(Object.keys(JSON.parse(text).shortcuts)).toEqual(
      [bindingId, otherBindingId].sort((a, b) => a.localeCompare(b, "en")),
    );
  });

  it("skips unknown bindings, out-of-range slots and unparsable combos, and keeps the rest", () => {
    const text = JSON.stringify({
      format: "paseo-shortcuts",
      version: 1,
      shortcuts: {
        [bindingId]: "Mod+K",
        "no-such-binding": "Mod+J",
        [`${bindingId}#9`]: "Mod+J",
        [`${otherBindingId}`]: "Mod+NoSuchKey",
      },
    });

    expect(parseShortcutFile(text)).toEqual({
      ok: true,
      overrides: { [bindingId]: "Mod+K" },
      skipped: ["no-such-binding", `${bindingId}#9`, otherBindingId],
    });
  });

  it("rejects text that is not a shortcut file", () => {
    expect(parseShortcutFile("{nope")).toEqual({ ok: false, reason: "invalid-json" });
    expect(parseShortcutFile("{}")).toEqual({ ok: false, reason: "invalid-format" });
    expect(
      parseShortcutFile(JSON.stringify({ format: "paseo-shortcuts", version: 1, shortcuts: [] })),
    ).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("refuses a file from a newer version", () => {
    const text = JSON.stringify({ format: "paseo-shortcuts", version: 2, shortcuts: {} });

    expect(parseShortcutFile(text)).toEqual({ ok: false, reason: "newer-version" });
  });
});

describe("diffShortcutOverrides", () => {
  it("replaces the current setup: sets new values and drops what the file does not have", () => {
    const current = { [bindingId]: "Mod+K", [otherBindingId]: "Mod+J" };
    const next = { [bindingId]: "Mod+K", [`${bindingId}#2`]: null };

    expect(diffShortcutOverrides(current, next)).toEqual({
      [otherBindingId]: undefined,
      [`${bindingId}#2`]: null,
    });
  });

  it("is empty when nothing differs", () => {
    const same = { [bindingId]: null };

    expect(diffShortcutOverrides(same, { ...same })).toEqual({});
  });
});
