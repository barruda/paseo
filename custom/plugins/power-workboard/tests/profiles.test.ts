// CUSTOM(agent-profiles)
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orchestratorConfigSchema } from "../shared/model";
import { assistantChatSettingsSchema } from "../shared/assistant";
import { ASSISTANT_PROFILE, skillSelectionSchema } from "../shared/profiles";
import {
  ASSISTANT_SEED_PROMPT,
  CHAT_INSTRUCTIONS,
} from "../server/assistant/chat";
import { listSkills } from "../server/profile-skills";
import { Profiles, buildAgentProfile, pluginNameFor } from "../server/profiles";
import { Workboard } from "../server/workboard";
import { fixture } from "./fixtures";

const temporary = () => mkdtemp(path.join(os.tmpdir(), "pwb-profiles-"));
async function skill(root: string, folder: string, text: string) {
  await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(path.join(root, folder, "SKILL.md"), text);
}
const ID = "1a2b3c4d-0000-4000-8000-000000000000";

describe("profile folders", () => {
  it("creates the plugin folder once and changes nothing the second time", async () => {
    const profiles = new Profiles(await temporary());
    const first = await profiles.ensure({ id: ID, label: "Night Shift" });
    expect(first.pluginName).toBe("pwb-night-shift-1a2b3c");
    const manifest = path.join(
      first.directory,
      ".claude-plugin",
      "plugin.json",
    );
    expect(JSON.parse(await readFile(manifest, "utf8")).name).toBe(
      first.pluginName,
    );
    for (const entry of ["skills", "memory", "system-prompt.md"])
      expect(existsSync(path.join(first.directory, entry))).toBe(true);
    await profiles.setSystemPrompt(
      { id: ID, label: "Night Shift" },
      "Be terse",
    );
    const second = await profiles.ensure({
      id: ID,
      label: "Other",
      seedPrompt: "ignored",
    });
    expect(second).toEqual(first);
    expect(
      await readFile(path.join(first.directory, "system-prompt.md"), "utf8"),
    ).toBe("Be terse");
  });

  it("keeps the plugin name after the orchestrator is renamed", async () => {
    const profiles = new Profiles(await temporary());
    const before = await profiles.read({ id: ID, label: "Old name" });
    const after = await profiles.read({ id: ID, label: "A brand new name" });
    expect(after.pluginName).toBe(before.pluginName);
    expect(before.pluginName).toBe("pwb-old-name-1a2b3c");
    expect(before.systemPrompt).toBe("");
  });

  it("slugs the name to 30 characters and names the assistant's plugin", () => {
    const name = pluginNameFor(
      ID,
      "Ünïcode & a very long orchestrator name here!",
    );
    expect(name).toMatch(/^pwb-[a-z0-9-]+-1a2b3c$/);
    expect(name.length).toBeLessThanOrEqual(4 + 30 + 7);
    expect(pluginNameFor(ID, "!!!")).toBe("pwb-orchestrator-1a2b3c");
    expect(pluginNameFor(ASSISTANT_PROFILE, "Projects Assistant")).toBe(
      "pwb-assistant",
    );
  });

  it("seeds the assistant's prompt with its role and the memory exception", async () => {
    const profiles = new Profiles(await temporary());
    const view = await profiles.read({
      id: ASSISTANT_PROFILE,
      label: "Projects Assistant",
      seedPrompt: ASSISTANT_SEED_PROMPT,
    });
    expect(view.pluginName).toBe("pwb-assistant");
    expect(view.systemPrompt).toContain("You are the Projects Assistant");
    expect(view.systemPrompt).toContain(
      "Answer in the user's language, briefly.",
    );
    expect(view.systemPrompt).toContain("memory folder");
    expect(view.systemPrompt).not.toContain("saying you're ready");
    expect(CHAT_INSTRUCTIONS).toContain("Reply with one short line");
    expect(CHAT_INSTRUCTIONS).toContain("board_overview");
  });

  it("rejects ids that could leave the profiles folder", async () => {
    const profiles = new Profiles(await temporary());
    expect(() => profiles.directory("../x")).toThrow();
  });

  it("lists the profile's own skills with their descriptions", async () => {
    const profiles = new Profiles(await temporary());
    const { directory } = await profiles.ensure({ id: ID, label: "Mine" });
    await skill(
      path.join(directory, "skills"),
      "deploy",
      "---\nname: deploy\ndescription: Ship it\n---\nBody",
    );
    expect((await profiles.read({ id: ID, label: "Mine" })).ownSkills).toEqual([
      { name: "deploy", description: "Ship it" },
    ]);
  });
});

describe("the agent a profile builds", () => {
  const profile = {
    directory: "/p/dir",
    pluginName: "pwb-x-abcdef",
    systemPrompt: "  Be careful.\n",
    ownSkills: [{ name: "deploy" }],
  };
  const all = skillSelectionSchema.parse({});

  it("Claude, all skills, memory on: the plugin and the memory folder, no allowlist", () => {
    expect(
      buildAgentProfile({
        provider: "claude/claude-opus-5-5",
        profile,
        skills: all,
        memory: true,
      }),
    ).toEqual({
      systemPrompt: "Be careful.",
      providerOptions: {
        plugins: [{ type: "local", path: "/p/dir" }],
        settings: { autoMemoryDirectory: "/p/dir/memory" },
      },
    });
  });

  it("selected skills add the profile's own, qualified", () => {
    const built = buildAgentProfile({
      provider: "claude/claude-opus-5-5",
      profile,
      skills: { mode: "selected", names: ["review", "notion:search"] },
      memory: false,
    });
    expect(built.providerOptions).toEqual({
      plugins: [{ type: "local", path: "/p/dir" }],
      skills: ["review", "notion:search", "pwb-x-abcdef:deploy"],
    });
  });

  it("selected with nothing chosen allows only the own skills, or none", () => {
    const none = buildAgentProfile({
      provider: "claude",
      profile: { ...profile, ownSkills: [] },
      skills: { mode: "selected", names: [] },
      memory: true,
    });
    expect(none.providerOptions?.skills).toEqual([]);
  });

  it("an empty prompt is omitted", () => {
    expect(
      buildAgentProfile({
        provider: "claude/x",
        profile: { ...profile, systemPrompt: " \n" },
        skills: all,
        memory: false,
      }).systemPrompt,
    ).toBeUndefined();
  });

  it("another provider gets the system prompt only", () => {
    expect(
      buildAgentProfile({
        provider: "codex/gpt-5",
        profile,
        skills: { mode: "selected", names: ["a"] },
        memory: true,
      }),
    ).toEqual({ systemPrompt: "Be careful." });
  });
});

describe("skill listing", () => {
  it("groups own, personal and installed plugin skills", async () => {
    const base = await temporary();
    const claudeHome = path.join(base, "claude");
    const agentsHome = path.join(base, "agents");
    const profileDirectory = path.join(base, "profile");
    await skill(
      path.join(profileDirectory, "skills"),
      "own",
      "---\ndescription: Mine\n---\n",
    );
    await skill(
      path.join(claudeHome, "skills"),
      "personal-one",
      "---\nname: personal-one\ndescription: >\n  Folded\n  text\n---\n",
    );
    await skill(
      path.join(agentsHome, "skills"),
      "agent-one",
      "---\nname: agent-one\ndescription: 'Quoted'\n---\n",
    );
    await mkdir(path.join(claudeHome, "skills", "broken"), { recursive: true });
    const install = path.join(claudeHome, "plugins", "cache", "m", "tool", "1");
    await mkdir(path.join(install, ".claude-plugin"), { recursive: true });
    await writeFile(
      path.join(install, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "tool-real" }),
    );
    await skill(
      path.join(install, "skills"),
      "search",
      "---\nname: search\ndescription: Find\n---\n",
    );
    await writeFile(
      path.join(claudeHome, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "tool@m": [{ scope: "user", installPath: install }],
          "gone@m": [{ scope: "user", installPath: path.join(base, "nope") }],
        },
      }),
    );
    const skills = await listSkills({
      profileDirectory,
      pluginName: "pwb-x-abcdef",
      roots: { claudeHome, agentsHome },
    });
    expect(
      skills.map(({ name, group, description }) => [name, group, description]),
    ).toEqual([
      ["pwb-x-abcdef:own", "profile", "Mine"],
      ["agent-one", "personal", "Quoted"],
      ["personal-one", "personal", "Folded text"],
      ["tool-real:search", "plugins", "Find"],
    ]);
    expect(skills[3]!.source).toBe(
      path.join(install, "skills", "search", "SKILL.md"),
    );
  });

  it("an empty machine lists nothing and does not fail", async () => {
    const base = await temporary();
    expect(
      await listSkills({
        profileDirectory: path.join(base, "p"),
        pluginName: "n",
        roots: {
          claudeHome: path.join(base, "c"),
          agentsHome: path.join(base, "a"),
        },
      }),
    ).toEqual([]);
  });
});

describe("settings schemas", () => {
  it("old orchestrator and assistant data parse with the defaults", () => {
    const orchestrator = orchestratorConfigSchema.parse({
      id: "o",
      name: "Old",
    });
    expect(orchestrator.skills).toEqual({ mode: "all", names: [] });
    expect(orchestrator.memory).toBe(true);
    const chat = assistantChatSettingsSchema.parse({
      provider: "claude/claude-opus-5-5",
    });
    expect(chat.skills).toEqual({ mode: "all", names: [] });
    expect(chat.memory).toBe(true);
  });
});

describe("the engine applies the profile", () => {
  async function engine() {
    const profilesDirectory = await temporary();
    const setup = fixture({ defaultOrchestratorSeeded: true });
    setup.inventory.projects.push({
      id: "p",
      name: "Project",
      directory: "/fixture",
      isGit: false,
    });
    const board = new Workboard(setup.host, setup.store, setup.now, 60000, {
      profilesDirectory,
      chatDirectory: path.join(profilesDirectory, "chat"),
    });
    await board.start();
    return { ...setup, board, profilesDirectory };
  }

  it("a task agent gets its orchestrator's plugin, skills and memory", async () => {
    const s = await engine();
    try {
      await s.board.mutate({
        action: "orchestrator-save",
        orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
          name: "Night Shift",
          schedule: { kind: "window", start: "00:00", end: "00:00" },
          skills: { mode: "selected", names: ["review"] },
        }),
      });
      const id = s.board.snapshot().orchestrators[0]!.id;
      await s.board.setProfilePrompt(id, "Work at night.");
      await s.board.mutate({
        action: "create",
        title: "Task",
        description: "Do it",
        projectId: "p",
      });
      const task = s.board.snapshot().cards.find((c) => c.title === "Task")!;
      await s.board.mutate({
        action: "stage",
        taskId: task.id,
        stage: "ready",
        expectedLabels: [],
      });
      const start = (s.host.startAgent as any).mock.calls[0][1];
      const directory = path.join(s.profilesDirectory, id);
      expect(start.systemPrompt).toBe("Work at night.");
      expect(start.providerOptions).toEqual({
        plugins: [{ type: "local", path: directory }],
        skills: ["review"],
        settings: { autoMemoryDirectory: path.join(directory, "memory") },
      });
      expect(start.prompt).not.toContain("Work at night.");
    } finally {
      s.board.dispose();
    }
  });

  it("the assistant chat agent gets the seeded prompt, the plugin and a short first message", async () => {
    const s = await engine();
    try {
      await s.board.openChat(false);
      const start = (s.host.startAgentIn as any).mock.calls[0][1];
      const directory = path.join(s.profilesDirectory, ASSISTANT_PROFILE);
      expect(start.prompt).toBe(CHAT_INSTRUCTIONS);
      expect(start.systemPrompt).toContain("You are the Projects Assistant");
      expect(start.providerOptions).toEqual({
        plugins: [{ type: "local", path: directory }],
        settings: { autoMemoryDirectory: path.join(directory, "memory") },
      });
      const view = await s.board.profileView(ASSISTANT_PROFILE);
      expect(view.pluginName).toBe("pwb-assistant");
      await expect(
        s.board.profileView("no-such-orchestrator"),
      ).rejects.toThrow();
    } finally {
      s.board.dispose();
    }
  });

  it("a non-Claude orchestrator gets only the system prompt", async () => {
    const s = await engine();
    try {
      await s.board.mutate({
        action: "orchestrator-save",
        orchestrator: orchestratorConfigSchema.omit({ id: true }).parse({
          name: "Codex",
          provider: "codex/gpt-5",
          schedule: { kind: "window", start: "00:00", end: "00:00" },
        }),
      });
      const id = s.board.snapshot().orchestrators[0]!.id;
      await s.board.setProfilePrompt(id, "Hello");
      await s.board.mutate({
        action: "create",
        title: "Task",
        description: "Do it",
        projectId: "p",
      });
      const task = s.board.snapshot().cards.find((c) => c.title === "Task")!;
      await s.board.mutate({
        action: "stage",
        taskId: task.id,
        stage: "ready",
        expectedLabels: [],
      });
      const start = (s.host.startAgent as any).mock.calls[0][1];
      expect(start.systemPrompt).toBe("Hello");
      expect(start.providerOptions).toBeUndefined();
    } finally {
      s.board.dispose();
    }
  });
});
