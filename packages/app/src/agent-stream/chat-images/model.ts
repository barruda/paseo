// CUSTOM(chat-images): the image strip beside the chat. See custom/CHANGES.md.
import type Token from "markdown-it/lib/token.mjs";
import type { StreamItem } from "@/types/stream";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { getStreamItemMessageId } from "../presentation";

export interface ChatImage {
  key: string;
  messageId: string;
  /** Position among the images of its message, in document order. */
  index: number;
  source: string;
  alt: string;
  seq: number | null;
}

interface MessageImage {
  source: string;
  alt: string;
}

const parser = createAssistantMarkdownParser();
const NO_IMAGES: MessageImage[] = [];

// Streaming re-renders the stream on every chunk while older items keep their identity,
// so each message is parsed once per text it ever had.
const parsedByItem = new WeakMap<StreamItem, MessageImage[]>();

function collectImageTokens(tokens: readonly Token[], into: MessageImage[]): void {
  for (const token of tokens) {
    if (token.type === "image") {
      const source = token.attrGet("src")?.trim() ?? "";
      if (source) into.push({ source, alt: token.content });
    }
    if (token.children) collectImageTokens(token.children, into);
  }
}

/** The images the chat renders for one message: markdown images in assistant text. */
export function parseMessageImages(text: string): MessageImage[] {
  if (!text.includes("![")) return NO_IMAGES;
  const images: MessageImage[] = [];
  collectImageTokens(parser.parse(text, {}), images);
  return images.length > 0 ? images : NO_IMAGES;
}

function imagesOf(item: StreamItem): MessageImage[] {
  if (item.kind !== "assistant_message") return NO_IMAGES;
  let images = parsedByItem.get(item);
  if (!images) {
    images = parseMessageImages(item.text);
    parsedByItem.set(item, images);
  }
  return images;
}

/** Every image in the loaded transcript, oldest first, one entry per occurrence. */
export function collectChatImages(items: readonly StreamItem[]): ChatImage[] {
  const result: ChatImage[] = [];
  const countByMessage = new Map<string, number>();
  for (const item of items) {
    const images = imagesOf(item);
    if (images.length === 0) continue;
    const messageId = getStreamItemMessageId(item);
    for (const image of images) {
      const index = countByMessage.get(messageId) ?? 0;
      countByMessage.set(messageId, index + 1);
      result.push({
        key: `${messageId}:${index}`,
        messageId,
        index,
        source: image.source,
        alt: image.alt,
        seq: item.timelineCursor?.seq ?? null,
      });
    }
  }
  return result;
}

/**
 * The message the reader is inside, from the timeline position under the top of the
 * viewport: the last message with an image at or before that position.
 */
export function resolveActiveImageMessageId(
  images: readonly ChatImage[],
  readingSeq: number | null,
): string | null {
  if (readingSeq === null) return null;
  let active: string | null = null;
  for (const image of images) {
    if (image.seq === null || image.seq > readingSeq) continue;
    active = image.messageId;
  }
  return active;
}

/** Rendered images carry this so the strip can land on the exact one. */
export const CHAT_IMAGE_DATASET = { chatImage: "true" };
export const CHAT_IMAGE_SELECTOR = "[data-chat-image]";
