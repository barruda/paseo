import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-project-model";
import {
  compareProjectPickerEntries,
  draftTabProjectChoices,
  sortProjectPickerEntries,
} from "./project-picker-order";

function project(name: string, path: string, workspaceKeys: string[] = []): HostProjectListItem {
  return {
    viewKey: `host:srv:${path}`,
    projectKey: `host:srv:${path}`,
    projectName: name,
    projectKind: "git",
    iconWorkingDir: path,
    hosts: [
      {
        serverId: "srv",
        projectId: `prj-${path}`,
        iconWorkingDir: path,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys,
  };
}

describe("project picker order", () => {
  it("sorts by name ignoring case and leading dots, ties broken by path", () => {
    const entries = [
      { name: "DreamMMO", path: "/a/DreamMMO" },
      { name: "gnome-custom", path: "/a/gnome-custom" },
      { name: "paseo", path: "/a/paseo" },
      { name: "mw-unity-mapeditor", path: "/a/mw" },
      { name: ".paseo-voice", path: "/home/.paseo-voice" },
      { name: "floccus", path: "/a/floccus" },
      { name: "PowerEditor", path: "/a/PowerEditor" },
      { name: "pipeline", path: "/z/pipeline" },
      { name: "assistant-chat", path: "/a/assistant-chat" },
      { name: "pipeline", path: "/b/pipeline" },
      { name: "unity-for-vfx", path: "/mnt/unity-for-vfx" },
    ];
    const sorted = sortProjectPickerEntries(entries, (entry) => entry);
    expect(sorted.map((entry) => `${entry.name} ${entry.path}`)).toEqual([
      "assistant-chat /a/assistant-chat",
      "DreamMMO /a/DreamMMO",
      "floccus /a/floccus",
      "gnome-custom /a/gnome-custom",
      "mw-unity-mapeditor /a/mw",
      "paseo /a/paseo",
      ".paseo-voice /home/.paseo-voice",
      "pipeline /b/pipeline",
      "pipeline /z/pipeline",
      "PowerEditor /a/PowerEditor",
      "unity-for-vfx /mnt/unity-for-vfx",
    ]);
  });

  it("keeps the displayed name and does not reorder the input", () => {
    const entries = [
      { name: "b", path: "/b" },
      { name: ".a", path: "/a" },
    ];
    const sorted = sortProjectPickerEntries(entries, (entry) => entry);
    expect(sorted.map((entry) => entry.name)).toEqual([".a", "b"]);
    expect(entries.map((entry) => entry.name)).toEqual(["b", ".a"]);
    expect(compareProjectPickerEntries({ name: "X", path: "/1" }, { name: "x", path: "/1" })).toBe(
      0,
    );
  });
});

describe("draftTabProjectChoices", () => {
  it("lists a project added without a workspace, in name order", () => {
    const withWorkspace = project("paseo", "/p/paseo", ["srv:ws1"]);
    const added = project("unity-for-vfx", "/mnt/unity-for-vfx");
    const dot = project(".paseo-voice", "/home/.paseo-voice", ["srv:ws2"]);
    const choices = draftTabProjectChoices({
      projects: [added, withWorkspace, dot],
      serverId: "srv",
      allowAllProjects: true,
      current: withWorkspace,
    });
    expect(choices.map((entry) => entry.projectName)).toEqual([
      "paseo",
      ".paseo-voice",
      "unity-for-vfx",
    ]);
  });

  it("keeps the current project even when the host cannot create a workspace for it", () => {
    const current = project("zeta", "/z");
    current.hosts = [{ ...current.hosts[0]!, worktreeSupport: "unsupported" }];
    const other = project("alpha", "/a");
    const choices = draftTabProjectChoices({
      projects: [current, other],
      serverId: "srv",
      allowAllProjects: false,
      current,
    });
    expect(choices.map((entry) => entry.projectName)).toEqual(["alpha", "zeta"]);
  });
});
