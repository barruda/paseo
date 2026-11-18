// CUSTOM(do-not-disturb): Node-only reads and writes of `$PASEO_HOME/do-not-disturb.json`, shared
// by the desktop main process and the CLI. Never import this from the app.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DO_NOT_DISTURB_FILE_NAME,
  DO_NOT_DISTURB_OFF,
  parseDoNotDisturbState,
  type DoNotDisturbState,
} from "./do-not-disturb.js";

export function doNotDisturbFilePath(paseoHome: string): string {
  return path.join(paseoHome, DO_NOT_DISTURB_FILE_NAME);
}

/** A missing or unreadable file reads as off. */
export async function readDoNotDisturbFile(paseoHome: string): Promise<DoNotDisturbState> {
  try {
    return parseDoNotDisturbState(
      JSON.parse(await readFile(doNotDisturbFilePath(paseoHome), "utf8")),
    );
  } catch {
    return DO_NOT_DISTURB_OFF;
  }
}

export async function writeDoNotDisturbFile(
  paseoHome: string,
  state: DoNotDisturbState,
): Promise<void> {
  await mkdir(paseoHome, { recursive: true });
  const filePath = doNotDisturbFilePath(paseoHome);
  const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}
