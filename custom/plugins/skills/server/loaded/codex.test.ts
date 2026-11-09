// CUSTOM(skills-loaded)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { extractSkillsText, parseCodexMcpConfig, parseCodexSkills, parseSessionMeta } from "./codex.ts";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("the last skills message in the rollout wins, with roots resolved", () => {
  const lines = read("codex-rollout.jsonl").split("\n");
  let text: string | null = null;
  for (const line of lines) text = extractSkillsText(line) ?? text;
  assert.ok(text);
  const skills = parseCodexSkills(text);
  assert.deepEqual(
    skills.map((skill) => skill.name),
    ["name-only-skill", "unity:urp-postprocessing", "imagegen", "skill-creator", "backup-db-and-essential", "rebase-report", "telink-numpad"],
  );
  assert.deepEqual(skills[0], { name: "name-only-skill", description: "", root: "/home/user/agent-skills" });
  assert.equal(skills[2]?.root, "/home/user/agent-skills/.system");
  assert.match(skills[4]?.description ?? "", /^Use when the user asks to back up/);
  assert.ok(!(skills[4]?.description ?? "").includes("(file:"));
});

test("session meta gives the thread id and cwd", () => {
  const first = read("codex-rollout.jsonl").split("\n")[0]!;
  assert.deepEqual(parseSessionMeta(first), { id: "01a1bcd3-0000-7000-8000-000000000001", cwd: "/home/user/project" });
  assert.equal(parseSessionMeta('{"type":"event_msg"}'), null);
});

test("config.toml: mcp server tables, enabled = false, subtables belong to their server", () => {
  assert.deepEqual(parseCodexMcpConfig(read("codex-config.toml")), [
    { name: "brave-zmw", enabled: true },
    { name: "unityMCP", enabled: false },
    { name: "blender mcp", enabled: true },
  ]);
});
