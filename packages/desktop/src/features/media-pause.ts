// CUSTOM(media-pause): pause playing media (MPRIS players on Linux) while voice mode or dictation
// holds the microphone, and resume the players it paused once the last holder lets go.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IpcMain, WebContents } from "electron";
import log from "electron-log/main";

const execute = promisify(execFile);
const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";

export interface MprisBus {
  listPlayers(): Promise<string[]>;
  playbackStatus(player: string): Promise<string | null>;
  call(player: string, method: "Pause" | "Play"): Promise<void>;
}

async function gdbusCall(args: string[]): Promise<string> {
  const { stdout } = await execute("gdbus", ["call", "--session", "--timeout", "2", ...args], {
    timeout: 3000,
  });
  return stdout;
}

const playerArgs = (player: string) => [
  "--dest",
  player,
  "--object-path",
  "/org/mpris/MediaPlayer2",
];

export const gdbusMprisBus: MprisBus = {
  async listPlayers() {
    const out = await gdbusCall([
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.ListNames",
    ]);
    return [...out.matchAll(/'([^']+)'/g)]
      .map((match) => match[1]!)
      .filter((name) => name.startsWith(MPRIS_PREFIX));
  },
  async playbackStatus(player) {
    const out = await gdbusCall([
      ...playerArgs(player),
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      `${MPRIS_PREFIX}Player`,
      "PlaybackStatus",
    ]);
    return /'(\w+)'/.exec(out)?.[1] ?? null;
  },
  async call(player, method) {
    await gdbusCall([...playerArgs(player), "--method", `${MPRIS_PREFIX}Player.${method}`]);
  },
};

// A Bluetooth headset leaves its low-quality Handsfree mode a moment after the mic closes; music
// resumed before that plays through Handsfree.
const RESUME_DELAY_MS = 2500;

/** Holders are windows; media pauses when the first one is active and resumes after the last. */
export function createMediaPauser(bus: MprisBus, resumeDelayMs = RESUME_DELAY_MS) {
  const holders = new Set<number>();
  let paused: string[] = [];
  let queue = Promise.resolve();

  async function pauseAll() {
    const players = await bus.listPlayers();
    const results = await Promise.allSettled(
      players.map(async (player) => {
        if ((await bus.playbackStatus(player)) !== "Playing") return null;
        await bus.call(player, "Pause");
        return player;
      }),
    );
    // Players still waiting from a resume that a new holder cancelled stay on the list.
    const newlyPaused = results.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    paused = [...new Set([...paused, ...newlyPaused])];
  }

  async function resumeAll() {
    await new Promise((resolve) => setTimeout(resolve, resumeDelayMs));
    if (holders.size > 0) return;
    const players = paused;
    paused = [];
    // A player the user stopped or restarted meanwhile is left alone.
    await Promise.allSettled(
      players.map(async (player) => {
        if ((await bus.playbackStatus(player)) === "Paused") await bus.call(player, "Play");
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
          .then(isActive ? pauseAll : resumeAll)
          .catch((error) => log.warn("[media-pause] failed to toggle media players", error));
      }
      return queue;
    },
  };
}

export function registerMediaPauseHandlers(ipcMain: IpcMain, bus: MprisBus = gdbusMprisBus) {
  const pauser = createMediaPauser(bus);
  const watched = new Set<number>();
  const watch = (sender: WebContents) => {
    if (watched.has(sender.id)) return;
    watched.add(sender.id);
    const id = sender.id;
    const release = () => void pauser.setActive(id, false);
    // A reload or closed window must not keep media paused.
    sender.on("did-navigate", release);
    sender.once("destroyed", () => {
      watched.delete(id);
      release();
    });
  };
  ipcMain.handle("paseo:media:setCaptureActive", (event, active: unknown) => {
    if (process.platform !== "linux") return;
    watch(event.sender);
    return pauser.setActive(event.sender.id, active === true);
  });
}
