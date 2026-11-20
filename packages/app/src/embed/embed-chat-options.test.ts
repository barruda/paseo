import { describe, expect, it } from "vitest";
import { chatOptionEnabled } from "@/composer/chat-options";
import {
  EMBED_HIDDEN_CHAT_OPTIONS,
  isEmbedHiddenFeature,
  resolveChatOptionsForEmbed,
  withEmbedChatOptions,
} from "./embed-chat-options";

describe("embed chat options", () => {
  it("keeps Dictation and Voice mode enabled in the embed", () => {
    const options = resolveChatOptionsForEmbed({}, true);
    expect(options.dictation).not.toBe(false);
    expect(options.voice).not.toBe(false);
    expect(chatOptionEnabled(options, "dictation")).toBe(true);
    expect(chatOptionEnabled(options, "voice")).toBe(true);
  });

  it("hides speed, plan, Ctrl+M and Jev in the embed", () => {
    const options = resolveChatOptionsForEmbed({}, true);
    for (const key of ["feature:fast_mode", "feature:plan_mode", "model-shortcut", "jev"]) {
      expect(chatOptionEnabled(options, key)).toBe(false);
    }
  });

  it("respects a user's own disabled voice setting", () => {
    const options = resolveChatOptionsForEmbed({ dictation: false, voice: false }, true);
    expect(options.dictation).toBe(false);
    expect(options.voice).toBe(false);
  });

  it("leaves every option untouched outside the embed", () => {
    const options = { dictation: false, voice: true, "feature:fast_mode": true };
    expect(resolveChatOptionsForEmbed(options, false)).toBe(options);
    expect(EMBED_HIDDEN_CHAT_OPTIONS).not.toHaveProperty("dictation");
    expect(EMBED_HIDDEN_CHAT_OPTIONS).not.toHaveProperty("voice");
  });

  it("recognizes provider speed controls by their zap icon", () => {
    expect(isEmbedHiddenFeature({ icon: "zap" })).toBe(true);
    expect(isEmbedHiddenFeature({ icon: "list-todo" })).toBe(false);
    expect(isEmbedHiddenFeature({})).toBe(false);
  });

  it("caches the merged options per source object", () => {
    const source = {};
    expect(withEmbedChatOptions(source)).toBe(withEmbedChatOptions(source));
  });
});
