// CUSTOM(assistant-cards)
import { beforeEach, expect, it } from "vitest";
import {
  isNewestReply,
  noteReply,
  resetNewestReplies,
} from "../client/assistant/newest-reply";

beforeEach(() => resetNewestReplies());

it("only the newest reply card of a chat takes answers, also after an older one mounts", () => {
  expect(isNewestReply("chat", 100)).toBe(true);
  expect(noteReply("chat", 200)).toBe(true);
  expect(isNewestReply("chat", 100)).toBe(false);
  // Scrolling up mounts an older card: it stays read-only.
  expect(noteReply("chat", 100)).toBe(false);
  expect(isNewestReply("chat", 200)).toBe(true);
  // A new reply takes over.
  expect(noteReply("chat", 300)).toBe(true);
  expect(isNewestReply("chat", 200)).toBe(false);
  // Chats are apart.
  expect(isNewestReply("other", 1)).toBe(true);
});
