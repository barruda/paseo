import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// CUSTOM(background-local-image): save a picked image on the daemon host, and read it back.
export const saveImageRpc = defineRpc({
  name: "background.image.save",
  input: z.object({
    mimeType: z.string(),
    // Base64 of at most IMAGE_MAX_BYTES (15 MiB) is just under 21M characters.
    base64: z.string().min(1).max(21_000_000),
    name: z.string().max(255).default(""),
  }),
  output: z.object({ id: z.string() }),
});
export const readImageRpc = defineRpc({
  name: "background.image.read",
  input: z.object({ id: z.string().max(120) }),
  output: z.object({ mimeType: z.string(), base64: z.string() }),
});
