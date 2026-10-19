import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completePath, escapeShellWord } from "./complete";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "shell-complete-"));
  await mkdir(path.join(root, "src", "components"), { recursive: true });
  await writeFile(path.join(root, "src", "config.ts"), "");
  await writeFile(path.join(root, "src", "my file.ts"), "");
  await writeFile(path.join(root, ".env"), "");
  await writeFile(path.join(root, "README.md"), "");
  await symlink(path.join(root, "src"), path.join(root, "linked"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("completePath", () => {
  it("completes names in a folder relative to cwd, folders with a slash", async () => {
    await expect(completePath({ cwd: root, word: "src/co" })).resolves.toEqual([
      { value: "src/components/", kind: "directory" },
      { value: "src/config.ts", kind: "file" },
    ]);
  });

  it("hides dotfiles unless the prefix starts with a dot", async () => {
    const all = await completePath({ cwd: root, word: "" });
    expect(all.map((entry) => entry.value)).toEqual(["linked/", "README.md", "src/"]);
    await expect(completePath({ cwd: root, word: "." })).resolves.toEqual([
      { value: ".env", kind: "file" },
    ]);
  });

  it("escapes names and reads escaped words", async () => {
    await expect(completePath({ cwd: root, word: "src/my" })).resolves.toEqual([
      { value: "src/my\\ file.ts", kind: "file" },
    ]);
    await expect(completePath({ cwd: root, word: "src/my\\ f" })).resolves.toEqual([
      { value: "src/my\\ file.ts", kind: "file" },
    ]);
  });

  it("resolves absolute paths and ~, keeping the word as typed", async () => {
    await expect(completePath({ cwd: "/", word: `${root}/READ` })).resolves.toEqual([
      { value: `${root}/README.md`, kind: "file" },
    ]);
    await expect(completePath({ cwd: "/", word: "~/READ" }, root)).resolves.toEqual([
      { value: "~/README.md", kind: "file" },
    ]);
  });

  it("returns nothing for a missing folder", async () => {
    await expect(completePath({ cwd: root, word: "nope/x" })).resolves.toEqual([]);
  });
});

describe("escapeShellWord", () => {
  it("escapes what a shell would split or expand", () => {
    expect(escapeShellWord("a b$(c)'d'")).toBe("a\\ b\\$\\(c\\)\\'d\\'");
    expect(escapeShellWord("notes~")).toBe("notes~");
  });
});
