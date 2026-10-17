// Bundled by custom/bin/paseo-speech so a shortcut starts plain node, without tsx or the full CLI.
import { createSpeechCommand } from "../../packages/cli/src/commands/speech/index.js";

await createSpeechCommand().name("paseo-speech").parseAsync();
