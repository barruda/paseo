import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDoNotDisturbFile } from "@getpaseo/protocol/do-not-disturb-file";
import { createCli } from "../cli.js";
import { runDnd } from "./dnd.js";

// CUSTOM(do-not-disturb)
describe("paseo dnd", () => {
  const now = new Date(2026, 10, 18, 14, 30, 0);
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "paseo-dnd-cli-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("is off when nothing was written", async () => {
    expect(await runDnd(home, "status", {}, now)).toMatchObject({
      doNotDisturb: "off",
      until: null,
    });
  });

  it("turns on until turned off, then off", async () => {
    expect(await runDnd(home, "on", {}, now)).toMatchObject({ doNotDisturb: "on", until: null });
    expect(await readDoNotDisturbFile(home)).toEqual({ enabled: true, until: null });
    expect(await runDnd(home, "off", {}, now)).toMatchObject({ doNotDisturb: "off" });
    expect(await readDoNotDisturbFile(home)).toEqual({ enabled: false, until: null });
  });

  it("turns on for an hour and reads as off once it ends", async () => {
    const result = await runDnd(home, "on", { for: "1h" }, now);
    expect(result.until).toBe(new Date(now.getTime() + 3_600_000).toISOString());
    const later = new Date(now.getTime() + 3_600_000);
    expect(await runDnd(home, "status", {}, later)).toMatchObject({ doNotDisturb: "off" });
  });

  it("toggles", async () => {
    expect((await runDnd(home, "toggle", {}, now)).doNotDisturb).toBe("on");
    expect((await runDnd(home, "toggle", {}, now)).doNotDisturb).toBe("off");
  });

  it("rejects an unknown duration", async () => {
    await expect(runDnd(home, "on", { for: "2h" }, now)).rejects.toMatchObject({
      code: "INVALID_DURATION",
    });
  });

  it("is listed in the CLI with its subcommands", () => {
    const dnd = createCli().commands.find((command) => command.name() === "dnd");
    expect(dnd?.commands.map((command) => command.name())).toEqual([
      "status",
      "on",
      "off",
      "toggle",
    ]);
  });
});
