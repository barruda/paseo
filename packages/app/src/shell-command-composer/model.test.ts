import { describe, expect, it } from "vitest";
import {
  applyShellCompletion,
  buildShellCompletions,
  findShellWord,
  shellCommandOffset,
  stepHistory,
  type HistoryNavigation,
} from "./model";

const HISTORY = ["git status", "npm test", "git push origin main", "ls -la", "git pull"];

describe("shellCommandOffset", () => {
  it("finds the command after `!` on a one-line text", () => {
    expect(shellCommandOffset("!git")).toBe(1);
    expect(shellCommandOffset("  ! git")).toBe(4);
    expect(shellCommandOffset("hello !git")).toBeNull();
    expect(shellCommandOffset("!git\nmore")).toBeNull();
  });
});

describe("findShellWord", () => {
  it("returns the word the cursor ends and whether it is the command", () => {
    expect(findShellWord("!cat src/co", 11, 1)).toEqual({
      start: 5,
      end: 11,
      text: "src/co",
      isCommand: false,
    });
    expect(findShellWord("!gi", 3, 1)).toMatchObject({ text: "gi", isCommand: true });
  });

  it("keeps escaped spaces inside the word", () => {
    expect(findShellWord("!cat my\\ fi", 11, 1)).toMatchObject({ start: 5, text: "my\\ fi" });
  });
});

describe("buildShellCompletions", () => {
  it("lists history that extends the line, newest first, then matching paths", () => {
    const completions = buildShellCompletions({
      text: "!git p",
      cursor: 6,
      history: HISTORY,
      paths: [
        { value: "package.json", kind: "file" },
        { value: "packages/", kind: "directory" },
        { value: "README.md", kind: "file" },
      ],
    });
    expect(completions.map((c) => (c.type === "history" ? c.command : c.value))).toEqual([
      "git push origin main",
      "git pull",
      "package.json",
      "packages/",
    ]);
  });

  it("lists only history for an empty command", () => {
    const completions = buildShellCompletions({
      text: "!",
      cursor: 1,
      history: HISTORY,
      paths: [{ value: "src/", kind: "directory" }],
    });
    expect(completions.every((c) => c.type === "history")).toBe(true);
    expect(completions).toHaveLength(HISTORY.length);
  });

  it("skips history when the cursor is not at the end", () => {
    const completions = buildShellCompletions({
      text: "!cat s more",
      cursor: 6,
      history: ["cat s more stuff"],
      paths: [{ value: "src/", kind: "directory" }],
    });
    expect(completions).toEqual([expect.objectContaining({ type: "path", value: "src/" })]);
  });
});

describe("applyShellCompletion", () => {
  it("replaces the line with a history entry", () => {
    expect(applyShellCompletion("! git p", { type: "history", command: "git pull" })).toBe(
      "! git pull",
    );
  });

  it("replaces the word with a path; files get a trailing space", () => {
    const word = findShellWord("!cat src/co x", 11, 1);
    expect(
      applyShellCompletion("!cat src/co x", {
        type: "path",
        value: "src/config.ts",
        kind: "file",
        word,
      }),
    ).toBe("!cat src/config.ts x");
    expect(
      applyShellCompletion("!cat src/co", {
        type: "path",
        value: "src/config.ts",
        kind: "file",
        word: findShellWord("!cat src/co", 11, 1),
      }),
    ).toBe("!cat src/config.ts ");
    expect(
      applyShellCompletion("!cd src/co", {
        type: "path",
        value: "src/components/",
        kind: "directory",
        word: findShellWord("!cd src/co", 10, 1),
      }),
    ).toBe("!cd src/components/");
  });
});

describe("stepHistory", () => {
  function walk(text: string, keys: Array<"up" | "down">) {
    let navigation: HistoryNavigation | null = null;
    let current = text;
    const seen: Array<string | null> = [];
    for (const direction of keys) {
      const step = stepHistory({ navigation, history: HISTORY, text: current, direction });
      if (!step) {
        seen.push(null);
        continue;
      }
      navigation = step.navigation;
      current = step.text;
      seen.push(current);
    }
    return seen;
  }

  it("walks entries that start with what was typed and back down to it", () => {
    expect(walk("!git", ["up", "up", "up", "up", "down", "down", "down"])).toEqual([
      "!git status",
      "!git push origin main",
      "!git pull",
      "!git pull",
      "!git push origin main",
      "!git status",
      "!git",
    ]);
  });

  it("walks every entry from a bare `!`", () => {
    expect(walk("!", ["up", "up"])).toEqual(["!git status", "!npm test"]);
  });

  it("leaves keys to the composer when there is nothing to do", () => {
    expect(walk("!zzz", ["up"])).toEqual([null]);
    expect(walk("!git", ["down"])).toEqual([null]);
    expect(walk("hello", ["up"])).toEqual([null]);
  });

  it("starts over from the edited text", () => {
    const first = stepHistory({ navigation: null, history: HISTORY, text: "!", direction: "up" })!;
    const edited = stepHistory({
      navigation: first.navigation,
      history: HISTORY,
      text: "!npm",
      direction: "up",
    });
    expect(edited?.text).toBe("!npm test");
  });
});
