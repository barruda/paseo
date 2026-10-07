# Customization history

One entry per customization, newest last. Each entry matches one `custom:` commit on the `custom`
branch. When an update conflicts, find the failing commit here. **Core files touched** lists what
can conflict with upstream. **Re-apply** says how to redo the change if the surrounding code moved.

Find every patched spot in core code with `rg "CUSTOM\("`.

---

## desktop-name: per-launcher dock identity on Linux

- **Added:** 2026-10-07 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: PASEO_DESKTOP_NAME for side-by-side Linux desktop installs`
- **Why:** Separate launchers (`paseo-personal.desktop`, `paseo-telus.desktop`) run separate
  daemons with their own `PASEO_HOME`. Without this, all windows group under one dock icon. On
  Wayland, the desktop name is the window's `app_id`.
- **What:** `PASEO_DESKTOP_NAME=<name>` sets `app.setDesktopName("<name>.desktop")` and the
  `--class` switch. Unset, it keeps upstream's `Paseo`.
- **Core files touched:** `packages/desktop/src/main.ts`, the Linux block that calls
  `app.setDesktopName`.
- **Re-apply:** Find `app.setDesktopName("Paseo.desktop")` and replace the hardcoded `Paseo` (in
  both the desktop name and the `class` switch) with the env-derived name.
- **Verify:** Launch from `~/.local/share/applications/paseo-telus.desktop` and check that the
  window gets its own dock entry.

## shell-command: run `!<command>` from the chat

- **Added:** 2026-10-07 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: run shell commands from the chat with !<command>`
- **Why:** To run a quick command (`git status`, `npm test`) from the phone or desktop chat without
  opening a terminal tab and without sending it to the agent.
- **What:** Type `!git status` (or `/sh git status`) in an agent's composer. The daemon runs it with
  `$SHELL -lc` in the agent's directory. The output streams into a chat card tagged **Terminal**,
  expanded by default, with exit code, duration, Copy, Stop, and Run again. The agent never receives
  the command or its output: it's a plugin timeline row, not a message.
  - Input: while the command runs, the card has an input line. Enter sends the line (an empty line
    sends Enter), and **^C** / **^D** send Ctrl-C and end of input. The output follows the tail.
  - On Linux the command runs in a pseudo-terminal through util-linux `script` (160x40), so
    prompts (`read`, `sudo`, y/n questions) work and typed input is echoed. Without `script`, it
    falls back to plain pipes: ^C sends SIGINT and ^D closes stdin.
  - Colors are off and pagers are `cat`. Full-screen programs (vim, htop) don't render; use a
    Terminal tab.
  - The card keeps the last 48 KiB of output (the plugin row limit is 64 KiB).
  - Commands are killed after 30 minutes, and when the plugin stops.
  - Cards live in daemon memory. A daemon restart drops them from the chat history.
- **Files:**
  - `custom/plugins/shell-command/`: the plugin (slash command `sh`, RPCs `run` and `stop`, timeline
    renderer). No conflict risk.
  - `packages/server/src/server/plugins/custom-shell-command-plugin.e2e.test.ts`: e2e test against a
    real daemon. New file; breaks only if upstream changes the test utilities.
- **Core files touched:** `packages/app/src/plugins/client-slash-commands/model.ts`, the `!` →
  `sh` routing in `resolvePluginClientSlashCommand`, plus a test in `model.test.ts`.
- **Re-apply:** Wherever the composer resolves a plugin slash command from the submitted text,
  treat text starting with `!` as the plugin command named `sh`, with the rest as `args`.
- **Where `!` works:** Only in apps built from this checkout (the desktop app). The official mobile
  app and app.paseo.sh don't have the `!` routing. They load plugin client code from the daemon, so
  `/sh <command>` and the cards should work there (not yet verified on mobile).
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
- **Verify:** `npx vitest run custom/plugins/shell-command packages/app/src/plugins/client-slash-commands/model.test.ts`
  and `(cd packages/server && npx vitest run src/server/plugins/custom-shell-command-plugin.e2e.test.ts)`.
  The update script runs both.
