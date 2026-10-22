// CUSTOM(media-pause): turn playing media down (PipeWire output streams on Linux) while voice mode
// or dictation holds the microphone, and restore the volumes it changed once the last holder lets
// go. Ducking instead of pausing keeps the music going under the conversation.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { IpcMain, WebContents } from "electron";
import log from "electron-log/main";

const execute = promisify(execFile);

export interface PlayingStream {
  id: number;
  /** Paseo's own streams (voice replies) are never ducked. */
  own: boolean;
}

export interface AudioStreams {
  listPlaying(): Promise<PlayingStream[]>;
  /** Volume on the cubic scale that volume sliders show (1 = 100%), or null when muted or gone. */
  getVolume(id: number): Promise<number | null>;
  setVolume(id: number, volume: number): Promise<void>;
}

interface PwObject {
  id: number;
  info?: { state?: string; props?: Record<string, unknown> };
}

async function parentPid(pid: number): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // The command name can hold spaces and parentheses; the parent pid follows its closing one.
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || null;
  } catch {
    return null;
  }
}

async function descendsFrom(pid: number, ancestor: number): Promise<boolean> {
  for (let current: number | null = pid, depth = 0; current && depth < 32; depth += 1) {
    if (current === ancestor) return true;
    current = await parentPid(current);
  }
  return false;
}

/** Paseo's audio comes from its own executable, in a process under this one. */
async function isOwnStream(props: Record<string, unknown>): Promise<boolean> {
  if (props["application.process.binary"] === path.basename(process.execPath)) return true;
  // A Flatpak app reports a pid from its own namespace, which could match one of ours.
  if (props["pipewire.access.portal.app_id"]) return false;
  const pid = Number(props["application.process.id"]);
  return Number.isInteger(pid) && pid > 0 && (await descendsFrom(pid, process.pid));
}

export const wpctlAudioStreams: AudioStreams = {
  async listPlaying() {
    const { stdout } = await execute("pw-dump", [], { timeout: 3000, maxBuffer: 64 * 1024 * 1024 });
    const playing = (JSON.parse(stdout) as PwObject[]).flatMap((object) => {
      const props = object.info?.props;
      const isPlaying =
        props?.["media.class"] === "Stream/Output/Audio" && object.info?.state === "running";
      return isPlaying ? [{ id: object.id, props }] : [];
    });
    return Promise.all(
      playing.map(async ({ id, props }) => ({ id, own: await isOwnStream(props) })),
    );
  },
  async getVolume(id) {
    const { stdout } = await execute("wpctl", ["get-volume", String(id)], { timeout: 3000 });
    if (stdout.includes("[MUTED]")) return null;
    const volume = Number(/Volume:\s*([\d.]+)/.exec(stdout)?.[1]);
    return Number.isFinite(volume) ? volume : null;
  },
  async setVolume(id, volume) {
    await execute("wpctl", ["set-volume", String(id), volume.toFixed(3)], { timeout: 3000 });
  },
};

// A Bluetooth headset leaves its low-quality Handsfree mode a moment after the mic closes; music
// turned back up before that plays loud through Handsfree.
const RESTORE_DELAY_MS = 2500;
/**
 * Ducked streams play at this fraction of their amplitude (-20 dB). wpctl volumes are cubic, like
 * volume sliders, so the slider moves by its cube root: 0.1 on the slider is -60 dB, which sounds
 * the same as a pause.
 */
const DUCK_GAIN = 0.1;
const DUCK_FACTOR = Math.cbrt(DUCK_GAIN);
const VOLUME_TOLERANCE = 0.01;

interface Ducked {
  original: number;
  ducked: number;
}

/** Holders are windows; media ducks when the first one is active and restores after the last. */
export function createMediaDucker(streams: AudioStreams, restoreDelayMs = RESTORE_DELAY_MS) {
  const holders = new Set<number>();
  // Streams still waiting from a restore that a new holder cancelled stay ducked here.
  const ducked = new Map<number, Ducked>();
  let queue = Promise.resolve();

  async function duckAll() {
    const playing = await streams.listPlaying();
    await Promise.allSettled(
      playing.map(async ({ id, own }) => {
        if (own || ducked.has(id)) return;
        const original = await streams.getVolume(id);
        if (!original) return;
        const volume = original * DUCK_FACTOR;
        await streams.setVolume(id, volume);
        ducked.set(id, { original, ducked: volume });
      }),
    );
  }

  async function restoreAll() {
    await new Promise((resolve) => setTimeout(resolve, restoreDelayMs));
    if (holders.size > 0) return;
    const entries = [...ducked];
    ducked.clear();
    // A stream whose volume the user changed meanwhile keeps it.
    await Promise.allSettled(
      entries.map(async ([id, volume]) => {
        const current = await streams.getVolume(id);
        if (current !== null && Math.abs(current - volume.ducked) <= VOLUME_TOLERANCE) {
          await streams.setVolume(id, volume.original);
        }
      }),
    );
  }

  return {
    setActive(holder: number, active: boolean): Promise<void> {
      const wasActive = holders.size > 0;
      if (active) holders.add(holder);
      else holders.delete(holder);
      const isActive = holders.size > 0;
      if (wasActive !== isActive) {
        queue = queue
          .then(isActive ? duckAll : restoreAll)
          .catch((error) => log.warn("[media-pause] failed to duck media streams", error));
      }
      return queue;
    },
  };
}

export function registerMediaPauseHandlers(
  ipcMain: IpcMain,
  streams: AudioStreams = wpctlAudioStreams,
) {
  const ducker = createMediaDucker(streams);
  const watched = new Set<number>();
  const watch = (sender: WebContents) => {
    if (watched.has(sender.id)) return;
    watched.add(sender.id);
    const id = sender.id;
    const release = () => void ducker.setActive(id, false);
    // A reload or closed window must not keep media ducked.
    sender.on("did-navigate", release);
    sender.once("destroyed", () => {
      watched.delete(id);
      release();
    });
  };
  ipcMain.handle("paseo:media:setCaptureActive", (event, active: unknown) => {
    if (process.platform !== "linux") return;
    watch(event.sender);
    return ducker.setActive(event.sender.id, active === true);
  });
}
