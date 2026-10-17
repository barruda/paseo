import { Command } from "commander";
import { createDictateCommand } from "./dictate.js";
import { createWakeCommand } from "./wake.js";

export function createSpeechCommand(): Command {
  // CUSTOM(cli-dictation): paseo speech dictate / wake
  return new Command("speech")
    .description("Speech commands")
    .addCommand(createDictateCommand())
    .addCommand(createWakeCommand());
}
