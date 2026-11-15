import { describe, expect, test } from "vitest";
import { normalizeEmbedAllowedOrigins } from "./embed-allowed-origins.js";

describe("normalizeEmbedAllowedOrigins", () => {
  test("keeps valid origins", () => {
    expect(normalizeEmbedAllowedOrigins(["http://127.0.0.1:5178", "https://example.com"])).toEqual({
      origins: ["http://127.0.0.1:5178", "https://example.com"],
      rejected: [],
    });
  });

  test("rejects paths, trailing slashes, wildcards, keywords and other schemes", () => {
    const bad = [
      "http://127.0.0.1:5178/app",
      "http://127.0.0.1:5178/",
      "*",
      "'self'",
      "ftp://example.com",
      "not a url",
    ];
    expect(normalizeEmbedAllowedOrigins(bad)).toEqual({ origins: [], rejected: bad });
  });
});
