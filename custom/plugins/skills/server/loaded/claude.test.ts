// CUSTOM(skills-loaded)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { mcpServerOfTool, normalizeServerName, parseClaudeTranscript, parseSkillListingContent } from "./claude.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").split("\n");

test("skill listing: names decide where an entry starts, descriptions span lines, name-only kept", () => {
  const content = [
    "- Notion:tasks:build: Build a task from a Notion page URL",
    "- claude-api: Reference for the Claude API.",
    "TRIGGER — read BEFORE opening the target file",
    "- anthropic-skills:pdf",
  ].join("\n");
  const skills = parseSkillListingContent(content, ["Notion:tasks:build", "claude-api", "anthropic-skills:pdf", "missing"]);
  assert.deepEqual(skills, [
    { name: "Notion:tasks:build", description: "Build a task from a Notion page URL" },
    { name: "claude-api", description: "Reference for the Claude API.\nTRIGGER — read BEFORE opening the target file" },
    { name: "anthropic-skills:pdf", description: "" },
    { name: "missing", description: "" },
  ]);
});

test("skill listing without names splits at the first colon-space", () => {
  assert.deepEqual(parseSkillListingContent("- a:b: desc: more\n- c", []), [
    { name: "a:b", description: "desc: more" },
    { name: "c", description: "" },
  ]);
});

test("transcript: skills, tools, schemas, instructions and server state accumulate", () => {
  const state = parseClaudeTranscript(fixture("claude-session.jsonl"), { includeToolSearch: true });
  assert.deepEqual([...state.skills.keys()], [
    "jev-router",
    "paseo-customizations",
    "Notion:tasks:build",
    "claude-api",
    "dataviz",
    "anthropic-skills:pdf",
    "anthropic-skills:xlsx",
    "telink-numpad",
  ]);
  assert.equal(state.skills.get("anthropic-skills:pdf")?.description, "");
  assert.match(state.skills.get("claude-api")?.description ?? "", /\nSKIP only when/);
  assert.ok(!state.tools.has("mcp__claude_ai_Claude_Docs__create"), "removed by a later delta");
  assert.ok(state.tools.has("mcp__paseo__create_agent"));
  assert.deepEqual([...state.fullSchemaTools].sort(), [
    "mcp__claude_ai_Claude_Docs__batch",
    "mcp__claude_ai_Claude_Docs__guide",
    "mcp__paseo__list_agents",
  ]);
  assert.deepEqual([...state.instructions], ["claude.ai Claude Docs", "claude.ai Notion"]);
  assert.deepEqual(state.needsAuth, ["claude.ai Gmail"]);
  assert.deepEqual(state.pending, ["claude.ai Notion"]);
  assert.deepEqual(state.failed, [{ name: "UnityMCP", error: "Connection closed" }]);
});

test("transcript: ToolSearch loads are skipped when predicting a new session", () => {
  const state = parseClaudeTranscript(fixture("claude-session.jsonl"), { includeToolSearch: false });
  assert.ok(!state.fullSchemaTools.has("mcp__paseo__list_agents"));
  assert.ok(state.tools.has("mcp__paseo__list_agents"));
});

test("transcript: compaction drops what came before it", () => {
  const state = parseClaudeTranscript(fixture("claude-compacted.jsonl"), { includeToolSearch: true });
  assert.deepEqual([...state.skills.keys()], ["new-skill"]);
  assert.deepEqual([...state.tools].sort(), ["Bash", "mcp__new__tool"]);
  assert.equal(state.fullSchemaTools.size, 0);
});

test("server names match tool names after normalization", () => {
  assert.equal(normalizeServerName("claude.ai Notion"), "claude_ai_Notion");
  assert.equal(normalizeServerName("plugin:Notion:notion"), "plugin_Notion_notion");
  assert.equal(mcpServerOfTool("mcp__plugin_Notion_notion__authenticate"), "plugin_Notion_notion");
  assert.equal(mcpServerOfTool("Bash"), null);
});
