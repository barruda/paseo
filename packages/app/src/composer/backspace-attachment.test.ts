import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/attachments/types";
import { imageIndexToRemoveOnBackspace } from "./backspace-attachment";

function image(id: string): ComposerAttachment {
  return {
    kind: "image",
    metadata: {
      id,
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: id,
      createdAt: 0,
    },
  };
}

const file: ComposerAttachment = {
  kind: "workspace_file",
  path: "a.ts",
  selection: { kind: "whole_file" },
};

function indexFor(overrides: Partial<Parameters<typeof imageIndexToRemoveOnBackspace>[0]>) {
  return imageIndexToRemoveOnBackspace({
    key: "Backspace",
    hasModifier: false,
    text: "",
    attachments: [image("a"), image("b")],
    ...overrides,
  });
}

describe("imageIndexToRemoveOnBackspace", () => {
  it("removes the last image when nothing is typed", () => {
    expect(indexFor({})).toBe(1);
    expect(indexFor({ attachments: [image("a"), file] })).toBe(0);
  });

  it("leaves the key to the text when something is typed", () => {
    expect(indexFor({ text: "x" })).toBeNull();
    expect(indexFor({ text: " " })).toBeNull();
  });

  it("ignores other keys, modified Backspace and composers without images", () => {
    expect(indexFor({ key: "Delete" })).toBeNull();
    expect(indexFor({ hasModifier: true })).toBeNull();
    expect(indexFor({ attachments: [file] })).toBeNull();
    expect(indexFor({ attachments: [] })).toBeNull();
  });
});
