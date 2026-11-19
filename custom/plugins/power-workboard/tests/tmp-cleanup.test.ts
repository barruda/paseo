import { expect, it } from "vitest";
import {
  lutimes,
  mkdir,
  mkdtemp,
  readdir,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupScratchDirectory, tmpCleanupDue } from "../server/tmp-cleanup";

const HOUR = 60 * 60_000;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

async function touch(path: string, at: number) {
  const seconds = at / 1000;
  await utimes(path, seconds, seconds);
}

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "pwb-tmp-cleanup-"));
  const target = join(root, "tmp");
  await mkdir(target);
  return { root, target };
}

it("removes only entries older than the limit and keeps the folder itself", async () => {
  const { target } = await scratch();
  const oldFile = join(target, "old.log");
  const freshFile = join(target, "fresh.log");
  const freshDir = join(target, "fresh-dir");
  await writeFile(oldFile, "old");
  await writeFile(freshFile, "fresh");
  await mkdir(freshDir);
  await writeFile(join(freshDir, "child"), "fresh");
  await touch(oldFile, NOW - 30 * HOUR);
  await touch(freshFile, NOW - 1 * HOUR);
  await touch(freshDir, NOW - 30 * HOUR);
  await touch(join(freshDir, "child"), NOW - 1 * HOUR);

  const result = await cleanupScratchDirectory({
    path: target,
    maxAgeMs: 24 * HOUR,
    now: NOW,
  });

  expect(result.errors).toEqual([]);
  expect(result.removed).toEqual([oldFile]);
  expect((await readdir(target)).sort()).toEqual(["fresh-dir", "fresh.log"]);
});

it("removes a directory only when its newest content is old", async () => {
  const { target } = await scratch();
  const oldDir = join(target, "old-dir");
  await mkdir(oldDir);
  await writeFile(join(oldDir, "child"), "old");
  await touch(oldDir, NOW - 48 * HOUR);
  await touch(join(oldDir, "child"), NOW - 48 * HOUR);

  const result = await cleanupScratchDirectory({
    path: target,
    maxAgeMs: 24 * HOUR,
    now: NOW,
  });

  expect(result.removed).toEqual([oldDir]);
  expect(await readdir(target)).toEqual([]);
});

it("unlinks a symlink instead of following it into the target", async () => {
  const { root, target } = await scratch();
  const realTarget = join(root, "real");
  await mkdir(realTarget);
  await writeFile(join(realTarget, "keep"), "keep");
  const link = join(target, "link");
  await symlink(realTarget, link);
  const linkSeconds = (NOW - 48 * HOUR) / 1000;
  await lutimes(link, linkSeconds, linkSeconds);

  const result = await cleanupScratchDirectory({
    path: target,
    maxAgeMs: 24 * HOUR,
    now: NOW,
  });

  expect(result.removed).toEqual([link]);
  expect(await readdir(realTarget)).toEqual(["keep"]);
});

it("does nothing when the folder does not exist", async () => {
  const result = await cleanupScratchDirectory({
    path: join(tmpdir(), "pwb-tmp-cleanup-missing"),
    maxAgeMs: 24 * HOUR,
    now: NOW,
  });
  expect(result).toEqual({ removed: [], errors: [] });
});

it("runs at most once an hour", () => {
  expect(tmpCleanupDue(null, NOW, HOUR)).toBe(true);
  expect(tmpCleanupDue(NOW, NOW + HOUR - 1, HOUR)).toBe(false);
  expect(tmpCleanupDue(NOW, NOW + HOUR, HOUR)).toBe(true);
});
