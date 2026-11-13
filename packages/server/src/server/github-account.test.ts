// CUSTOM(github-account)
import { describe, expect, it } from "vitest";
import { applyGithubConfigDir, expandHomeDir, resolveGithubConfigDir } from "./github-account.js";

describe("github account config dir", () => {
  it("expands a leading tilde", () => {
    expect(expandHomeDir("~/.config/gh-personal", "/home/me")).toBe("/home/me/.config/gh-personal");
    expect(expandHomeDir("~", "/home/me")).toBe("/home/me");
    expect(expandHomeDir("/abs/gh", "/home/me")).toBe("/abs/gh");
    expect(expandHomeDir("a/~/b", "/home/me")).toBe("a/~/b");
  });

  it("prefers the setting over the launcher value", () => {
    expect(
      resolveGithubConfigDir({
        configured: "~/.config/gh",
        launchValue: "/launcher/gh",
        homedir: "/home/me",
      }),
    ).toEqual({ configDir: "/home/me/.config/gh", source: "settings" });
  });

  it("falls back to the launcher value, then to gh's default", () => {
    expect(resolveGithubConfigDir({ configured: "  ", launchValue: "/launcher/gh" })).toEqual({
      configDir: "/launcher/gh",
      source: "launcher",
    });
    expect(resolveGithubConfigDir({ configured: undefined, launchValue: undefined })).toEqual({
      configDir: undefined,
      source: "default",
    });
  });

  it("writes the setting into the env and restores the launch value when cleared", () => {
    const env: NodeJS.ProcessEnv = { GH_CONFIG_DIR: "/launcher/gh" };
    const options = { env, launchValue: "/launcher/gh", homedir: "/home/me" };
    applyGithubConfigDir("~/.config/gh-personal", options);
    expect(env.GH_CONFIG_DIR).toBe("/home/me/.config/gh-personal");
    applyGithubConfigDir(undefined, options);
    expect(env.GH_CONFIG_DIR).toBe("/launcher/gh");
  });

  it("deletes the variable when the setting is cleared and the launcher had none", () => {
    const env: NodeJS.ProcessEnv = {};
    const options = { env, launchValue: undefined };
    applyGithubConfigDir("/custom/gh", options);
    expect(env.GH_CONFIG_DIR).toBe("/custom/gh");
    applyGithubConfigDir("", options);
    expect("GH_CONFIG_DIR" in env).toBe(false);
  });
});
