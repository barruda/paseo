// Temporary test helper (Projects Assistant E2E on the isolated dev daemon). Deleted after use.
import { connectToDaemon } from "./src/utils/client.js";
const [method, input] = [process.argv[2], JSON.parse(process.argv[3] ?? "{}")];
const client = await connectToDaemon({ target: { kind: "endpoint", host: "127.0.0.1:6790" } as never });
const out = await client.invokePluginRpc("power-workboard", method, input);
console.log(JSON.stringify(out, null, 1));
await (client as unknown as { close?: () => Promise<void> }).close?.();
process.exit(0);
