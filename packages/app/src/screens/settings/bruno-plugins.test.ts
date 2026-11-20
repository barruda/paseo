import { describe, expect, it } from "vitest";
import type { PluginInstallation, PluginListItem } from "@getpaseo/protocol/messages";
import { isBrunoPlugin, pluginDisplayName } from "./bruno-plugins";

function plugin(installation?: PluginInstallation): PluginListItem {
  return {
    id: "btw",
    path: "/plugins/btw",
    enabled: true,
    status: "running",
    installation,
  } as PluginListItem;
}

function directory(path: string): PluginListItem {
  return plugin({ identity: { kind: "directory", path } });
}

describe("bruno plugins", () => {
  it("treats a custom/plugins directory as Bruno's", () => {
    const item = directory("/home/bruno/projetos/paseo/custom/plugins/btw");
    expect(isBrunoPlugin(item)).toBe(true);
    expect(pluginDisplayName(item)).toBe("Bruno/btw");
  });

  it("accepts a trailing slash", () => {
    const item = directory("/home/bruno/projetos/paseo/custom/plugins/btw/");
    expect(isBrunoPlugin(item)).toBe(true);
    expect(pluginDisplayName(item)).toBe("Bruno/btw");
  });

  it.each(["/home/x/my-plugin", "/home/x/custom/plugins/a/b", "/home/x/custom/plugins"])(
    "treats directory %s as third-party",
    (path) => {
      const item = directory(path);
      expect(isBrunoPlugin(item)).toBe(false);
      expect(pluginDisplayName(item)).toBe("btw");
    },
  );

  it("treats git identities as third-party", () => {
    const item = plugin({
      identity: { kind: "git", remote: "https://github.com/x/custom/plugins/y", pluginPath: "." },
    });
    expect(isBrunoPlugin(item)).toBe(false);
    expect(pluginDisplayName(item)).toBe("btw");
  });

  it("treats registry identities as third-party", () => {
    const item = plugin({
      identity: {
        kind: "npm",
        packageName: "bots",
        pluginPath: ".",
        registry: { url: "https://plugins.paseo.sh", id: "oliexe/bots" },
      },
      currentRevision: "0.2.0",
    } as PluginInstallation);
    expect(isBrunoPlugin(item)).toBe(false);
    expect(pluginDisplayName(item)).toBe("btw");
  });

  it("treats a missing installation as third-party", () => {
    const item = plugin(undefined);
    expect(isBrunoPlugin(item)).toBe(false);
    expect(pluginDisplayName(item)).toBe("btw");
  });
});
