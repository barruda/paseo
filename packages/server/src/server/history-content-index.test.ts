import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import { claudeProjectDirSync } from "./agent/providers/claude/project-dir.js";
import { parseHistoryQuery } from "@getpaseo/protocol/search/history-query";
import { HistoryContentIndex, parseSnippet, toFtsExpression } from "./history-content-index.js";
import { backfillHistoryContent } from "./history-content-indexer.js";

// CUSTOM(history-content-search)

function search(index: HistoryContentIndex, query: string) {
  return index.search(parseHistoryQuery(query));
}

function matchedIds(index: HistoryContentIndex, query: string): string[] {
  return [...search(index, query).matches.keys()].sort();
}

function matchedText(index: HistoryContentIndex, query: string, agentId: string): string | null {
  const match = search(index, query).matches.get(agentId);
  if (!match) return null;
  return match.ranges
    .map((range) => match.text.slice(range.start, range.start + range.length))
    .join("|");
}

describe("HistoryContentIndex", () => {
  let index: HistoryContentIndex;

  beforeEach(() => {
    index = new HistoryContentIndex(":memory:");
  });

  afterEach(() => {
    index.close();
  });

  it("finds a session by any word of its messages, ignoring case and accents", () => {
    index.addMessages("agent-a", [
      { role: "user", text: "Corrigir o reconexão do Relay quando o WebSocket cai" },
      { role: "assistant", text: "Done, the relay now retries." },
    ]);
    index.addMessages("agent-b", [{ role: "user", text: "Add a dark theme" }]);

    expect(matchedIds(index, "reconexao relay")).toEqual(["agent-a"]);
    expect(matchedText(index, "reconexao relay", "agent-a")).toBe("reconexão|Relay");
    expect(search(index, "dark").matches.get("agent-b")?.role).toBe("user");
  });

  it("matches word prefixes so a half-typed word already finds the session", () => {
    index.addMessages("agent-a", [
      { role: "assistant", text: "The workspace registry is rebuilt." },
    ]);

    expect(matchedText(index, "regis", "agent-a")).toBe("registry");
  });

  it("requires every word to appear in the same message", () => {
    index.addMessages("agent-a", [
      { role: "user", text: "first message about apples" },
      { role: "user", text: "second message about pears" },
    ]);

    expect(matchedIds(index, "apples pears")).toEqual([]);
  });

  it("never stores the same message twice", () => {
    const messages = [{ role: "user" as const, text: "same words" }];
    expect(index.addMessages("agent-a", messages)).toBe(1);
    expect(index.addMessages("agent-a", messages)).toBe(0);
    expect(index.addMessages("agent-b", messages)).toBe(1);
  });

  it("treats FTS syntax in the query as plain words", () => {
    index.addMessages("agent-a", [{ role: "user", text: "fix the NEAR bug in foo.ts" }]);

    expect(matchedIds(index, '"NEAR" (foo* ts)')).toEqual(["agent-a"]);
    expect(matchedIds(index, "  ** ")).toEqual([]);
  });

  it("matches a quoted phrase only as adjacent whole words", () => {
    index.addMessages("agent-a", [{ role: "user", text: "Run them all at once, please" }]);
    index.addMessages("agent-b", [{ role: "user", text: "Look at it once more" }]);
    index.addMessages("agent-c", [{ role: "user", text: "Attack at onceover speed" }]);

    expect(matchedIds(index, '"at once"')).toEqual(["agent-a"]);
    expect(matchedText(index, '"at once"', "agent-a")).toBe("at once");
    expect(matchedIds(index, "at once")).toEqual(["agent-a", "agent-b", "agent-c"]);
    expect(matchedIds(index, '"attack"')).toEqual(["agent-c"]);
    expect(matchedIds(index, '"att"')).toEqual([]);
  });

  it("keeps the last word of a phrase a prefix while its quote is still open", () => {
    index.addMessages("agent-a", [{ role: "user", text: "Run them all at once" }]);

    expect(matchedIds(index, '"at on')).toEqual(["agent-a"]);
  });

  it("matches either side of OR, binding tighter than the implicit AND", () => {
    index.addMessages("agent-a", [{ role: "user", text: "relay drops the socket" }]);
    index.addMessages("agent-b", [{ role: "user", text: "relay keeps the tunnel" }]);
    index.addMessages("agent-c", [{ role: "user", text: "tunnel without anything else" }]);

    expect(matchedIds(index, "relay socket OR tunnel")).toEqual(["agent-a", "agent-b"]);
    expect(matchedIds(index, "socket | tunnel")).toEqual(["agent-a", "agent-b", "agent-c"]);
    expect(matchedIds(index, "relay or tunnel")).toEqual([]);
  });

  it("drops a session when any of its messages mentions an excluded term", () => {
    index.addMessages("agent-a", [
      { role: "user", text: "deploy the relay" },
      { role: "assistant", text: "Rolled back the staging deploy." },
    ]);
    index.addMessages("agent-b", [{ role: "user", text: "deploy the relay" }]);

    const result = search(index, 'deploy -"staging deploy"');
    expect([...result.matches.keys()]).toEqual(["agent-b"]);
    expect([...result.excludedAgentIds]).toEqual(["agent-a"]);
    expect([...search(index, "-roll").excludedAgentIds]).toEqual(["agent-a"]);
    expect(search(index, "-roll").matches.size).toBe(0);
  });

  it("remembers which sessions were backfilled", () => {
    index.markBackfilled("agent-a");
    expect(index.backfilledAgentIds()).toEqual(new Set(["agent-a"]));
  });
});

describe("toFtsExpression", () => {
  it("quotes every term so typed operators never reach FTS", () => {
    expect(toFtsExpression(parseHistoryQuery('relay "web-socket" a OR b*').required)).toBe(
      '"relay"* AND "web socket" AND ("a"* OR "b"*)',
    );
    expect(toFtsExpression(parseHistoryQuery("!! OR").required)).toBeNull();
  });
});

describe("parseSnippet", () => {
  it("turns marker characters into ranges and collapses whitespace", () => {
    expect(parseSnippet("…the \u0001relay\u0002\n\n  is \u0001up\u0002")).toEqual({
      text: "…the relay is up",
      ranges: [
        { start: 5, length: 5 },
        { start: 14, length: 2 },
      ],
    });
  });
});

describe("backfillHistoryContent", () => {
  let root: string;
  let index: HistoryContentIndex;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "history-content-"));
    index = new HistoryContentIndex(":memory:");
  });

  afterEach(() => {
    index.close();
    rmSync(root, { recursive: true, force: true });
  });

  function record(input: { id: string; provider: string; sessionId: string }): StoredAgentRecord {
    return {
      id: input.id,
      provider: input.provider,
      cwd: path.join(root, "project"),
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
      labels: {},
      lastStatus: "closed",
      persistence: { provider: input.provider, sessionId: input.sessionId },
    };
  }

  function jsonl(lines: unknown[]): string {
    return lines.map((line) => JSON.stringify(line)).join("\n");
  }

  it("reads what people and agents said from Claude and Codex transcripts", async () => {
    const claudeHome = path.join(root, "claude");
    const codexHome = path.join(root, "codex");
    mkdirSync(path.join(root, "project"));
    const claudeDir = claudeProjectDirSync(path.join(root, "project"), { configDir: claudeHome });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "claude-session.jsonl"),
      jsonl([
        { type: "user", message: { content: "deploy the android build" } },
        { type: "user", isMeta: true, message: { content: "meta zebra" } },
        { type: "user", message: { content: "<command-name>/zebra</command-name>" } },
        {
          type: "user",
          message: { content: [{ type: "tool_result", content: "zebra output" }] },
        },
        { type: "assistant", message: { content: [{ type: "text", text: "Built the APK." }] } },
      ]),
    );
    const rolloutDir = path.join(codexHome, "archived_sessions");
    mkdirSync(rolloutDir, { recursive: true });
    const threadId = "01a11cba-1768-7d20-b664-701f289fc3dc";
    writeFileSync(
      path.join(rolloutDir, `rollout-2026-10-08T15-15-20-${threadId}.jsonl`),
      jsonl([
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "# AGENTS.md instructions zebra" }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "rename the shader keywords" }],
          },
        },
        {
          type: "response_item",
          payload: { type: "custom_tool_call_output", output: "zebra" },
        },
      ]),
    );

    const count = await backfillHistoryContent({
      index,
      env: { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome },
      records: async () => [
        record({ id: "agent-claude", provider: "claude", sessionId: "claude-session" }),
        record({ id: "agent-codex", provider: "codex", sessionId: threadId }),
        record({ id: "agent-missing", provider: "claude", sessionId: "gone" }),
      ],
    });

    expect(count).toBe(2);
    expect(matchedIds(index, "android")).toEqual(["agent-claude"]);
    expect(search(index, "apk").matches.get("agent-claude")?.role).toBe("assistant");
    expect(matchedIds(index, "shader")).toEqual(["agent-codex"]);
    expect(search(index, "zebra").matches.size).toBe(0);
    expect(index.backfilledAgentIds()).toEqual(
      new Set(["agent-claude", "agent-codex", "agent-missing"]),
    );

    const again = await backfillHistoryContent({
      index,
      env: { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome },
      records: async () => [record({ id: "agent-claude", provider: "claude", sessionId: "x" })],
    });
    expect(again).toBe(0);
  });
});
