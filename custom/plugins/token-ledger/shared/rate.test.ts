import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTokensPerSecond, tokensPerSecond } from "./rate.ts";

test("rate divides output tokens by turn duration", () => {
  assert.equal(tokensPerSecond(1200, 30_000), 40);
  assert.equal(tokensPerSecond(100, 30_000), 3.3);
  assert.equal(formatTokensPerSecond(1200, 30_000), "40 tok/s");
  assert.equal(formatTokensPerSecond(100, 30_000), "3.3 tok/s");
});

test("missing, non-positive, or non-finite inputs yield no rate", () => {
  assert.equal(tokensPerSecond(null, 30_000), null);
  assert.equal(tokensPerSecond(100, null), null);
  assert.equal(tokensPerSecond(0, 30_000), null);
  assert.equal(tokensPerSecond(100, 0), null);
  assert.equal(tokensPerSecond(-1, 30_000), null);
  assert.equal(tokensPerSecond(100, -1), null);
  assert.equal(tokensPerSecond(Number.NaN, 30_000), null);
  assert.equal(tokensPerSecond(100, Number.POSITIVE_INFINITY), null);
  assert.equal(formatTokensPerSecond(0, 30_000), null);
});
