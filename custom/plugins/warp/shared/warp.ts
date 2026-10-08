import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Starts the Warp bridge if needed and returns a page URL for a Warp session in `cwd`. */
export const openWarpSessionRpc = defineRpc({
  name: "warp.session.open",
  input: z.object({ cwd: z.string().min(1) }),
  output: z.object({ url: z.string() }),
});
