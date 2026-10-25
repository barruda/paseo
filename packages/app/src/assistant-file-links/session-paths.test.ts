import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem } from "@/types/stream";
import { collectSessionFilePaths, matchSessionFilePath } from "./session-paths";
import { classifyForResolution } from "./resolver";

function toolCall(id: string, detail: ToolCallDetail): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: detail.type,
        status: "completed",
        error: null,
        detail,
      },
    },
  } as StreamItem;
}

describe("session file paths", () => {
  const items = [
    toolCall("1", { type: "read", filePath: "/repo/scripts/deploy.sh" }),
    toolCall("2", { type: "write", filePath: "tools/deploy.sh" }),
    toolCall("3", { type: "search", query: "x", filePaths: ["/tmp/out/report.html"] }),
    toolCall("4", { type: "edit", filePath: "/repo/scripts/deploy.sh" }),
  ];

  it("lists the files tool calls touched, newest first and without repeats", () => {
    expect(collectSessionFilePaths(items, "/home/me/work")).toEqual([
      "/repo/scripts/deploy.sh",
      "/tmp/out/report.html",
      "/home/me/work/tools/deploy.sh",
    ]);
  });

  it("matches a basename or a relative path to the newest file it names", () => {
    const paths = collectSessionFilePaths(items, "/home/me/work");
    expect(matchSessionFilePath("deploy.sh", paths)).toBe("/repo/scripts/deploy.sh");
    expect(matchSessionFilePath("./tools/deploy.sh", paths)).toBe("/home/me/work/tools/deploy.sh");
    expect(matchSessionFilePath("ploy.sh", paths)).toBeNull();
    expect(matchSessionFilePath("/elsewhere/deploy.sh", paths)).toBeNull();
  });

  it("resolves an inline code basename to the session's file, outside the workspace too", () => {
    const resolution = classifyForResolution(
      { href: "report.html:3", text: "report.html:3", sourceType: "inline-code" },
      { workspaceRoot: "/repo", sessionPaths: ["/tmp/out/report.html"] },
    );
    expect(resolution).toEqual({
      kind: "resolved",
      value: {
        kind: "file",
        target: expect.objectContaining({ path: "/tmp/out/report.html", lineStart: 3 }),
      },
    });
  });
});
