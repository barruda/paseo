// CUSTOM(skills-loaded)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseClaudeTranscript } from "./claude.ts";
import { buildSkillRows, categorizeClaudeSkill, categorizeCodexSkill, summarizeClaudeMcp, summarizeCodexMcp } from "./report.ts";

test("rows: your skills first, then described, then name-only, A-Z within", () => {
  const rows = buildSkillRows([
    { name: "zeta", description: "z", category: "bundled" },
    { name: "mine-b", description: "", category: "custom" },
    { name: "plug:x", description: "", category: "plugin" },
    { name: "Alpha", description: "a", category: "plugin" },
    { name: "mine-a", description: "m", category: "custom" },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.name, row.group, row.hasDescription]),
    [
      ["mine-a", "custom", true],
      ["mine-b", "custom", false],
      ["Alpha", "described", true],
      ["zeta", "described", true],
      ["plug:x", "name-only", false],
    ],
  );
});

test("claude categories: user folders, plugin namespace, bundled", () => {
  const custom = new Set(["jev-router"]);
  assert.equal(categorizeClaudeSkill("jev-router", custom), "custom");
  assert.equal(categorizeClaudeSkill("Notion:find", custom), "plugin");
  assert.equal(categorizeClaudeSkill("dataviz", custom), "bundled");
});

test("codex categories come from the skill root", () => {
  const home = "/home/user/.codex";
  assert.equal(categorizeCodexSkill({ name: "imagegen", description: "", root: "/home/user/agent-skills/.system" }, home), "bundled");
  assert.equal(categorizeCodexSkill({ name: "unity:ui", description: "", root: "/home/user/.codex/plugins/cache/x" }, home), "plugin");
  assert.equal(categorizeCodexSkill({ name: "rebase-report", description: "", root: "/home/user/agent-skills" }, home), "custom");
});

test("claude MCP summary groups tools by server under the display name", () => {
  const lines = readFileSync(new URL("./fixtures/claude-session.jsonl", import.meta.url), "utf8").split("\n");
  const servers = summarizeClaudeMcp(parseClaudeTranscript(lines, { includeToolSearch: true }));
  assert.deepEqual(servers, [
    { name: "claude.ai Claude Docs", status: "loaded", error: null, toolCount: 2, fullSchemaCount: 2, instructions: true },
    { name: "paseo", status: "loaded", error: null, toolCount: 2, fullSchemaCount: 1, instructions: false },
    // Left the needs-auth list in a later delta; keeps the display name it had there.
    { name: "plugin:Notion:notion", status: "loaded", error: null, toolCount: 1, fullSchemaCount: 0, instructions: false },
    { name: "claude.ai Notion", status: "pending", error: null, toolCount: 0, fullSchemaCount: 0, instructions: true },
    { name: "claude.ai Gmail", status: "needs-auth", error: null, toolCount: 0, fullSchemaCount: 0, instructions: false },
    { name: "UnityMCP", status: "failed", error: "Connection closed", toolCount: 0, fullSchemaCount: 0, instructions: false },
  ]);
});

test("codex MCP summary marks configured and disabled servers", () => {
  assert.deepEqual(
    summarizeCodexMcp([{ name: "b", enabled: false }, { name: "a", enabled: true }]).map((s) => [s.name, s.status]),
    [["a", "configured"], ["b", "disabled"]],
  );
});
