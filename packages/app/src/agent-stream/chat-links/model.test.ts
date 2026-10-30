import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { collectChatLinks, isListedUrl, parseMessageLinks } from "./model";

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
        "See [the report](https://paseo.sh/report/) and `/tmp/out/result.html`.\n\nDocs at https://docs.test/page and /home/me/project/docs/notes.md:12 too.",
      ),
    ).toEqual([
      { kind: "url", label: "paseo.sh/report", detail: "https://paseo.sh/report/" },
      { kind: "file", label: "result.html", detail: "/tmp/out/result.html" },
      { kind: "url", label: "docs.test/page", detail: "https://docs.test/page" },
      { kind: "file", label: "notes.md:12", detail: "/home/me/project/docs/notes.md:12" },
    ]);
  });

  it("lists HTML and Markdown files only", () => {
    expect(
      summary("`/tmp/a/app.ts` [src](/tmp/a/src/) `/tmp/a/page.htm` `/tmp/a/README.MD`").map(
        (link) => link.label,
      ),
    ).toEqual(["page.htm", "README.MD"]);
  });

  it("skips file type mentions, globs and placeholders", () => {
    expect(
      summary(
        "Files `.html`/`.md`, `*.md`, `docs/<name>.md`, `reports/${id}.html`, `a/.../b.md` and `notes/todo.md`",
      ).map((link) => link.label),
    ).toEqual(["todo.md"]);
  });

  it("skips prose that only looks like a URL", () => {
    expect(
      summary("Commit `custom: link list beside the chat`, the prefix `https://` and `mailto:x`"),
    ).toEqual([]);
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

describe("isListedUrl", () => {
  it("keeps web addresses with a real host", () => {
    expect(isListedUrl("https://github.com/getpaseo/paseo/pull/12")).toBe(true);
    expect(isListedUrl("http://localhost:8091/")).toBe(true);
    expect(isListedUrl("http://192.168.0.10:3000")).toBe(true);
  });

  it("drops other schemes, bare hosts, examples and templates", () => {
    expect(isListedUrl("custom:thing")).toBe(false);
    expect(isListedUrl("ftp://files.paseo.sh/a")).toBe(false);
    expect(isListedUrl("https://intranet")).toBe(false);
    expect(isListedUrl("https://example.com/a")).toBe(false);
    expect(isListedUrl("https://api.paseo.sh/{id}")).toBe(false);
  });
});

describe("collectChatLinks bare names", () => {
  it("drops a bare file name when the same file is listed with its folder", () => {
    const links = collectChatLinks(
      [
        assistant("a1", "Updated `custom/CHANGES.md`."),
        assistant("a2", "Now `CHANGES.md` and `other.md`."),
      ],
      ROOT,
    );
    expect(links.map((link) => link.detail)).toEqual([
      `${ROOT}/custom/CHANGES.md`,
      `${ROOT}/other.md`,
    ]);
  });
});
