import { describe, expect, it } from "vitest";
import {
  fileLinkKind,
  joinFileLinkPath,
  scriptRunCommands,
  splitFileLinkPath,
} from "./hover-actions-model";

describe("chat file link actions", () => {
  it("tells scripts, HTML pages and other files apart", () => {
    expect(fileLinkKind("/x/deploy.SH")).toBe("script");
    expect(fileLinkKind("/x/report.html")).toBe("html");
    expect(fileLinkKind("/x/report.htm")).toBe("html");
    expect(fileLinkKind("/x/notes.md")).toBe("other");
  });

  it("makes relative paths absolute against the workspace", () => {
    expect(joinFileLinkPath("./scripts/run.sh", "/repo/")).toBe("/repo/scripts/run.sh");
    expect(joinFileLinkPath("/tmp/run.sh", "/repo")).toBe("/tmp/run.sh");
    expect(joinFileLinkPath("~/bin/run.sh", "/repo")).toBe("~/bin/run.sh");
  });

  it("runs a script from its own folder, quoting what the shell would split", () => {
    expect(splitFileLinkPath("/repo/scripts/run.sh")).toEqual({
      directory: "/repo/scripts",
      name: "run.sh",
    });
    expect(splitFileLinkPath("/run.sh")).toEqual({ directory: "/", name: "run.sh" });
    expect(scriptRunCommands("/repo/scripts", "run.sh")).toEqual({
      inFolder: "bash ./run.sh",
      here: "cd /repo/scripts && bash ./run.sh",
    });
    expect(scriptRunCommands("/my repo/it's", "a b.sh")).toEqual({
      inFolder: "bash './a b.sh'",
      here: "cd '/my repo/it'\\''s' && bash './a b.sh'",
    });
  });
});
