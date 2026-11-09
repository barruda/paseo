// CUSTOM(skills-loaded): end to end over a fake home folder.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadForAgent } from "./handler.ts";
import { encodeClaudeProject } from "./sources.ts";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const SESSION = "11111111-2222-3333-4444-555555555555";
const THREAD = "01a1bcd3-0000-7000-8000-000000000001";

function fakeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), "skills-loaded-"));
  const cwd = path.join(home, "project");
  mkdirSync(path.join(cwd, ".claude", "skills", "paseo-customizations"), { recursive: true });
  writeFileSync(path.join(cwd, ".claude", "skills", "paseo-customizations", "SKILL.md"), "---\nname: paseo-customizations\ndescription: x\n---\n");
  const personal = path.join(home, ".claude-personal");
  mkdirSync(path.join(personal, "skills", "jev-router"), { recursive: true });
  writeFileSync(path.join(personal, "skills", "jev-router", "SKILL.md"), "---\nname: jev-router\ndescription: x\n---\n");
  const project = path.join(personal, "projects", encodeClaudeProject(cwd));
  mkdirSync(project, { recursive: true });
  copyFileSync(fixture("claude-session.jsonl"), path.join(project, `${SESSION}.jsonl`));
  const day = path.join(home, ".codex", "sessions", "2026", "11", "08");
  mkdirSync(day, { recursive: true });
  const rollout = path.join(day, `rollout-2026-11-08T17-22-49-${THREAD}.jsonl`);
  // The fixture ran in /home/user/project; point it at this fake project.
  writeFileSync(rollout, readFileSync(fixture("codex-rollout.jsonl"), "utf8").replaceAll("/home/user/project", cwd));
  copyFileSync(fixture("codex-config.toml"), path.join(home, ".codex", "config.toml"));
  return { home, cwd, personal, project };
}

test("claude: reads the agent's transcript, CLAUDE_CONFIG_DIR first", async () => {
  const { home, cwd, personal } = fakeHome();
  const result = await loadForAgent(
    { provider: "claude", cwd, sessionId: SESSION },
    { env: { CLAUDE_CONFIG_DIR: personal }, home },
  );
  assert.equal(result.source, "session");
  assert.deepEqual(
    result.skills.filter((skill) => skill.group === "custom").map((skill) => skill.name),
    ["jev-router", "paseo-customizations"],
  );
  assert.deepEqual(
    result.skills.filter((skill) => skill.group === "name-only").map((skill) => skill.name),
    ["anthropic-skills:pdf", "anthropic-skills:xlsx"],
  );
  assert.equal(result.mcpServers.length, 6);
});

test("claude: finds the transcript under ~/.claude-personal without the env var", async () => {
  const { home, cwd } = fakeHome();
  const result = await loadForAgent({ provider: "claude", cwd, sessionId: SESSION }, { env: {}, home });
  assert.equal(result.source, "session");
});

test("claude: no session yet falls back to the project's newest transcript", async () => {
  const { home, cwd, personal, project } = fakeHome();
  const older = path.join(project, "00000000-0000-0000-0000-000000000000.jsonl");
  copyFileSync(fixture("claude-compacted.jsonl"), older);
  utimesSync(older, new Date("2026-01-01"), new Date("2026-01-01"));
  const result = await loadForAgent({ provider: "claude", cwd, sessionId: null }, { env: { CLAUDE_CONFIG_DIR: personal }, home });
  assert.equal(result.source, "last-session");
  assert.equal(path.basename(result.sessionFile ?? ""), `${SESSION}.jsonl`);
  // ToolSearch loads belong to that session, not to a new one.
  assert.equal(result.mcpServers.find((server) => server.name === "paseo")?.fullSchemaCount, 0);
});

test("claude: nothing known when the project has no session", async () => {
  const { home } = fakeHome();
  const result = await loadForAgent({ provider: "claude", cwd: "/nowhere", sessionId: null }, { env: {}, home });
  assert.equal(result.source, "none");
  assert.deepEqual(result.skills, []);
});

test("codex: reads the rollout by thread id, MCP servers from config.toml", async () => {
  const { home, cwd } = fakeHome();
  const result = await loadForAgent({ provider: "codex", cwd, sessionId: THREAD }, { env: {}, home });
  assert.equal(result.source, "session");
  assert.equal(result.mcpSource, "config");
  assert.deepEqual(
    result.skills.map((skill) => [skill.name, skill.category, skill.group]),
    [
      ["backup-db-and-essential", "custom", "custom"],
      ["name-only-skill", "custom", "custom"],
      ["rebase-report", "custom", "custom"],
      ["telink-numpad", "custom", "custom"],
      ["imagegen", "bundled", "described"],
      ["skill-creator", "bundled", "described"],
      ["unity:urp-postprocessing", "plugin", "described"],
    ],
  );
  assert.deepEqual(result.mcpServers.map((server) => [server.name, server.status]), [
    ["blender mcp", "configured"],
    ["brave-zmw", "configured"],
    ["unityMCP", "disabled"],
  ]);
});

test("codex: no rollout yet falls back to the newest one in the same cwd", async () => {
  const { home, cwd } = fakeHome();
  const result = await loadForAgent({ provider: "codex", cwd, sessionId: null }, { env: {}, home });
  assert.equal(result.source, "last-session");
  assert.equal(result.skills.length, 7);
});

test("other providers are not read", async () => {
  const result = await loadForAgent({ provider: "opencode", cwd: "/x", sessionId: "y" }, { env: {}, home: "/x" });
  assert.equal(result.source, "unsupported");
});
