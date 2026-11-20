import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { redeployPaseo } from "../server/redeploy";

const dir = mkdtempSync(path.join(os.tmpdir(), "redeploy-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fake(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("redeployPaseo", () => {
  it("returns the output of a script that exits 0", async () => {
    const script = fake("ok.sh", 'echo "Restarting the Paseo daemons"');
    expect(await redeployPaseo({ scripts: [script] })).toEqual({
      ok: true,
      output: "Restarting the Paseo daemons",
    });
  });

  it("is not ok when the script exits 1, keeping its output", async () => {
    const script = fake("fail.sh", "echo boom >&2; exit 1");
    expect(await redeployPaseo({ scripts: [script] })).toEqual({
      ok: false,
      output: "boom",
    });
  });

  it("does not pass PASEO_AGENT_ID to the script", async () => {
    const script = fake("env.sh", 'echo "id=${PASEO_AGENT_ID:-none}"');
    process.env.PASEO_AGENT_ID = "agent-1";
    try {
      expect((await redeployPaseo({ scripts: [script] })).output).toBe("id=none");
    } finally {
      delete process.env.PASEO_AGENT_ID;
    }
  });

  it("falls back to the next candidate and reports a missing script", async () => {
    const script = fake("later.sh", "echo fallback");
    const missing = path.join(dir, "missing.sh");
    expect((await redeployPaseo({ scripts: [missing, script] })).output).toBe("fallback");
    const result = await redeployPaseo({ scripts: [missing] });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not found or not executable");
    expect(result.output).toContain(missing);
  });
});
