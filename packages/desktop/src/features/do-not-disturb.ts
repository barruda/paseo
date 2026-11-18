// CUSTOM(do-not-disturb): the main process owns Do Not Disturb. It gates every system notification
// (notifications.ts), answers the app's get/set commands, and tells every window when the state
// changes, including changes the CLI (`paseo dnd`) writes straight into the file.
import { unwatchFile, watchFile } from "node:fs";
import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { resolvePaseoHome } from "@getpaseo/server/daemon-control";
import {
  DO_NOT_DISTURB_CHANGED_EVENT,
  DO_NOT_DISTURB_OFF,
  effectiveDoNotDisturbState,
  isDoNotDisturbActive,
  parseDoNotDisturbDuration,
  toggleDoNotDisturb,
  turnDoNotDisturbOn,
  type DoNotDisturbState,
} from "@getpaseo/protocol/do-not-disturb";
import {
  doNotDisturbFilePath,
  readDoNotDisturbFile,
  writeDoNotDisturbFile,
} from "@getpaseo/protocol/do-not-disturb-file";
import type { DesktopCommandHandler } from "../settings/desktop-settings-commands.js";

/** How often the main process checks the file for changes made outside the app (the CLI). */
const FILE_POLL_INTERVAL_MS = 2_000;

export interface DoNotDisturbDeps {
  paseoHome: string;
  now: () => Date;
  read: (paseoHome: string) => Promise<DoNotDisturbState>;
  write: (paseoHome: string, state: DoNotDisturbState) => Promise<void>;
  broadcast: (state: DoNotDisturbState) => void;
}

export interface DoNotDisturbController {
  /** The state with expiry applied: an expired end reads as off. */
  get(): Promise<DoNotDisturbState>;
  isActive(): Promise<boolean>;
  /** `{ action: "on", duration? } | { action: "off" } | { action: "toggle" }`. */
  set(args: unknown): Promise<DoNotDisturbState>;
}

export function createDoNotDisturbController(deps: DoNotDisturbDeps): DoNotDisturbController {
  async function get(): Promise<DoNotDisturbState> {
    return effectiveDoNotDisturbState(await deps.read(deps.paseoHome), deps.now().getTime());
  }

  async function nextState(args: unknown): Promise<DoNotDisturbState> {
    const record =
      typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
    const now = deps.now();
    if (record.action === "off") return DO_NOT_DISTURB_OFF;
    if (record.action === "on") {
      return turnDoNotDisturbOn(parseDoNotDisturbDuration(record.duration) ?? "indefinite", now);
    }
    if (record.action === "toggle") return toggleDoNotDisturb(await get(), now);
    throw new Error("set_do_not_disturb needs action: on, off or toggle");
  }

  return {
    get,
    async isActive() {
      return isDoNotDisturbActive(await deps.read(deps.paseoHome), deps.now().getTime());
    },
    async set(args) {
      const next = await nextState(args);
      await deps.write(deps.paseoHome, next);
      deps.broadcast(next);
      return next;
    },
  };
}

function broadcastToWindows(state: DoNotDisturbState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed())
      win.webContents.send(`paseo:event:${DO_NOT_DISTURB_CHANGED_EVENT}`, state);
  }
}

let controller: DoNotDisturbController | null = null;

export function getDoNotDisturbController(): DoNotDisturbController {
  controller ??= createDoNotDisturbController({
    paseoHome: resolvePaseoHome(process.env),
    now: () => new Date(),
    read: readDoNotDisturbFile,
    write: writeDoNotDisturbFile,
    broadcast: broadcastToWindows,
  });
  return controller;
}

/** True while Do Not Disturb is on; a failed read never blocks a notification. */
export async function isDoNotDisturbActiveNow(): Promise<boolean> {
  try {
    return await getDoNotDisturbController().isActive();
  } catch (error) {
    log.warn("[do-not-disturb] failed to read state", error);
    return false;
  }
}

export function createDoNotDisturbCommandHandlers(): Record<string, DesktopCommandHandler> {
  return {
    get_do_not_disturb: () => getDoNotDisturbController().get(),
    set_do_not_disturb: (args) => getDoNotDisturbController().set(args),
  };
}

/** Relays changes written by the CLI to every window. Stat polling survives the atomic rename. */
export function watchDoNotDisturbFile(): () => void {
  const filePath = doNotDisturbFilePath(resolvePaseoHome(process.env));
  const listener = (current: { mtimeMs: number }, previous: { mtimeMs: number }) => {
    if (current.mtimeMs === previous.mtimeMs) return;
    void getDoNotDisturbController()
      .get()
      .then(broadcastToWindows)
      .catch((error) => log.warn("[do-not-disturb] failed to relay a file change", error));
  };
  watchFile(filePath, { interval: FILE_POLL_INTERVAL_MS, persistent: false }, listener);
  return () => unwatchFile(filePath, listener);
}
