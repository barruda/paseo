import { describe, expect, it } from "vitest";
import { parseEmbedLocation } from "./embed-mode";

describe("parseEmbedLocation", () => {
  it("returns the target for an agent path with embed=1", () => {
    expect(parseEmbedLocation("/h/srv-1/agent/agent-9", "?embed=1")).toEqual({
      serverId: "srv-1",
      agentId: "agent-9",
    });
  });

  it("decodes encoded segments and ignores other query params", () => {
    expect(parseEmbedLocation("/h/srv%3A1/agent/a%20b", "?x=1&embed=1")).toEqual({
      serverId: "srv:1",
      agentId: "a b",
    });
  });

  it("returns null when embed is missing or not 1", () => {
    expect(parseEmbedLocation("/h/srv-1/agent/agent-9", "")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1/agent/agent-9", "?embed=0")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1/agent/agent-9", "?embed=true")).toBeNull();
  });

  it("returns null for other paths", () => {
    expect(parseEmbedLocation("/", "?embed=1")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1", "?embed=1")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1/workspace/ws-1", "?embed=1")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1/sessions/agent-9", "?embed=1")).toBeNull();
  });

  it("returns null for extra segments or malformed encoding", () => {
    expect(parseEmbedLocation("/h/srv-1/agent/agent-9/extra", "?embed=1")).toBeNull();
    expect(parseEmbedLocation("/h/srv-1/agent/%E0%A4%A", "?embed=1")).toBeNull();
  });
});
