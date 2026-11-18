# Custom copy

Vendored from https://github.com/MinLeeV5/paseo-background-plugins (MIT), commit 77cf7a0, v0.1.5.
The e2e scripts, `verification/` and the screenshots were dropped. The plugin id stays
`paseo-background`, so saved settings carry over.

Changes (marked `CUSTOM(background-local-image)`): a third source kind `file`, the RPCs
`background.image.save` / `background.image.read` (`server/images.ts`, `shared/rpc.ts`), and a
"Choose local image…" button in the settings screen. See `custom/CHANGES.md`.
