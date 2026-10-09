import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { collectChatImages, parseMessageImages, resolveActiveImageMessageId } from "./model";

function assistant(id: string, text: string, seq?: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date(0),
    ...(seq === undefined ? {} : { timelineCursor: { epoch: "e", seq } }),
  };
}

function user(id: string, text: string, seq: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date(0),
    timelineCursor: { epoch: "e", seq },
  };
}

describe("parseMessageImages", () => {
  it("finds markdown images with their alt text, in document order", () => {
    expect(
      parseMessageImages(
        "Before ![first](shots/a.png)\n\n- ![](/tmp/b.jpg)\n\n![third](https://x.test/c.webp)",
      ),
    ).toEqual([
      { source: "shots/a.png", alt: "first" },
      { source: "/tmp/b.jpg", alt: "" },
      { source: "https://x.test/c.webp", alt: "third" },
    ]);
  });

  it("ignores image syntax inside code", () => {
    expect(parseMessageImages("`![a](a.png)`\n\n```md\n![b](b.png)\n```")).toEqual([]);
  });

  it("ignores links and plain image paths", () => {
    expect(parseMessageImages("[a](a.png) and `b.png`")).toEqual([]);
  });
});

describe("collectChatImages", () => {
  it("numbers images per message across the transcript", () => {
    const images = collectChatImages([
      user("u1", "![not mine](user.png)", 1),
      assistant("a1", "![one](1.png) ![two](2.png)", 2),
      assistant("a2", "no images", 3),
      assistant("a3", "![three](3.png)", 4),
    ]);
    expect(
      images.map(({ key, messageId, index, source, seq }) => ({
        key,
        messageId,
        index,
        source,
        seq,
      })),
    ).toEqual([
      { key: "a1:0", messageId: "a1", index: 0, source: "1.png", seq: 2 },
      { key: "a1:1", messageId: "a1", index: 1, source: "2.png", seq: 2 },
      { key: "a3:0", messageId: "a3", index: 0, source: "3.png", seq: 4 },
    ]);
  });

  it("keeps every occurrence of a repeated image", () => {
    const images = collectChatImages([
      assistant("a1", "![x](same.png)", 1),
      assistant("a2", "![x](same.png)", 2),
    ]);
    expect(images.map((image) => image.key)).toEqual(["a1:0", "a2:0"]);
  });

  it("addresses a split assistant message by its block group", () => {
    const block: StreamItem = {
      ...(assistant("a1:block:1", "![x](x.png)", 1) as Extract<
        StreamItem,
        { kind: "assistant_message" }
      >),
      blockGroupId: "a1",
      blockIndex: 1,
    };
    expect(collectChatImages([block])[0]?.messageId).toBe("a1");
  });
});

describe("resolveActiveImageMessageId", () => {
  const images = collectChatImages([
    assistant("a1", "![one](1.png)", 2),
    assistant("a2", "![two](2.png)", 6),
    assistant("live", "![live](3.png)"),
  ]);

  it("is the last image message at or before the reading position", () => {
    expect(resolveActiveImageMessageId(images, 1)).toBeNull();
    expect(resolveActiveImageMessageId(images, 2)).toBe("a1");
    expect(resolveActiveImageMessageId(images, 5)).toBe("a1");
    expect(resolveActiveImageMessageId(images, 9)).toBe("a2");
  });

  it("is nothing without a reading position", () => {
    expect(resolveActiveImageMessageId(images, null)).toBeNull();
  });
});
