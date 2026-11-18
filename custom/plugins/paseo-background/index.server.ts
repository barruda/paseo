import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/settings";
import { readImageRpc, saveImageRpc } from "./shared/rpc";
import { ImageStore, defaultImageDirectory } from "./server/images";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  // CUSTOM(background-local-image)
  const images = new ImageStore(defaultImageDirectory());
  server.handle(saveImageRpc, (input) => images.save(input));
  server.handle(readImageRpc, (input) => images.read(input));
  return () => {};
}
