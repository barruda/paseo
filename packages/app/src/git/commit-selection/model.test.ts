import { describe, expect, it } from "vitest";
import {
  changesDifferFromList,
  folderCheckState,
  pruneSelection,
  selectionPathspecs,
  toggleFileSelection,
  toggleFolderSelection,
} from "./model";

const files = ["src/components/a.tsx", "src/components/b.tsx", "src/index.ts", "README.md"];

describe("commit selection", () => {
  it("derives a folder's check state from the files under it", () => {
    expect(folderCheckState("src/components", files, new Set())).toBe("unchecked");
    expect(folderCheckState("src/components", files, new Set(["src/components/a.tsx"]))).toBe(
      "mixed",
    );
    expect(
      folderCheckState(
        "src/components",
        files,
        new Set(["src/components/a.tsx", "src/components/b.tsx"]),
      ),
    ).toBe("checked");
  });

  it("does not count a sibling folder sharing the name prefix", () => {
    const paths = ["src/comp/x.ts", "src/components/a.tsx"];
    expect(folderCheckState("src/comp", paths, new Set(["src/components/a.tsx"]))).toBe(
      "unchecked",
    );
  });

  it("checks every file under an unchecked or mixed folder", () => {
    expect(toggleFolderSelection("src/components", files, [])).toEqual([
      "src/components/a.tsx",
      "src/components/b.tsx",
    ]);
    expect(toggleFolderSelection("src", files, ["src/index.ts", "README.md"])).toEqual([
      "src/index.ts",
      "README.md",
      "src/components/a.tsx",
      "src/components/b.tsx",
    ]);
  });

  it("clears a fully checked folder and keeps other selections", () => {
    expect(
      toggleFolderSelection("src/components", files, [
        "README.md",
        "src/components/a.tsx",
        "src/components/b.tsx",
      ]),
    ).toEqual(["README.md"]);
  });

  it("toggles single files", () => {
    expect(toggleFileSelection("README.md", [])).toEqual(["README.md"]);
    expect(toggleFileSelection("README.md", ["README.md", "src/index.ts"])).toEqual([
      "src/index.ts",
    ]);
  });

  it("drops files that are no longer changed, keeping identity when nothing changes", () => {
    const selected = ["README.md"];
    expect(pruneSelection(selected, files)).toBe(selected);
    expect(pruneSelection(["README.md", "gone.ts"], files)).toEqual(["README.md"]);
  });

  it("adds a rename's old path to the pathspecs", () => {
    expect(
      selectionPathspecs(
        [{ path: "new.ts", oldPath: "old.ts" }, { path: "README.md" }, { path: "x.ts" }],
        ["new.ts", "README.md"],
      ),
    ).toEqual(["new.ts", "old.ts", "README.md"]);
  });
});

describe("changesDifferFromList", () => {
  const listed = [
    { path: "a.ts", additions: 1, deletions: 0 },
    { path: "b.ts", additions: 2, deletions: 2 },
  ];

  it("matches the list regardless of order", () => {
    expect(changesDifferFromList(listed, [listed[1], listed[0]])).toBe(false);
  });

  it("flags a new, removed, or changed file", () => {
    expect(changesDifferFromList(listed, [listed[0]])).toBe(true);
    expect(changesDifferFromList(listed, [listed[0], { ...listed[1], path: "c.ts" }])).toBe(true);
    expect(changesDifferFromList(listed, [listed[0], { ...listed[1], additions: 3 }])).toBe(true);
  });
});
