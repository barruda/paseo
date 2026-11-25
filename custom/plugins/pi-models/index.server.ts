import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readModelsFile, writeModelsFile } from "./server/models-file";
import { testModel } from "./server/pi-cli";
import { readRpc, testRpc, writeRpc } from "./shared/rpc";

// The editor on the Pi provider page reads and writes Pi's models.json through these RPCs; the app
// keeps the parsing and editing (packages/app/src/pi-models).
export default function contribute(server: PluginServerContext) {
  server.handle(readRpc, () => readModelsFile());
  server.handle(writeRpc, (input) => writeModelsFile(input));
  server.handle(testRpc, (input) => testModel(input));
  return () => {};
}
