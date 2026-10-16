import { describe, expect, it } from "vitest";
import { resolveRunnableCommand } from "./model";

describe("resolveRunnableCommand", () => {
  it("strips the `! ` shorthand from a suggested command", () => {
    expect(resolveRunnableCommand("! gh auth login -h github.com -p https -w\n", "bash")).toBe(
      "gh auth login -h github.com -p https -w",
    );
    expect(resolveRunnableCommand("!git status", null)).toBe("git status");
  });

  it("strips `$ ` prompts but keeps a leading variable", () => {
    expect(resolveRunnableCommand("$ npm test", "sh")).toBe("npm test");
    expect(resolveRunnableCommand("$HOME/bin/tool --flag", "zsh")).toBe("$HOME/bin/tool --flag");
  });

  it("keeps only the prompted lines of a console transcript", () => {
    const transcript = "$ git status\nOn branch main\nnothing to commit\n$ git log -1\n";
    expect(resolveRunnableCommand(transcript, "console")).toBe("git status\ngit log -1");
  });

  it("accepts short scripts in shell blocks", () => {
    expect(resolveRunnableCommand("cd packages/app\n\nnpm run typecheck\n", "shell")).toBe(
      "cd packages/app\nnpm run typecheck",
    );
  });

  it("accepts single-line unlabeled blocks only", () => {
    expect(resolveRunnableCommand("ls -la\n", undefined)).toBe("ls -la");
    expect(resolveRunnableCommand("first line\nsecond line\n", null)).toBeNull();
  });

  it("rejects other languages, empty blocks, and long scripts", () => {
    expect(resolveRunnableCommand("const x = 1;", "ts")).toBeNull();
    expect(resolveRunnableCommand("print('hi')", "python")).toBeNull();
    expect(resolveRunnableCommand("\n  \n", "bash")).toBeNull();
    const longScript = Array.from({ length: 13 }, (_, index) => `echo ${index}`).join("\n");
    expect(resolveRunnableCommand(longScript, "bash")).toBeNull();
  });

  it("matches the language case-insensitively", () => {
    expect(resolveRunnableCommand("echo hi", "Bash")).toBe("echo hi");
  });
});
