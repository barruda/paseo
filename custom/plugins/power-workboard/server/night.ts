import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";

/** CUSTOM(night-tasks): how long the power-off warning counts down before it runs. */
export const SHUTDOWN_WARNING_MS = 5 * 60_000;

/** CUSTOM(night-tasks): what the night power-off needs from the computer. */
export interface NightSystem {
  /** Shows a desktop notification; failures are ignored. */
  notify(title: string, body: string): Promise<void>;
  /** Runs the power-off command (the platform default when empty). */
  powerOff(command: string): Promise<void>;
}

export function defaultShutdownCommand(os = platform()): string {
  if (os === "darwin")
    return `osascript -e 'tell app "System Events" to shut down'`;
  if (os === "win32") return "shutdown /s /t 0";
  return "systemctl poweroff";
}

export const defaultNightSystem: NightSystem = {
  notify: (title, body) =>
    new Promise((resolve) => {
      if (platform() !== "linux") return resolve();
      execFile(
        "notify-send",
        ["--urgency=critical", "--app-name=Paseo", title, body],
        () => resolve(),
      );
    }),
  powerOff: (command) =>
    new Promise((resolve, reject) => {
      const child = spawn(command || defaultShutdownCommand(), {
        shell: true,
        stdio: "ignore",
        detached: true,
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 || code === null
          ? resolve()
          : reject(new Error(`Power-off command exited with ${code}`)),
      );
    }),
};
