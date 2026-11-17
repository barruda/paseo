import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(
        new URL("./tests/react-native.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/*.test.ts"],
    // CUSTOM(agent-profiles): a started agent reads or creates its profile folder under PASEO_HOME.
    env: { PASEO_HOME: mkdtempSync(path.join(os.tmpdir(), "pwb-home-")) },
  },
});
