# Warp embedded in Paseo (custom)

This checkout's `custom` branch runs Warp's terminal inside a Paseo tab. Warp is a native GPU app
and can't be embedded, but its open-source client also compiles to WebAssembly, and its
`remote_tty` build feature drives a shell over a plain WebSocket. Paseo opens that web build in an
Electron browser tab, backed by a small PTY bridge.

This doc covers how the pieces fit, how to build and run them, and the gotchas. The per-commit
details (core files touched, how to re-apply after an upstream update, how to verify) are in
`custom/CHANGES.md`, in the entries `warp`, `browser-no-toolbar`, `browser-shortcut-preempt`,
`bottom-panel-tab-keys`, `bottom-panel-warp` and `desk-bottom-panel-warp`.

## Pieces

| Piece                | Where                                                                                  | What it does                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Warp plugin (client) | `custom/plugins/warp/index.client.tsx`, `client/warp-panel.tsx`                        | "+ → Warp" panel and the "Open Warp" Command Center item. Calls the RPC and opens the browser tab.                             |
| Warp plugin (server) | `custom/plugins/warp/index.server.ts`, `server/bridge.ts`                              | Starts the bridge when the plugin loads, handles `warp.session.open` (returns the page URL), stops the bridge with the plugin. |
| Warp checkout        | `~/projetos/warp-web-custom`, branch `paseo` (override with `PASEO_WARP_WEB_DIR`)      | Upstream Warp plus `PASEO:` commits. Its web build is what the tab runs.                                                       |
| Bridge               | `~/projetos/warp-web-custom/paseo-bridge/server.mjs`                                   | Serves the wasm bundle and the `/create` PTY WebSocket (node-pty).                                                             |
| Browser tab options  | `packages/app/src/desktop/browser/`, `packages/desktop/src/features/browser-keyboard/` | `toolbar: false`, `icon`, `replacePanel` on `openBrowser`, and the keyboard routing below.                                     |

The Warp-side patches are the `PASEO:` commits on the `paseo` branch (`git log master..paseo` in
the Warp checkout):

- `app/src/terminal/remote_tty/event_loop.rs`: reads the PTY URL from `window.PASEO_WARP_PTY_URL`
  instead of the hard-coded `ws://127.0.0.1:3030/create`, and the shell from
  `window.PASEO_WARP_SHELL` (bash or zsh; `remote_tty/terminal_manager.rs` uses the same value).
- `app/src/root_view.rs`: `remote_tty` builds start loginless, like desktop's "Skip for now".
- `app/src/wasm_nux_dialog.rs`: hides the "Download Warp Desktop?" dialog in `remote_tty` builds.
- `paseo-bridge/`: the bridge itself, with the page title set to plain "Warp".

## How a session starts

1. "+ → Warp" mounts the plugin panel, which calls `warp.session.open` with the workspace folder.
   A newly created bottom panel (Ctrl+J) mounts the same panel in its first tab, so Warp is the
   bottom panel's default. It falls back to a terminal outside Electron or when the host lacks the
   plugin. In Tasks mode, showing the hidden bottom panel also mounts it for the focused task's
   workspace when that workspace has no Warp tab in the panel yet (otherwise its Warp tab is
   selected), since one panel serves every task there.
2. The plugin server has already started the bridge with system `node` when the plugin loaded
   (it starts it again if it died), waits for `WARP_BRIDGE_READY <port>` on stdout, and returns
   `http://127.0.0.1:<port>/?token=…&cwd=…`.
3. The panel calls `openBrowser({ toolbar: false, icon: "SquareTerminal", replacePanel: true })`,
   so its own tab becomes the Warp tab.
4. The bridge's index page copies `token` and `cwd` into `window.PASEO_WARP_PTY_URL` and sets
   `window.PASEO_WARP_SHELL`, then loads Warp's wasm.
5. Warp opens `ws://…/create?token=…&cwd=…&num_rows=…&num_cols=…`, plus
   `shell=bash&session_id=…&honor_ps1=…` for bash. The bridge checks the token and spawns the
   shell in that folder (see "The shell"). Its init script sends Warp the InitShell hook, and Warp
   types the full bootstrap into the PTY.

Why it's shaped this way:

- **System `node`, not the plugin process.** The plugin runs on Electron's Node, which can't load
  the bridge's node-pty. Override the binary with `PASEO_WARP_NODE`.
- **Port and token are persisted** in `$PASEO_HOME/plugin-data/warp/bridge.json`, so Warp tabs
  restored after a daemon restart still connect. If the saved port is taken, the bridge picks a
  free one, and restored tabs show a blank page until reopened.
- **The bridge starts with the plugin, not on first open.** A restored Warp tab loads the saved
  URL directly and never calls `warp.session.open`. Starting on first open left every Warp tab
  blank after a reboot until someone opened a new one.
- **The PTY URL goes through a window global** because Warp rewrites the page URL after it loads,
  so Rust can't read it from `location`.
- **Electron only.** Browser tabs exist only in the desktop app. In a web browser or on the phone
  the panel shows a link to the bridge page, which works only on the machine running Paseo.

## The shell

Warp tabs run bash by default. The bridge starts each shell the way desktop Warp does
(`crates/warp_terminal/src/local_tty/shell.rs`):

| Shell          | Launch                              | Init script                                                  | rc files the bootstrap sources                         |
| -------------- | ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| bash (default) | `exec -a bash bash --rcfile <init>` | the bridge writes Warp's `bash_init_shell.sh` to a temp file | `/etc/profile`, then `~/.bash_profile` (→ `~/.bashrc`) |
| zsh            | `exec -a -zsh zsh -g --no-rcs`      | Warp types `zsh_init_shell.sh` into the PTY                  | `~/.zshenv`, `~/.zprofile`, `~/.zshrc`                 |

- **Why bash needs a session id in the URL.** Warp only accepts an InitShell hook carrying a
  session id it registered. Zsh gets its init script typed by Warp, so Warp fills the id in itself;
  bash reads its init script as an rcfile before Warp types anything, so Warp sends the id to the
  bridge and the bridge fills in the script (it reads it from the Warp checkout's
  `app/assets/bundled/bootstrap/`). A wasm build from before bash support sends no id and always
  gets zsh, whatever the bridge's default.
- **Picking the shell:** `WARP_SHELL_TYPE=zsh` in the plugin's environment switches the default;
  `?shell=zsh` on a page URL switches one tab. Override the binaries with `WARP_BASH` and
  `WARP_ZSH`.
- **History:** bash starts with desktop Warp's history sentinels (`HISTSIZE`, `HISTFILESIZE`), so
  it loads all of `~/.bash_history`. In zsh tabs, history needs `HISTFILE` and `SAVEHIST` in
  `~/.zshrc`, or Ctrl+R starts empty in every tab.
- **Telling them apart:** `echo $0` prints `bash` or `-zsh`. An error that starts with `zsh:` means
  a zsh tab. In zsh tabs `$options[norcs]` reads `on` because of `--no-rcs`, even though the
  bootstrap sourced `~/.zshrc`.

## Keyboard

Keys pressed in a Warp tab go to the webview first. Paseo shortcuts reach the app only when the
page leaves the key alone, with these exceptions:

- **Ctrl+J** (toggle bottom panel) is `preempt`: the guest preload sends it from the capture phase
  before Warp sees it, because Warp uses Ctrl+J for newline.
- **Ctrl+R, Ctrl+Shift+R, Ctrl+L** go to Warp in tabs opened with `toolbar: false`. The app menu
  ignores them there too, or its Reload would reload the whole Paseo window.
- **Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W, Ctrl+T, Ctrl+Shift+T** stay in Warp when its tab is in the
  bottom panel: the Tab keys cycle Warp sessions, Ctrl+W closes one and Ctrl+Shift+T opens one,
  instead of acting on Paseo's tabs. In a normal pane Paseo keeps them, so Ctrl+T there opens a
  Paseo tab even from inside Warp. macOS Cmd+W and Cmd+T aren't covered.

Paseo's `browser_keypress` automation tool sends single keys without modifiers, so an agent can't
press Warp shortcuts through it. "Control+Shift+T" arrives as a typed "T".

## Building Warp

```bash
cd ~/projetos/warp-web-custom
CARGO_BUILD_JOBS=8 script/wasm/bundle --debug --channel oss --features remote_tty
```

- You need the Rust toolchain from `rust-toolchain.toml`, the `wasm32-unknown-unknown` target,
  `wasm-bindgen-cli` at the version in `Cargo.lock`, and `wasm-split` on your PATH. See
  "Setup on a new machine" for how to install them.
- `--debug` builds `target/wasm32-unknown-unknown/dev-wasm/bundle` in a couple of minutes once
  the cache is warm. Drop `--debug` for a release bundle under `release-wasm/bundle` (smaller
  download, much longer link step).
- **The bridge serves `release-wasm` over `dev-wasm`** whenever `release-wasm/bundle/wasm/warp_bg.wasm`
  exists. A stale release bundle hides every new debug build. That's how the login screen came
  back on 2026-10-18; the old bundle was renamed to `release-wasm/bundle.old-login-screen`. Set
  `BUNDLE_DIR` to force a directory.
- The bundle directory is resolved on every page load, so a new build needs no bridge restart.
  Open a new Warp tab; open tabs keep the old build until reloaded.
- Watch RAM while it builds. Lower `CARGO_BUILD_JOBS` when a Unity Editor is open.
- Don't build with Warp's `skip_login` feature. It signs in a fake test user and fails every
  authenticated request on purpose. The `root_view.rs` patch gives the real loginless state.

## Setup on a new machine

Set up the customized Paseo first (`custom/README.md`), then:

1. **Clone the fork's `paseo` branch.** The `PASEO:` commits live on
   [barruda/warp](https://github.com/barruda/warp) (public, a fork of upstream). Use the
   `github.com-personal` SSH alias for both remotes, like the Paseo checkout: the default key is
   the work account. It was first built on upstream `662c7bf` (2026-10-08).
   ```bash
   git clone --depth 1 -b paseo git@github.com-personal:barruda/warp.git ~/projetos/warp-web-custom
   cd ~/projetos/warp-web-custom
   git remote rename origin fork
   git remote add origin git@github.com-personal:warpdotdev/warp.git
   ```
2. **Install the build toolchain** with Warp's own script. It installs the apt packages (with
   sudo), Rust, the wasm target, `wasm-bindgen-cli` at the `Cargo.lock` version, `wasm-opt`, and
   `wasm-split` into `~/.local/bin`:
   ```bash
   script/wasm/install_build_deps
   ```
   Its last line writes to `$GITHUB_PATH`, which only exists in CI, so it fails there after
   everything is installed. Make sure `~/.local/bin` is on your PATH.
3. **Build Warp** as in "Building Warp".
4. **Install the bridge's dependencies:** `npm install` in `paseo-bridge/`. node-pty compiles a
   native module, which needs `build-essential` and `python3` (step 2 covers them).
5. **Install the plugin** on each daemon, per "One-time setup: plugins" in `custom/README.md`.
   The plugin runs `node` from the daemon's PATH. If Paseo is launched from a desktop entry that
   doesn't see your nvm Node, set `PASEO_WARP_NODE` to the full path of `node`.
6. **Only for zsh tabs:** create `~/.zshrc` with your aliases and `HISTFILE`/`SAVEHIST` (see
   "The shell"). Bash tabs use your `~/.bash_profile` and `~/.bashrc` as they are.
7. **Check it:** in the desktop app, "+ → Warp" should open a prompt in the workspace folder with
   no login screen.

## Updating

- **Upstream Warp:** merge or rebase `paseo` onto the new `master`, then rebuild. Re-apply a
  `PASEO:` patch by hand if upstream moved the code around it.
- **Back up Warp-side commits:** `git push fork paseo` (add `--force-with-lease` after a rebase).
  The checkout is shallow; if a push is rejected with "shallow update not allowed", run
  `git fetch --unshallow origin` first.
  `./git-add-commit-push-paseo-and-warp.sh` in the Paseo checkout commits everything in both
  checkouts as `wip` (Paseo's `package-lock.json` files excluded) and pushes both forks.
- **Plugin change:** `npx tsx packages/cli/src/index.js plugin reload warp --home ~/.paseo`.
  Reloading restarts the bridge, which kills the shells in every open Warp tab. Check they're idle
  first.
- **Bridge change:** the same plugin reload, since the plugin owns the bridge process.
- **Core change** (browser tab options, keyboard routing): rebuild and install the desktop app,
  per the `paseo-customizations` skill.

## Debugging

- Bridge output goes to `$PASEO_HOME/daemon.log` as "Plugin output" lines with `pluginId: "warp"`:
  the bundle path, `[bridge] session pid=… cwd=…`, and exit codes.
- To run the bridge by hand: `PORT=3030 npm start` in `paseo-bridge/`, then open
  `http://127.0.0.1:3030`. With no `WARP_BRIDGE_TOKEN` set, it accepts any connection.
- Headless Chromium doesn't render Warp's GPU canvas without a software GL fallback, so judge
  headless runs by the browser console log.
- Test: `(cd packages/server && npx vitest run src/server/plugins/custom-warp-plugin.e2e.test.ts)`.
  It skips when the bridge isn't installed.

## Limits

- bash and zsh only; fish and PowerShell aren't wired up.
- No Warp account or Warp AI: app.warp.dev rejects the local origin with CORS.
- The bridge listens on 127.0.0.1 only, so Warp tabs don't work from the phone or another
  machine. Reaching them would need the daemon to serve the bundle and the PTY endpoint through
  the relay.
