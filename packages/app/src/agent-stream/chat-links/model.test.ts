import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { collectChatLinks, parseMessageLinks } from "./model";

const ROOT = "/home/me/project";

function assistant(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
}

function summary(text: string) {
  return parseMessageLinks(text, ROOT).map(({ kind, label, detail }) => ({ kind, label, detail }));
}

describe("parseMessageLinks", () => {
  it("finds markdown links, linked code spans and bare URLs in document order", () => {
    expect(
      summary(
        "See [the report](https://example.com/report/) and `/tmp/out/result.html`.\n\nDocs at https://docs.test/page and /home/me/project/src/app.ts:12 too.",
      ),
    ).toEqual([
      { kind: "url", label: "example.com/report", detail: "https://example.com/report/" },
      { kind: "file", label: "result.html", detail: "/tmp/out/result.html" },
      { kind: "url", label: "docs.test/page", detail: "https://docs.test/page" },
      { kind: "file", label: "app.ts:12", detail: "/home/me/project/src/app.ts:12" },
    ]);
  });

  it("does not count the text of a link twice", () => {
    expect(summary("[https://a.test/x](https://a.test/x)")).toEqual([
      { kind: "url", label: "a.test/x", detail: "https://a.test/x" },
    ]);
  });

  it("ignores code blocks, images and plain words", () => {
    expect(
      summary("```sh\ncat /tmp/a/b.txt\n```\n\n![shot](/tmp/shot.png)\n\n`npm run build` done"),
    ).toEqual([]);
  });
});

describe("collectChatLinks", () => {
  it("lists each link once, at the message that sent it last, and skips user messages", () => {
    const links = collectChatLinks(
      [
        assistant("a1", "`/tmp/a.md` and https://x.test"),
        user("u1", "`/tmp/mine.md`"),
        assistant("a2", "again `/tmp/a.md`"),
      ],
      ROOT,
    );
    expect(links.map((link) => [link.detail, link.messageId])).toEqual([
      ["https://x.test", "a1"],
      ["/tmp/a.md", "a2"],
    ]);
  });
});
