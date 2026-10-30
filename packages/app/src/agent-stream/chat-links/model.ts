// CUSTOM(chat-links): the link list beside the chat. See custom/CHANGES.md.
import type Token from "markdown-it/lib/token.mjs";
import { classifyAssistantFileLink, type AssistantFileLinkSource } from "@/assistant-file-links";
import { PROSE_LINK_PATTERN, markdownLinkSource } from "@/components/markdown/source";
import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "@/types/stream";
import { createMarkdownParser } from "@/utils/markdown-parser";

export type ChatLinkKind = "url" | "file";

export interface ChatLink {
  /** What the link points at: the same URL or file appears once. */
  key: string;
  kind: ChatLinkKind;
  /** Opens through the chat's own link resolver, exactly like clicking it in the message. */
  source: AssistantFileLinkSource;
  label: string;
  detail: string;
  /** A file named without a folder (`notes.md`); a listed path with that name replaces it. */
  bareName: boolean;
  messageId: string;
}

type MessageLink = Omit<ChatLink, "messageId">;

// The chat renderer finds bare URLs and prose paths with its own pattern (PROSE_LINK_PATTERN), so
// markdown-it's linkify stays off and text runs go through that pattern instead.
const parser = createMarkdownParser({ linkify: false });
const defaultValidateLink = parser.validateLink.bind(parser);
parser.validateLink = (url: string) =>
  url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

const NO_LINKS: MessageLink[] = [];
// Only documents worth reopening: reports and notes, not source files or folders. The name needs a
// stem, so an extension on its own (`.md`) is a mention of the file type, not a file.
const LISTED_FILE = /(?:^|\/)[^/.][^/]*\.(?:html?|md|markdown)$/i;
// Globs, templates and elisions name a pattern of files or a placeholder, never one file or page.
const PLACEHOLDER = /[*?<>{}$|^`]|\.\.\.|…|%s\b/;
// Hosts the docs and tests use for examples; nothing an agent sends there is worth reopening.
const EXAMPLE_HOST = /(?:^|\.)(?:example(?:\.(?:com|org|net))?|invalid|localhost\.localdomain)$/i;

// Streaming re-renders the stream on every chunk while older items keep their identity,
// so each message is parsed once per text and workspace it ever had.
const parsedByItem = new WeakMap<StreamItem, { workspaceRoot: string; links: MessageLink[] }>();

function describe(
  source: AssistantFileLinkSource,
  token: string,
  options: { workspaceRoot: string; explicitLink?: boolean; decodeHref?: boolean },
): MessageLink | null {
  const classification = classifyAssistantFileLink(token, options);
  if (!classification) return null;
  if (classification.kind === "external") {
    const url = classification.raw.trim();
    if (!isListedUrl(url)) return null;
    return {
      key: `url:${url}`,
      kind: "url",
      source,
      label: shortUrl(url),
      detail: url,
      bareName: false,
    };
  }
  const { path, lineStart, lineEnd } = classification.target;
  if (!LISTED_FILE.test(path) || PLACEHOLDER.test(token)) return null;
  const lines = lineStart === undefined ? "" : `:${lineStart}${lineEnd ? `-${lineEnd}` : ""}`;
  const name = path.replace(/\/+$/, "").split("/").pop() || path;
  return {
    key: `file:${path}${lines}`,
    kind: "file",
    source,
    label: `${name}${lines}`,
    detail: `${path}${lines}`,
    bareName: !/[\\/]/.test(token.replace(/^file:\/\//i, "")),
  };
}

/**
 * The resolver calls anything shaped `word:` external, so prose like `note: see above` in a code
 * span would be listed. Only real web addresses are: http(s), a host that can resolve (a dotted
 * name, localhost or an IP, optionally with a port), and no placeholder text.
 */
export function isListedUrl(url: string): boolean {
  if (/\s/.test(url) || PLACEHOLDER.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (!host || EXAMPLE_HOST.test(host)) return false;
  return host.includes(".") || host === "localhost" || host.startsWith("[");
}

function shortUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function collectLinkTokens(tokens: readonly Token[], workspaceRoot: string, into: MessageLink[]) {
  let insideLink = 0;
  for (const token of tokens) {
    if (token.type === "link_open") {
      insideLink += 1;
      const href = token.attrGet("href")?.trim() ?? "";
      const link = href
        ? describe(markdownLinkSource(href), href, {
            workspaceRoot,
            explicitLink: true,
            decodeHref: true,
          })
        : null;
      if (link) into.push(link);
    } else if (token.type === "link_close") {
      insideLink = Math.max(0, insideLink - 1);
    } else if (token.type === "code_inline") {
      const link = describe(markdownLinkSource(token.content, "inline-code"), token.content, {
        workspaceRoot,
      });
      if (link) into.push(link);
    } else if (token.type === "text" && insideLink === 0) {
      for (const match of token.content.matchAll(PROSE_LINK_PATTERN)) {
        const link = describe(markdownLinkSource(match[0], "text"), match[0], { workspaceRoot });
        if (link) into.push(link);
      }
    }
    // Image alt text is not a link in the chat either.
    if (token.children && token.type !== "image") {
      collectLinkTokens(token.children, workspaceRoot, into);
    }
  }
}

/** The links the chat renders for one message: Markdown links, linked code spans and bare text. */
export function parseMessageLinks(text: string, workspaceRoot: string): MessageLink[] {
  const links: MessageLink[] = [];
  collectLinkTokens(parser.parse(text, {}), workspaceRoot, links);
  return links.length > 0 ? links : NO_LINKS;
}

function linksOf(item: StreamItem, workspaceRoot: string): MessageLink[] {
  if (item.kind !== "assistant_message") return NO_LINKS;
  const cached = parsedByItem.get(item);
  if (cached && cached.workspaceRoot === workspaceRoot) return cached.links;
  const links = parseMessageLinks(item.text, workspaceRoot);
  parsedByItem.set(item, { workspaceRoot, links });
  return links;
}

/**
 * Every distinct link in the loaded transcript, oldest first. A link the agent repeats moves to
 * where it was last sent.
 */
export function collectChatLinks(items: readonly StreamItem[], workspaceRoot: string): ChatLink[] {
  const byKey = new Map<string, ChatLink>();
  for (const item of items) {
    const links = linksOf(item, workspaceRoot);
    if (links.length === 0) continue;
    const messageId = getStreamItemMessageId(item);
    for (const link of links) {
      byKey.delete(link.key);
      byKey.set(link.key, { ...link, messageId });
    }
  }
  // `CHANGES.md` after `custom/CHANGES.md` is the same file mentioned in short; the guess the
  // resolver makes for the bare name would list it twice under one label.
  const namedWithFolder = new Set(
    [...byKey.values()]
      .filter((link) => link.kind === "file" && !link.bareName)
      .map((l) => l.label),
  );
  return [...byKey.values()].filter((link) => !link.bareName || !namedWithFolder.has(link.label));
}
