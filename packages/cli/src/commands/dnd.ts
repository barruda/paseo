// CUSTOM(do-not-disturb): `paseo dnd on|off|toggle|status` flips the desktop app's Do Not Disturb
// from a script (OpenDeck, a hotkey). It writes `$PASEO_HOME/do-not-disturb.json` directly: the
// desktop main process polls that file, gates its notifications on it and updates its windows.
// Local only; the daemon is not involved.
import { Command } from "commander";
import {
  DO_NOT_DISTURB_DURATIONS,
  effectiveDoNotDisturbState,
  parseDoNotDisturbDuration,
  toggleDoNotDisturb,
  turnDoNotDisturbOn,
  DO_NOT_DISTURB_OFF,
  type DoNotDisturbState,
} from "@getpaseo/protocol/do-not-disturb";
import {
  doNotDisturbFilePath,
  readDoNotDisturbFile,
  writeDoNotDisturbFile,
} from "@getpaseo/protocol/do-not-disturb-file";
import { withOutput } from "../output/index.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../output/index.js";
import { addJsonOption, addLocalDaemonOptions } from "../utils/command-options.js";

export interface DndResult {
  doNotDisturb: "on" | "off";
  until: string | null;
  file: string;
}

const dndResultSchema: OutputSchema<DndResult> = {
  idField: "doNotDisturb",
  columns: [
    { header: "DO NOT DISTURB", field: "doNotDisturb" },
    { header: "UNTIL", field: (item) => item.until ?? "-" },
  ],
  renderHuman: (result) => {
    const data = result.data as DndResult;
    if (data.doNotDisturb === "off") return "Do Not Disturb is off";
    return data.until
      ? `Do Not Disturb is on until ${new Date(data.until).toLocaleString()}`
      : "Do Not Disturb is on until you turn it off";
  },
};

export type DndAction = "status" | "on" | "off" | "toggle";

export async function runDnd(
  paseoHome: string,
  action: DndAction,
  options: { for?: string } = {},
  now: Date = new Date(),
): Promise<DndResult> {
  const current = effectiveDoNotDisturbState(await readDoNotDisturbFile(paseoHome), now.getTime());
  let next: DoNotDisturbState = current;
  if (action === "on") {
    const duration =
      options.for === undefined ? "indefinite" : parseDoNotDisturbDuration(options.for);
    if (!duration) {
      throw {
        code: "INVALID_DURATION",
        message: `--for must be one of: ${DO_NOT_DISTURB_DURATIONS.join(", ")}`,
      };
    }
    next = turnDoNotDisturbOn(duration, now);
  } else if (action === "off") {
    next = DO_NOT_DISTURB_OFF;
  } else if (action === "toggle") {
    next = toggleDoNotDisturb(current, now);
  }
  if (action !== "status") await writeDoNotDisturbFile(paseoHome, next);
  return {
    doNotDisturb: next.enabled ? "on" : "off",
    until: next.until,
    file: doNotDisturbFilePath(paseoHome),
  };
}

function dndAction(action: DndAction) {
  return withOutput(
    async (options: CommandOptions, _command: Command): Promise<SingleResult<DndResult>> => {
      if (options.daemonTarget.kind !== "instance") {
        throw { code: "LOCAL_OPERATION", message: "paseo dnd is a local operation; use --home." };
      }
      const data = await runDnd(options.daemonTarget.home, action, {
        for: typeof options.for === "string" ? options.for : undefined,
      });
      return { type: "single", data, schema: dndResultSchema };
    },
  );
}

export function createDndCommand(): Command {
  const dnd = new Command("dnd").description(
    "Do Not Disturb for the desktop app's notifications and toasts (local operation)",
  );
  const subcommand = (name: DndAction, description: string) =>
    addJsonOption(addLocalDaemonOptions(dnd.command(name).description(description)));

  subcommand("status", "Show whether Do Not Disturb is on").action(dndAction("status"));
  subcommand("on", "Turn Do Not Disturb on")
    .option(
      "--for <duration>",
      `How long: ${DO_NOT_DISTURB_DURATIONS.join(", ")} (default: indefinite)`,
    )
    .action(dndAction("on"));
  subcommand("off", "Turn Do Not Disturb off").action(dndAction("off"));
  subcommand("toggle", "Turn Do Not Disturb on (until turned off) or off").action(
    dndAction("toggle"),
  );
  return dnd;
}
