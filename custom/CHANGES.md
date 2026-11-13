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
  - `custom/plugins/shell-command/`: the plugin (slash command `sh`, RPCs `run`, `stop` and
    `input`, timeline renderer; history and completion RPCs belong to
    [shell-command-composer](#shell-command-composer-history-and-tab-completion-for-command)). No
    conflict risk.
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

## explorer-outside-workspace: open files outside the workspace

- **Added:** 2026-10-07 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: let the file explorer open files outside the workspace`
- **Why:** The Files sidebar refused symlinks that point out of the workspace (they were hidden
  from listings) and absolute paths elsewhere on the host, failing with "Access outside of
  workspace is not allowed".
- **What:** The daemon's file explorer no longer checks that a path stays inside the workspace.
  Symlinked files and folders that leave the workspace are listed and open normally, and absolute
  paths anywhere on the host can be listed, read, edited, renamed, and deleted. Paths outside the
  workspace come back absolute in responses instead of as `../..` paths. Deleting the workspace
  root itself is still refused.
  - Security: anyone who can reach the daemon (paired devices, the relay) can now read and write
    any file the daemon's user can, through the explorer.
- **Core files touched:** `packages/server/src/server/file-explorer/service.ts` (`resolveScopedPath`,
  `normalizeRelativePath`, the listing's skip filter), plus the outside-path tests in
  `service.test.ts` and `service.posix.test.ts`.
- **Re-apply:** In `resolveScopedPath`, drop both workspace containment checks (before and after
  `realpath`). In `listDirectoryEntries`, stop skipping entries that failed that check. In
  `normalizeRelativePath`, return the absolute target when it is outside the root. Flip the tests
  that expected "Access outside of workspace is not allowed" to expect the read to succeed.
- **Verify:** `(cd packages/server && npx vitest run src/server/file-explorer/service.test.ts src/server/file-explorer/service.posix.test.ts)`.
  The update script runs it. In the app, open a symlinked folder that points out of the workspace
  in the Files sidebar, and open a file link with an absolute path in another directory.

## explorer-folder-links: folder links in chat open in the Files sidebar

- **Added:** 2026-10-07 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: open folder links from chat in the Files sidebar`
- **Why:** Clicking a folder path in an agent message tried to open it as a file. Upstream only
  treats paths ending in `/` as folders, and then only opens the sidebar without showing the
  folder.
- **What:**
  - A link is a folder when it ends in `/`, or when it has no extension and the daemon can list it.
    Names with a dot (`notes.md`, `.bashrc`) open as files without a daemon round trip.
  - A folder inside the workspace: the sidebar opens, expands each parent, selects the folder, and
    scrolls to it.
  - A folder outside the workspace: the sidebar browses that folder instead, with a bar showing
    its path and a **Workspace** button to go back. Files opened from it use absolute paths. Needs
    [explorer-outside-workspace](#explorer-outside-workspace-open-files-outside-the-workspace).
  - The temporary root is in memory only; reloading the app returns to the workspace.
- **Files:** `packages/app/src/file-explorer/folder-links.ts` (store and path logic, tested in
  `folder-links.test.ts`) and `folder-links-pane.tsx` (hooks and the bar). New files; no conflict
  risk.
- **Core files touched:**
  - `packages/app/src/components/file-explorer-pane.tsx`: the exported `FileExplorerPane` became
    a wrapper that swaps in the temporary root; the original component is `FileExplorerTreePane`,
    which calls `useFolderLinkReveal` after `listRows`.
  - `packages/app/src/agent-stream/view.tsx`: `handleInlinePathPress` sends folders to
    `useFolderLinkStore` instead of `requestDirectoryListing`.
- **Re-apply:** In the explorer pane, wrap the exported component so it renders the tree with
  `workspaceId={null}` and `workspaceRoot={externalRoot}` when `useFolderLinkRoot` returns a root,
  converting callback paths to absolute; call `useFolderLinkReveal` with the tree's list rows and
  ref. In the chat's inline path handler, call `requestFolder(explorerStateKey, absolutePath)` and
  open the Files sidebar for folder links, probing extensionless paths with
  `client.listDirectory` first.
- **Verify:** `npx vitest run packages/app/src/file-explorer/folder-links.test.ts` (the update
  script runs it). In the app, ask an agent to print `` `/home/bruno/` `` and a workspace subfolder
  in backticks, then click each.

## workspace-tasks: a task list per workspace that agents work through

- **Added:** 2026-10-07 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: workspace task list with /next and auto-next`
- **Why:** To queue up work for a workspace and tell an agent "next task" instead of retyping
  prompts. Upstream's Tasks track only mirrors the agent's own todo list, and the Queue track is
  per agent, client-side, and lost on reload.
- **What:**
  - A **Task list** panel (Command Center: "Open task list", or `/tasks`; it can also sit in the
    Explorer sidebar). Add, edit (tap the text), reorder, check off, delete, clear done.
  - `/task <text>` in an agent's chat adds a task to that workspace.
  - `/next` marks the agent's in-progress task done and sends it the first pending task as a
    prompt. If the agent is busy, the task goes out when its turn ends.
  - `/autonext` toggles auto-next for that agent: each completed turn finishes the current task
    and sends the next. A failed or interrupted turn doesn't advance. It turns itself off when the
    list runs out. One auto-next agent per workspace.
  - Each command posts a one-line note in the chat. Notes live in daemon memory like the Terminal
    cards; the tasks don't.
  - Storage: `$PASEO_HOME/plugin-data/workspace-tasks/tasks.json`, keyed by workspace id. The
    plugin refuses to start from an empty list over a file it can't parse.
- **Files:** `custom/plugins/workspace-tasks/` (no conflict risk) and
  `packages/server/src/server/plugins/custom-workspace-tasks-plugin.e2e.test.ts` (breaks only if
  upstream changes the test utilities).
- **Core files touched:** none.
- **Re-apply:** Nothing to redo in core. If the plugin SDK changes, the plugin uses
  `addWorkspacePanel`, `addSlashCommand`, `addCommandCenterItem`, `addTimelineRenderer`,
  `server.on("agent.turn_ended")`, `paseo.agents.ref(id).send/refresh/timeline.append`.
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
- **Verify:** `npx vitest run custom/plugins/workspace-tasks` and
  `(cd packages/server && npx vitest run src/server/plugins/custom-workspace-tasks-plugin.e2e.test.ts)`.
  The update script runs both. In the app, run `/task try it`, then `/next`.

## bottom-panel: Ctrl+J toggles a bottom panel

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: Ctrl+J toggles a bottom panel`
- **Why:** VS Code's panel toggle. Upstream has no bottom panel, only left and right sidebars and
  splits you create and close by hand.
- **What:**
  - `Ctrl+J` (`Cmd+J` on macOS) in a workspace. The first press splits a full-width pane under the
    whole workspace and opens a terminal in it. Later presses hide and show that pane. It also
    works while a terminal has focus, so the terminal can hide its own panel.
  - Hiding uses the layout's `hidden` pane flag, the same one the Explorer uses: tabs stay mounted
    and terminals keep running. The pane's id is the literal `bottom-panel`, so the layout's own
    persistence remembers it and no extra store is needed.
  - Closing the panel's last tab removes the pane; the next press creates a new one. Hiding is
    refused when the panel is the only ordinary pane left.
  - Desktop and wide web only. Compact layouts ignore the shortcut.
  - Rebindable in Settings → Keyboard shortcuts ("Toggle bottom panel", Layout section).
  - A **Toggle bottom panel** icon in the left sidebar footer, after Hosts. It dispatches the same
    keyboard action, so it does nothing outside a workspace.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel.ts` (toggle logic) and
  `bottom-panel.test.ts`. New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(bottom-panel)`):
  - `packages/app/src/stores/workspace-layout-actions.ts`: `splitWorkspaceRootBottomInLayout`,
    added before `moveTabToPaneInLayout`.
  - `packages/app/src/keyboard/actions.ts`, `keyboard-action-dispatcher.ts`: the
    `workspace.bottom-panel.toggle` action id.
  - `packages/app/src/keyboard/route-shortcut.ts`: a `PASSTHROUGH_DISPATCH` entry.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: two bindings before "Toggle both
    sidebars", and `toggle-bottom-panel` in `SHORTCUT_HELP_ROW_ORDER.layout`.
  - `packages/app/src/screens/workspace/workspace-screen.tsx`: `handleBottomPanelToggle` and its
    `useKeyboardActionHandler` registration after the sidebar one.
  - `packages/app/src/components/left-sidebar.tsx`: `BottomPanelToggleButton` (before
    `IconTooltipContent`) and its use in `SidebarFooter` after `SidebarHostPicker`.
- **Re-apply:** Copy `splitWorkspaceRootRightInLayout` as `splitWorkspaceRootBottomInLayout`
  with `direction: "vertical"` and a caller-supplied pane id. Add the action id to both
  `KeyboardActionId` unions and the dispatcher's `KeyboardActionDefinition`, route it as a
  workspace-scoped passthrough, and bind `Cmd+J`/`Ctrl+J` with `commandCenter: false` and no
  `terminal: false`. In the workspace screen, register a handler that calls `toggleBottomPanel`
  and, when it returns `created`, calls `createTerminal` with
  `{ kind: "replace", tabId: launcherTabId }`. For the footer icon, render a `FooterIconButton`
  with lucide's `PanelBottom` that calls
  `useKeyboardActionDispatcher().dispatch({ id: "workspace.bottom-panel.toggle", scope: "workspace" })`.
- **Verify:** `(cd packages/app && npx vitest run src/workspace-tabs/bottom-panel.test.ts)` (the update
  script runs it). In the app, press `Ctrl+J` three times: terminal appears, hides, comes back
  with the same terminal.

## html-preview-assets: HTML previews show the images next to them

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: HTML preview loads images from the file's folder`
- **Why:** Agents write image galleries as `index.html` plus `images/*.png`. Upstream's preview
  is a self-contained srcdoc frame whose CSP allows only `data:` and `blob:` images, so every
  relative `<img src>` came up broken.
- **What:**
  - On web and desktop, a bridge script injected after the CSP watches `<img src>` (static markup
    and script-set) and posts each relative URL to the parent. The parent reads the file through
    the daemon (`client.readFile`) and posts the bytes back; the bridge swaps in a `blob:` URL.
  - Only image files (`png jpg jpeg gif webp avif svg bmp ico`) in the HTML file's folder or below,
    up to 32 MB each. URLs with a scheme, root-relative paths, and paths that climb above the
    folder are refused before any read. The frame's sandbox and CSP are unchanged.
  - Not covered: CSS `url()`, `srcset`, `<video>`, images never attached to the document, and
    links to images (`<a href>`; popups stay blocked). Native keeps the self-contained preview.
- **Files:** `packages/app/src/file-panels/html-preview-assets.ts` (path rules, loader, bridge),
  `html-preview-assets.test.ts`, `html-preview-assets.browser.test.ts`. New files; no conflict
  risk. (Moved from `file-pane/` with upstream 0.14, which moved the preview to `file-panels/`.)
- **Core files touched** (each marked `CUSTOM(html-preview-assets)`):
  - `packages/app/src/file-panels/html-preview-csp.ts`: `withPreviewCsp` takes a second
    `headMarkup` argument inserted after the policy meta.
  - `packages/app/src/file-panels/html-preview.web.tsx`: iframe ref, injects the bridge, answers
    asset requests from its own frame. `html-preview.tsx` (native) accepts and ignores `loadAsset`.
  - `packages/app/src/file-panels/builtin.tsx`: `HtmlPreview` builds the loader from the host's
    `client` and `resolveFilePreviewReadTarget({ path: params.path, workspaceRoot })` and passes
    it to `FileHtmlPreview` as `loadAsset`.
  - `SECURITY.md`: the HTML preview section says which files the preview can read.
- **Re-apply:** Wherever the web preview builds its srcdoc, append `PREVIEW_ASSET_BRIDGE_SCRIPT`
  right after the CSP meta, listen for `message` events whose `source` is the frame's
  `contentWindow`, and answer `parsePreviewAssetRequest` hits with `respondToPreviewAssetRequest`
  using a loader from `createPreviewAssetLoader({ client, cwd, htmlPath })` for the previewed file.
  Since 0.14 that file is the built-in HTML panel's Preview (`HtmlPreview` in
  `file-panels/builtin.tsx`), which gets `params`, `workspaceId` and `host` as props.
- **Verify:** `(cd packages/app && npx vitest run src/file-panels/html-preview-assets.test.ts)` and
  `(cd packages/app && npx vitest run --project browser src/file-panels/html-preview-assets.browser.test.ts)`
  (needs `npx playwright install --only-shell chromium` once). The update script runs both. In the
  app, open `~/uprojects/DreamMMO/docs/art/guided-lighting-2026-10-08/gallery/index.html` and check
  that the comparison and cards show the captures.

## no-auto-update: installed builds never update themselves to upstream

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: keep the auto-updater off in installed builds`
- **Why:** Closing Paseo sometimes asked for the root password to run `zypper` on
  `Paseo-<upstream version>-x86_64.rpm`. The custom build reports an older version than upstream's
  latest release, so the updater downloaded the official package and tried to install it on quit.
  It picked the RPM path because electron-builder writes `resources/package-type` into
  `linux-unpacked` for each package it makes, and `rpm` comes last. Accepting would replace the
  custom build with upstream.
- **What:** The install step deletes `resources/package-type` from each new build folder.
  `electron-updater` then falls back to its AppImage updater, which is inactive when `APPIMAGE` is
  unset, so no check, download, or install happens.
  - The script builds only the unpacked app (`npm run build:desktop -- --linux dir`), which writes
    no `package-type` at all and skips the rpm step that fails on Ubuntu without `rpmbuild`. The
    delete still covers a full `npm run build:desktop`.
- **Files:** `custom/update-paseo-source-and-apply-customization.sh` (`install_build` and the
  build step). No core files touched.
- **Re-apply:** If upstream's updater stops reading `package-type`, disable updates another way in
  the installed copy, for example by deleting `resources/app-update.yml` (this logs an update error
  instead of staying silent).
- **Verify:** `ls ~/Applications/Paseo-builds/<newest>/resources/package-type` fails, and
  `~/.cache/@getpaseodesktop-updater/pending/` stays empty after the app has run a while.

## warp: Warp terminal tabs

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: Warp terminal tabs`
- **Why:** Warp's terminal UX (blocks, input editor) inside Paseo. Warp is a native GPU app that
  can't be embedded, but its open-source client also compiles to the web, and its `remote_tty`
  build feature drives a shell over a plain WebSocket. Paseo runs that build in a browser tab.
  The whole setup (architecture, shell, keyboard, building, debugging) is in
  [docs/custom-warp-web-embedded.md](../docs/custom-warp-web-embedded.md).
- **What:**
  - **Warp** in the "+" new-tab menu (and Command Center: "Open Warp") opens a Warp session in a
    workspace browser tab, in the workspace's folder. The Warp panel stays as a launcher with a
    "New Warp session" button. Browser tabs exist only in Electron; elsewhere the panel shows a
    link.
  - The Warp side lives outside this repo, in `~/projetos/warp-web-custom` (override with
    `PASEO_WARP_WEB_DIR`): a Warp checkout with a one-function patch
    (`app/src/terminal/remote_tty/event_loop.rs` reads the PTY URL from
    `window.PASEO_WARP_PTY_URL` instead of the hard-coded `ws://127.0.0.1:3030/create`), its web
    build, and `paseo-bridge/server.mjs`. The bridge serves the build and the `/create` PTY
    WebSocket with node-pty.
  - The plugin's server side starts the bridge with system `node` when the plugin loads (the
    plugin process runs on Electron's Node, which can't load the bridge's node-pty) and stops it
    with the plugin. Restored Warp tabs load the saved URL directly, so a bridge that started on
    first open left them blank after every reboot.
    It listens on 127.0.0.1 and requires a token; the port and token are kept in
    `$PASEO_HOME/plugin-data/warp/bridge.json` so restored Warp tabs keep working after a restart.
  - No Warp login: a patch (`app/src/root_view.rs`) makes `remote_tty` builds start straight in
    the terminal when nobody is signed in, the same loginless state as desktop's "Skip for now".
    Without it the web client tries to import the app.warp.dev session, fails on the local origin,
    and shows the login screen on every new tab. A second patch (`app/src/wasm_nux_dialog.rs`)
    hides the "Download Warp Desktop?" dialog in `remote_tty` builds. Don't use Warp's
    `skip_login` feature instead: it signs in a fake test user and fails every authenticated
    request on purpose.
  - Limits: zsh only (Warp's remote_tty bootstrap is zsh-only), no Warp account or Warp AI
    (app.warp.dev blocks the local origin with CORS).
- **Files:** `custom/plugins/warp/` and
  `packages/server/src/server/plugins/custom-warp-plugin.e2e.test.ts`.
- **Core files touched:** none.
- **Re-apply:** Nothing to redo in core. If the plugin SDK changes, the plugin uses
  `addWorkspacePanel`, `addCommandCenterItem`, `navigation.openBrowser`, and one RPC.
  To rebuild Warp after pulling it:
  `cd ~/projetos/warp-web-custom && CARGO_BUILD_JOBS=8 script/wasm/bundle --debug --channel oss --features remote_tty`
  (needs Rust from `rust-toolchain.toml`, the `wasm32-unknown-unknown` target, `wasm-bindgen-cli`
  at the version in `Cargo.lock`, and `wasm-split` on PATH). `--debug` builds the `dev-wasm`
  bundle in minutes; a release bundle under `release-wasm` wins over it once it has
  `wasm/warp_bg.wasm`, so delete a half-finished one. Re-apply the
  patches if upstream Warp moved the code; they're the commits on the `paseo` branch there.
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
  Then `npm install` in `~/projetos/warp-web-custom/paseo-bridge`.
- **Verify:** `(cd packages/server && npx vitest run src/server/plugins/custom-warp-plugin.e2e.test.ts)`
  (skipped when the bridge isn't installed). The update script runs it. In the app, pick Warp from
  the "+" menu; a Warp prompt in the workspace folder appears with no login screen.

## chat-images: an image strip beside the chat

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: image strip beside the chat`
- **Why:** Agents that post screenshots and renders spread them across a long chat. Finding one
  meant scrolling back through the transcript.
- **What:**
  - A column of thumbnails on the right edge of the chat, one per image the agent put in a
    message (`![alt](path)`, the same images the chat renders), oldest at the top. It shows only
    when the chat has images.
  - Hover a thumbnail for a larger preview. Click it to scroll the chat to that image.
  - The thumbnails of the message you are reading are fully opaque, and the strip scrolls to keep
    them in view.
  - The strip sits in the gutter beside the transcript: 64 px thumbnails when the gutter fits them,
    40 px when it is narrower, hidden when even those don't fit (with the default 820 px content
    width that is a chat pane under about 900 px). Desktop and web only.
  - It lists the loaded part of the history. Older pages appear once you scroll up and load them.
  - Not covered: images a tool returned (the chat doesn't render those either), image paths
    written as plain text or `` `code` ``, and images you attached to your own messages.
- **Files:** `packages/app/src/agent-stream/chat-images/` (`model.ts` parses the images, `rail.web.tsx`
  is the strip, `rail.tsx` is the native no-op, `model.test.ts`). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(chat-images)`):
  - `packages/app/src/agent-stream/view.tsx`: `chatImages` and `chatImagesReadingPosition` before
    `useImperativeHandle`, a publish in `handleReadingPositionChange`, and `<ChatImagesRail>` after
    `<ChatOutlineRail>`.
  - None in the renderer since upstream 0.14: chat Markdown is react-native-enriched-markdown,
    which draws each image as a plain `<img>` inside the Markdown stack (the view carrying
    `data-paseo-markdown-image-sources`). `CHAT_IMAGE_SELECTOR` in `model.ts` finds them there.
    Thumbnails load through upstream's `useMarkdownSource` (`components/markdown/images.ts`),
    sharing its cache with the transcript.
- **Re-apply:** In the agent stream view, collect images with
  `collectChatImages([...tail items, ...head items])`, keep a `createActivePromptPublisher()` fed
  with the timeline seq of the row at the top of the viewport (wherever the chat outline gets its
  reading position), and render `ChatImagesRail` next to the outline rail with the viewport ref,
  visible message ids, and the reveal function that also opens collapsed turns. Find the n-th
  rendered image of a message by querying the Markdown stack's `<img>`s inside the message's
  `data-message-id` rows; if the renderer stops drawing a plain `<img>`, tag its image instead.
- **Verify:** `(cd packages/app && npx vitest run src/agent-stream/chat-images/model.test.ts)` (the
  update script runs it). In the app, ask an agent to reply with a few `![x](path.png)` images,
  then hover and click the thumbnails on the right.

## model-picker: Ctrl+M picks the model and effort from the keyboard

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: Shift+Tab model and effort picker`
- **Why:** Changing model or effort meant reaching for the composer's dropdowns, or opening the
  command center and typing "model". The model dropdown also searches one provider at a time.
- **What:**
  - Ctrl+M (on every platform, since Cmd+M minimizes on macOS) in an agent's message input (or a
    new-agent draft) opens a centered picker shaped like the
    command center. A chip with the shortcut sits at the end of the composer controls (desktop
    layout), after the model, effort, and mode controls.
  - With an empty search, the list is: **Current** (the composer's model), **Favorites** (in the
    order you added them), then every model under its provider. Typing searches the models of every
    provider in one ranked list, favorites first.
  - **Ctrl+D** (⌘D on macOS) or the star on a row favorites or unfavorites the highlighted model.
    Favorites are stored in the app's local storage (`custom-model-picker-favorites`), so each
    install and each launcher profile keeps its own. A running agent's picker only shows favorites
    from its own provider.
  - ↑/↓ move through models, ←/→ pick the effort, Enter applies both and closes, Esc closes. Click
    works too.
  - The effort bar shows the highlighted model's levels: the live effort for the current model, the
    model's default for others. An effort picked with ←/→ carries to other models that offer it.
  - Switching model and effort together sets the model first, then the effort once the composer
    reports the new model (given up after 15 s).
  - A running agent lists only its own provider's models: upstream can't move a running agent to
    another provider. Drafts list every enabled provider.
  - Shift+Tab used to cycle the agent mode. It now cycles recently active workspaces
    ([active-workspace-cycle](#active-workspace-cycle-shifttab-cycles-recently-active-workspaces)),
    and mode cycling is unbound; assign it a key in Settings → Shortcuts ("Cycle agent mode") to
    get it back.
  - Clicking the composer's model chip (desktop layout) opens this picker instead of the model
    dropdown: `CombinedModelSelector` takes `onTriggerPress`, and `AgentControls` /
    `DraftAgentControls` pass an opener (`useModelPickerSource` returns one).
- **Files:** `packages/app/src/model-picker/` (`model.ts` list/effort/favorite logic with
  `model.test.ts`, `store.ts`, `favorites-store.ts`, `use-model-picker-source.ts`,
  `model-picker.tsx`). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(model-picker)`):
  - `packages/app/src/keyboard/actions.ts`, `keyboard-action-dispatcher.ts`, `route-shortcut.ts`:
    the `model-picker` message-input kind and its `message-input.model-picker` action.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: the mode-cycle binding's combo is `""`, a new
    `message-input-model-picker-ctrl-m` binding, and its help row in the agent-input order.
    Tests in `keyboard-shortcuts.test.ts` and `route-shortcut.test.ts`.
  - `packages/app/src/provider-selection/provider-selection.ts`: model rows carry
    `thinkingOptions` and `defaultThinkingOptionId`.
  - `packages/app/src/composer/agent-controls/index.tsx`: `AgentControlCommandCenterRegistration`
    (running agents) and `DraftAgentControls` (the New Workspace screen and draft tabs) call
    `useModelPickerSource`. Upstream registers the New Workspace composer with nothing, so the
    draft side builds its own controls object from its props, resolving an untouched draft's empty
    model to the provider's default.
  - `packages/app/src/app/_layout.tsx`: `<ModelPicker />` next to `<CommandCenter />`.
- **Re-apply:** Add a message-input keyboard kind that dispatches `message-input.model-picker`,
  bind Ctrl+M to it in the message-input focus scope, and set the mode-cycle binding's combo to
  `""` (keep its id so saved overrides survive). Copy each model's thinking options onto the
  provider selector rows. Call `useModelPickerSource` from the running agent's command-center
  registration (same source id, enabled flag, and controls) and from the draft agent controls (an
  `AgentControlCommandCenterSource` built from its props, enabled while it is the active composer).
  Mount `<ModelPicker />` in the root layout.
- **Verify:** `(cd packages/app && npx vitest run src/model-picker/model.test.ts src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts)`
  (the update script runs it). In the app, focus a message input (New Workspace screen and a running
  agent), press Ctrl+M, type part of a model name, press → and Enter, and check the composer's
  model and effort controls.

## copy-full-file-path: "Copy full file path" in the file tab menu

- **Added:** 2026-10-09 (based on upstream 0.11.0-beta.2, `b5b43edd6`). Changed 2026-10-20: `~`
  paths expand to the host's home.
- **Commit:** `custom: Copy full file path in the file tab menu`, then
  `custom: Copy full file path expands ~ to the host home`
- **Why:** Upstream's "Copy file path" copies the tab's path as stored, which is relative to the
  workspace for files opened from the explorer. Pasting a path into another tool or terminal needs
  the absolute one.
- **What:** File tabs get a first menu entry, **Copy full file path**, that copies the path
  resolved against the workspace root (`/home/bruno/uprojects/teste.html`). A path that is already
  absolute is copied as is. "Copy file path" is unchanged. Same menu on desktop and mobile. The
  label is English only.
  - Tabs opened from chat links to files outside the workspace store `~/…` paths. Those expand to
    the daemon host's home (`/home/bruno/telus/reports/x.html`), not to the workspace. The app
    learns the home by listing `~` from the workspace, which explorer-outside-workspace answers
    with the absolute path, and caches it per host. Open in browser / default app
    (open-file-externally) resolves the same way.
- **Core files touched** (each marked `CUSTOM(copy-full-file-path)`):
  - `packages/app/src/screens/workspace/workspace-tab-menu.ts`: the entry, and an optional
    `copyFullFilePath` label.
  - `packages/app/src/screens/workspace/workspace-screen.tsx`: `handleCopyFilePath` takes
    `mode?: "full"` and resolves the path with `buildAbsoluteExplorerPath`.
  - The `onCopyFilePath` prop type gains `mode?: "full"` in
    `compact-workspace-header/tab-switcher.tsx` (two places), `workspace-desktop-tabs-row.tsx`
    (two places), and `components/split-container.tsx`. The props
    pass the handler through unchanged, so the second argument reaches it.
  - `workspace-tab-menu.test.ts`: expects the new entry first.
  - `screens/workspace/workspace-tab-menu-actions.ts` (`copyTabFilePath`, `createTabFileOpener`,
    shared by the workspace screen and Desks): resolve through `tab-file-path.ts` (new file, with
    a test) and take an optional `serverId`, which `workspace-screen.tsx` and
    `task-navigation/desk-screen.tsx` pass.
- **Re-apply:** In the file-tab branch of `buildWorkspaceTabMenuEntries`, push an entry before
  "Copy file path" that calls `onCopyFilePath(path, "full")`. In the workspace screen's copy
  handler, when the mode is `"full"` and the path is relative, join it to `workspaceDirectory`;
  when it starts with `~`, get the home from `client.listDirectory(workspaceDirectory, "~")`
  (its `path`) and join to that.
  Widen every `onCopyFilePath` prop type the handler passes through. If upstream wraps the prop in
  a lambda somewhere on the way, forward the second argument there too.
- **Verify:** `(cd packages/app && npx vitest run src/screens/workspace/workspace-tab-menu.test.ts src/screens/workspace/tab-file-path.test.ts)`
  (the update script runs it). In the app, right-click a file tab, pick **Copy full file path**,
  and paste. Do the same on a tab opened from a `~/…` link outside the workspace: the paste starts
  with `/home/`.

## html-preview-keys: app shortcuts work inside the HTML preview

- **Added:** 2026-10-09 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: app shortcuts work while an HTML preview has focus`
- **Why:** After clicking into an HTML file preview, Ctrl+Tab and every other app shortcut did
  nothing. The preview is a sandboxed `srcdoc` iframe, and key events inside an iframe never reach
  the app window where the shortcut listener runs. Browser tabs don't have this problem: their
  guest preload already forwards shortcuts.
- **What:** A bridge script in the frame posts every Ctrl, Cmd, or Alt combo the page didn't cancel
  to the parent, which replays it as a `keydown` on the `<iframe>` element. The page gets first
  refusal (a combo it `preventDefault`s stays in the page). The frame doesn't cancel what it
  forwards, so the page's own default still runs too (Ctrl+C keeps copying). Plain keys and
  modifier-only presses are not forwarded. Web and desktop; native keeps upstream's preview.
  The page can post the message itself, so a hostile preview can fire app shortcuts; `SECURITY.md`
  says so.
- **Files:** `packages/app/src/file-panels/html-preview-keys.ts` (bridge script, message parser,
  replay) and `html-preview-keys.browser.test.ts`. New files; no conflict risk. (Moved from
  `file-pane/` with upstream 0.14.)
- **Core files touched** (each marked `CUSTOM(html-preview-keys)`):
  - `packages/app/src/file-panels/html-preview.web.tsx`: prepends `PREVIEW_KEY_BRIDGE_SCRIPT` to the
    head markup passed to `withPreviewCsp`, and a `message` listener that replays parsed keys.
  - `SECURITY.md`: the HTML preview section says the page can trigger app shortcuts.
- **Re-apply:** Wherever the web preview builds its srcdoc, add `PREVIEW_KEY_BRIDGE_SCRIPT` after
  the CSP meta (it needs inline script, which the preview CSP allows). Listen for `message` events
  whose `source` is the frame's `contentWindow` and call `replayPreviewKey(frame, key)` for each
  `parsePreviewKey` hit. The replay only has to reach a window-level `keydown` capture listener.
- **Verify:** `(cd packages/app && npx vitest run --project browser src/file-panels/html-preview-keys.browser.test.ts)`
  (the update script runs it). In the app, open an `.html` file, click inside the preview, and press
  your next-tab shortcut.

## beautiful-chat: chat cards remember open or closed per kind

- **Added:** 2026-10-10 (based on upstream 0.11.2; plugin vendored from
  [ABorakati/beautiful-chat](https://github.com/ABorakati/beautiful-chat) `42b61d8`)
- **Commit:** `custom: beautiful-chat cards remember open or closed per kind`
- **Why:** Upstream beautiful-chat decides a card's open state once, when it mounts: tool calls open
  while running, thinking opens while streaming. In a live chat every card mounts while running, so
  every shell, edit, and thinking card stayed open. Its settings have no option for it.
- **What:** Each kind of card (the tool name, such as `bash`, `edit`, `read`, or `thinking` for both
  reasoning and thinking tool calls) starts the way you last left a card of that kind. Every kind
  starts closed until you toggle one. The choice is saved in the app's `localStorage`, so each
  Paseo window profile (personal, Telus) keeps its own. Cards already on screen don't change when you
  toggle another; the next card that mounts uses the new state. Failed tools no longer force open.
- **What (messages):** The "enhanced user bubble" and "assistant markdown" preferences default to off
  (`CUSTOM(beautiful-chat-native-messages)` in `client/preferences.ts`), so Paseo draws user and
  assistant messages itself. Only Paseo's own bubbles carry the rewind menu on user messages and the
  fork menu on assistant replies, and the plugin SDK exposes neither. Both can be turned back on in
  Settings → Chat presentation, at the cost of those menus. A choice saved there wins over the
  default.
- **Files:** `custom/plugins/beautiful-chat/`, a copy of upstream without `docs/`, `images/`, and
  `.showcase/`. The change is `client/expand-memory.ts` (new, marked
  `CUSTOM(beautiful-chat-collapse)`), `client/expand-memory.test.ts`, and the open-state lines in
  `client/components/tool-callouts.tsx`, `client/components/reasoning-trace.tsx`, and
  `client/live-renderers.tsx`. Upstream's own code fails this repo's lint and format rules and is
  left as upstream wrote it.
- **Core files touched:** `.oxlintrc.json` and `.oxfmtrc.json`: `ignorePatterns` skip
  `custom/plugins/beautiful-chat/**` except `client/expand-memory*.ts`, so checks skip the
  vendored code and still check ours. JSON has no comments, so no `CUSTOM(` marker.
  On conflict, re-add the two patterns to whatever list upstream has.
- **Re-apply:** To take a newer upstream, copy its files over the plugin folder (keep
  `expand-memory.ts` and its test), then redo the three edits: in `ToolCallout` replace
  `useState(defaultExpanded)` with `useRememberedExpanded(data.tool)` and toggle with the returned
  function; in `ReasoningTrace` do the same with `useRememberedExpanded("thinking")`; in
  `live-renderers.tsx` stop passing `defaultExpanded` to both. Set `enhancedUserBubble` and
  `assistantMarkdown` to `false` in `DEFAULT_PREFERENCES`. Then
  `plugin reload beautiful-chat` on each daemon (the daemon reruns `npm ci` from
  `paseo-plugin.json`).
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
  Remove the registry copy first: `paseo plugin remove beautiful-chat --home <home>`.
- **Verify:** `npx vitest run custom/plugins/beautiful-chat` (the update script runs it). In the app,
  close a thinking card, then send a prompt: new thinking cards in any chat start closed.

## done-task-archive: one-click archive for done tasks in the sidebar

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: archive button under the kebab for done tasks`
- **Why:** Workspaces whose Workboard task is done pile up in the sidebar. Archiving each through
  the kebab menu takes two clicks and a precise aim.
- **What:** A sidebar workspace row with the `task:done` or `pwb:done` label (Power Workboard's
  Done) shows an archive icon under its kebab, wherever the kebab shows (hover on desktop, always
  on touch). Pressing it runs the row's normal archive action, with the same worktree warning. A
  renamed Done label isn't picked up; the labels are constants in `done-task-archive.ts`.
- **Files:** `packages/app/src/components/sidebar/done-task-archive.ts` and its test.
- **Core files touched:** `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`, marked
  `CUSTOM(done-task-archive)`. Upstream's `SidebarWorkspaceMenu` is renamed
  `UpstreamSidebarWorkspaceMenu`, and a new `SidebarWorkspaceMenu` wraps it and adds the button.
  Also a `Pressable` import, the `isDoneTaskWorkspace` import, and an `archiveButton` style.
- **Re-apply:** Wherever upstream renders the sidebar row kebab (all three row renderers share
  `SidebarWorkspaceMenu`), render after it a `Pressable` with the `Archive` icon that calls
  `onArchive` when `isDoneTaskWorkspace(workspaceLabels)`. Give it a 26px box (`hitSlop` does
  nothing on web, and a smaller target is easy to slip off), with negative margins that center it
  under the dots without widening the overlay. The kebab sits in an absolutely positioned
  overlay at the top right of the title row, so the button drops onto the meta line.
- **Verify:** `(cd packages/app && npx vitest run src/components/sidebar/done-task-archive.test.ts)`
  (the update script runs it). In the app, hover a workspace labeled `task:done`: the archive icon
  sits under the three dots and archives the workspace.

## sidebar-new-workspace-in-list: New workspace sits in the Workspaces area

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: New workspace row under the Workspaces title`
- **Why:** The New workspace row sat in the top block with History and Search, away from the list
  it adds to. Its shortcut only showed on hover.
- **What:** The row moved from the top block to right under the "Workspaces" title, above the
  projects. Its shortcut (Ctrl+N by default) always shows on the right. Hiding "New workspace" in
  Settings → Sidebar still hides it; its position in that list no longer does anything. Like the
  title, the row is absent when the sidebar has no projects at all.
- **Core files touched** (each marked `CUSTOM(sidebar-new-workspace-in-list)`):
  - `packages/app/src/components/sidebar/sidebar-nav-rows.tsx`: `SidebarNavRows` skips the
    `new-workspace` item; new `SidebarWorkspacesNewWorkspaceRow`; `SidebarNewWorkspaceRow` takes a
    `variant` and passes the shortcut as `trailing`.
  - `packages/app/src/components/left-sidebar.tsx`: `WorkspacesSectionHeader` renders the old
    header (now `WorkspacesSectionTitleRow`) and the row; the mobile sidebar builds its header
    element with `closeSidebar`.
- **Re-apply:** Filter the `new-workspace` builtin out of the header nav rows. Render the New
  workspace row (variant `inline`, so the list's padding is the only inset) inside the element the
  sidebar passes as the workspace list's `listHeaderComponent`, under the title, only when that nav
  item is visible. Pass `<Shortcut chord={shortcutKeys} />` as the row's `trailing` so it shows
  without hover.
- **Verify:** No unit test; it is layout only. In the app, the row sits under "Workspaces" with
  Ctrl+N showing, and pressing it opens New Workspace for the active workspace's project.

## model-picker-project: Ctrl+M picks the project of a new conversation

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: Shift+Tab picker lists the project first in new conversations`
- **Why:** Starting a conversation from the keyboard meant Ctrl+M for the model, then Ctrl+P
  or the mouse for the project.
- **What:** Extends [model-picker](#model-picker-ctrlm-picks-the-model-and-effort-from-the-keyboard).
  - In a composer with no messages yet (the New Workspace screen, or an empty agent tab), the
    picker's first row is **Project** with the current project's name, highlighted when the picker
    opens. ↓ moves to the models as before; while Project is highlighted the effort bar shows the
    current model's effort.
  - Enter (or a click) on Project lists the projects with a search field, current one first. Enter
    picks one, Esc goes back to the models.
  - New Workspace screen: the project changes in place and the picker returns to the models with
    the current model highlighted, so a second Enter applies the model and effort.
  - Empty agent tab: the tab belongs to its workspace, so another project opens New Workspace for
    that project and closes the picker. What you typed stays in the tab's draft.
  - Running agents keep the picker as it was.
  - Effort doesn't depend on the Project row: ←/→ (or a click on an effort) while Project is
    highlighted moves the highlight to the current model, so Enter applies the new effort instead
    of opening the projects.
- **Files:** `packages/app/src/model-picker/project.ts` (list, label, pick plan) with
  `project.test.ts`, and `use-draft-tab-project-source.ts`. New files; no conflict risk. Changes
  in the model-picker files marked `CUSTOM(model-picker-project)`: the Project row,
  `resolveModelPickerHighlight`, and `resolveHighlightAfterEffortChange` in `model.ts` (tested in
  `model.test.ts`), `chooseEffort` in `model-picker.tsx`, the store's `project`,
  the `project` input of `useModelPickerSource`, and the project mode in `model-picker.tsx`.
- **Core files touched** (each marked `CUSTOM(model-picker-project)`):
  - `packages/app/src/composer/agent-controls/index.tsx`: `DraftAgentControlsProps` takes
    `modelPickerProject` and passes it to `useModelPickerSource`.
  - `packages/app/src/screens/new-workspace-screen.tsx`: `modelPickerProject` built from the
    project picker's options, selected id, and `handleSelectProjectOption`, added to
    `agentControlsWithDisabled`.
  - `packages/app/src/composer/draft/workspace-tab.tsx`: `useDraftTabProjectSource` added to
    `composerAgentControls`.
- **Re-apply:** Give the draft agent controls an optional `modelPickerProject`
  (`ModelPickerProjectSource`) and hand it to `useModelPickerSource`. On the New Workspace screen,
  fill it from the project combobox state; in the draft tab, use `useDraftTabProjectSource`.
- **Verify:** `(cd packages/app && npx vitest run src/model-picker/model.test.ts src/model-picker/project.test.ts)`
  (the update script runs it). In the app, open New Workspace, press Ctrl+M, Enter, type part of
  a project name, Enter: the project changes and the picker shows the models. Then press Ctrl+M,
  →, Enter: the composer's effort changes and the picker closes.

## active-workspace-cycle: Shift+Tab cycles recently active workspaces

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: Shift+Tab cycles workspaces active in the last 45 minutes`
- **Why:** Hopping between the few workspaces with agents at work. Ctrl+1..9 number the whole
  sidebar, and numbering by activity instead (tried and dropped the same day) moved the numbers
  around too much.
- **What:**
  - Shift+Tab in a message input goes to the next workspace, in sidebar order, that had activity in
    the last 45 minutes, wrapping at the end. From a workspace that isn't in that set, it goes to
    the first one. When no other workspace had activity in that window, a toast says so.
  - Activity is the newest `lastActivityAt` of any of the workspace's agents (subagents count,
    archived ones don't). A workspace whose agent is running counts too, so a long quiet tool call
    doesn't drop it.
  - Sidebar order is what the sidebar shows: pinned chats, then each project's workspaces (or the
    status groups in status mode), collapsed projects included, filtered-out workspaces excluded.
  - After switching, the new workspace's message input gets focus, so pressing again keeps cycling.
  - Only in a message input, like the old Shift+Tab. Holding the keys doesn't repeat. Rebindable in
    Settings → Shortcuts ("Next workspace active in the last 45 minutes").
- **Files:** `packages/app/src/active-workspace-cycle/` (`model.ts` the set and the next target,
  `cycle-handler.tsx` the action handler, `model.test.ts`). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(active-workspace-cycle)`):
  - `packages/app/src/keyboard/actions.ts`, `keyboard-action-dispatcher.ts`, `route-shortcut.ts`:
    the `active-workspace-cycle` message-input kind and its `message-input.active-workspace-cycle`
    action. Tests in `route-shortcut.test.ts`.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: the
    `message-input-active-workspace-cycle-shift-tab` binding and its help row in the agent-input
    order. Tests in `keyboard-shortcuts.test.ts`.
  - `packages/app/src/composer/agent-controls/index.tsx`: `ModelPickerShortcutChip`
    (`model-picker/shortcut-chip.tsx`) at the end of `ControlledAgentControls` when not compact,
    marked `CUSTOM(model-picker)`.
  - `packages/app/src/app/_layout.tsx`: `<ActiveWorkspaceCycleHandler>` next to
    `<WorkspaceShortcutTargetsSubscriber>`, inside the `SidebarModelProvider`.
- **Re-apply:** Add a message-input keyboard kind that dispatches
  `message-input.active-workspace-cycle` and bind Shift+Tab to it in the message-input focus scope
  with `repeat: false`. Mount the handler wherever the sidebar model is available; it reads the
  order from `useSidebarModel()` and the activity from `useSessionStore.getState()` at key press.
- **Verify:** `(cd packages/app && npx vitest run src/active-workspace-cycle/model.test.ts src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts)`
  (the update script runs it). In the app, send prompts in two workspaces, then press Shift+Tab in a
  message input a few times: it alternates between them.

## header-shortcuts: everyday shortcuts in the workspace header

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: everyday shortcuts in the workspace header`
- **Why:** The customized shortcuts (Ctrl+M, Shift+Tab) and the common ones are easy to forget,
  and Settings → Shortcuts is a long list.
- **What:**
  - A row of key badges with a label of two words at most, in the workspace header, 30 px left of
    the header buttons (editor, Commit, Explorer toggle): New workspace, Model, Next active, New
    tab, Search, Bottom panel. Edit the list in `HEADER_SHORTCUTS` in `strip.tsx`.
  - Each badge shows the current binding, overrides included. A shortcut with no binding is left
    out.
  - When the header is narrow, shortcuts drop from the end of the list, keeping 380 px for the
    title. Item widths are estimated from their text, not measured.
  - Desktop layout only.
- **Files:** `packages/app/src/header-shortcuts/` (`strip.tsx` the list and row, `fit.ts` how many
  fit, `layout.tsx` the width measuring, `fit.test.ts`). New files; no conflict risk.
- **Core files touched** (marked `CUSTOM(header-shortcuts)`):
  `packages/app/src/screens/workspace/workspace-screen.tsx`: the `headerRight` `View` became
  `HeaderShortcutsRightRow` (which renders the strip, then the buttons in a `View` with the same
  style), and `ScreenHeader` gets `onRowLayout` from `useHeaderShortcutsRowLayout`.
- **Re-apply:** Wrap the workspace header's right-side buttons in `HeaderShortcutsRightRow` with
  the workspace's persistence key, and pass `useHeaderShortcutsRowLayout(persistenceKey)` as the
  `ScreenHeader`'s `onRowLayout`. The strip fits into the row's width, not the sum of its children:
  measuring the children made the strip's own width feed back into the count and flicker when the
  window was narrow.
- **Verify:** `(cd packages/app && npx vitest run src/header-shortcuts/fit.test.ts)` (the update
  script runs it). In the app, the shortcuts sit left of the Commit button; narrowing the window
  drops them from the right end of the list first.

## workspace-rename-f2: F2 renames the focused agent

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: F2 renames the active workspace from anywhere`, then
  `custom: F2 renames the focused agent instead of the workspace`
- **Why:** Renaming meant a tab or sidebar menu. The agent session is what gets renamed most;
  the workspace rename stays one step away in the command center.
- **What:** F2 renames the focused tab's agent session from anywhere: message input, terminal,
  file views, and Desks in Tasks mode. Only the command center keeps F2 to itself. Holding the key
  doesn't repeat. Listed under Tabs and panes in Settings → Shortcuts ("Rename current agent"),
  where it can be rebound.
- **Core files touched** (each marked `CUSTOM(workspace-rename-f2)`):
  - `packages/app/src/keyboard/actions.ts`: `workspace.tab.rename-current` added to
    `KeyboardActionId`.
  - `packages/app/src/keyboard/route-shortcut.ts`: maps it to the dispatcher's existing
    `workspace.tab.rename-current` action (scope `workspace`). Test in `route-shortcut.test.ts`.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: the `workspace-rename-f2` binding and its
    `rename-current-agent` help row. Tests in `keyboard-shortcuts.test.ts`.
  - `packages/app/src/task-navigation/desk-screen.tsx` handles the action for the Desk's focused
    tab (it lands with the Desk chips commit).
- **Re-apply:** Upstream already has the dispatcher action `workspace.tab.rename-current` (used by
  the command center), and the workspace screen handles it for the focused tab. Add the action to
  the shortcut action ids, route it to the dispatcher action, and bind F2 with `repeat: false` and
  `when: { commandCenter: false }` (no `terminal: false`, so it works in a terminal too). Desks
  replace the workspace screen, so DeskScreen's tab action handler must take it too.
- **Verify:** `(cd packages/app && npx vitest run src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts)`
  (the update script runs it). In the app, press F2 with focus in a message input, then in a
  terminal: the rename dialog opens for the focused agent.

## recent-workspaces: Recent workspaces section in the sidebar

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: Recent workspaces section in the sidebar`
- **Why:** See at a glance which workspaces Shift+Tab cycles through, and click into them without
  hunting through the projects.
- **What:**
  - A collapsible "Recent" section inside the Workspaces area, right under New workspace (below
    Pinned). Its header shows the Shift+Tab shortcut on the right, lined up with New workspace's
    Ctrl+N. It lists the same workspaces, in the same order, as
    [active-workspace-cycle](#active-workspace-cycle-shifttab-cycles-recently-active-workspaces):
    activity in the last 45 minutes, or an agent running. Absent when none qualify. Rechecks
    every 30 seconds so stale workspaces drop out.
  - Rows are the project-mode workspace rows (status on the left, menu, context menu), with the
    project's icon on the right where other rows show the time or the diff.
  - Shift+Tab highlights only the Recent copy while it is visible. Normal navigation restores
    ordinary selection highlighting; hiding/collapsing Recent or aging out restores the project
    highlight. A faint inset dashed divider separates Recent from the projects.
  - The rows stay in their projects too. Ctrl+1..9 skip the section: its rows have no number and
    the numbering is unchanged.
  - Works in project mode and in the status/label grouping modes. Collapsing is not remembered
    across restarts.
- **Files:** `packages/app/src/recent-workspaces/` (`section.tsx` the section and header,
  `trailing.tsx` the context that swaps the trailing slot for the project icon, `highlight.ts`
  transient cycle target and visible-row highlight policy), and
  `packages/app/src/active-workspace-cycle/use-recently-active-workspaces.ts` (the sidebar order,
  shared with the Shift+Tab handler, and the live recent set). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(recent-workspaces)`):
  - `packages/app/src/components/sidebar-workspace-list.tsx`: `SidebarWorkspaceList` builds the
    section with `MemoWorkspaceRowItem` rows (`shortcutNumber={null}`) and passes it to
    `ProjectModeList` (rendered right after `listHeaderComponent`) and `SidebarGroupedModeList`.
    `WorkspaceRowRightGroup` shows `RecentWorkspaceProjectIcon` in the trailing slot inside the
    section. `WorkspaceRowWithMenu` gives a section row its own archive handler id, since the
    dispatcher keys handlers by id and the same workspace also has a row in its project.
  - `packages/app/src/components/sidebar/sidebar-status-list.tsx`: `leadingSection` prop, rendered
    right after `listHeaderComponent`; its inner row applies the Recent highlight policy.
  - `packages/app/src/stores/navigation-active-workspace-store/index.ts`: records the transient
    Recent target for cycle navigation and clears it for ordinary navigation.
- **Re-apply:** Render `<RecentWorkspacesSection renderRow={...} projectIconByProjectViewKey={...}>`
  right after each list mode's `listHeaderComponent` (the Workspaces title and New workspace), with `renderRow` returning the project-mode
  workspace row with no shortcut number. In the row's trailing slot, when
  `useRecentWorkspaceProjectIcons()` is non-null, always render the slot and show
  `RecentWorkspaceProjectIcon` instead of the time/diff. Suffix the row's archive keyboard handler
  id inside the section. Pass `sidebarHighlight: "recent"` from the cycle handler; clear the
  highlight target on other workspace navigation. Apply the highlight policy only to the visual
  row renderers so archive actions retain the actual active selection. The section publishes its
  visible workspaces and clears them when collapsed or unmounted; keep the dashed divider inside
  the section so it disappears when Recent is hidden or empty.
- **Verify:** `(cd packages/app && npx vitest run src/active-workspace-cycle/model.test.ts)` covers
  the recent set (the update script runs it). In the app, send a prompt in two workspaces: both
  appear under "Recent" (below New workspace, Shift+Tab chip on the right) with their project icons on the right, Ctrl+1 still goes to
  the first workspace under the projects, and Shift+Tab alternates between the two with only the
  Recent copy highlighted. The same suite checks highlight fallback and host identity.

## sidebar-workspace-limit: each project shows its few newest workspaces

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: sidebar shows each project's newest workspaces`
- **Why:** Projects with many old workspaces push everything else out of the sidebar. The Recent
  section can also be noise, so it gets an off switch.
- **What:**
  - In project mode, a project shows a workspace only if it is younger than X hours (default 12)
    and among the project's N most recent (default 3). Both rules apply: five workspaces from the
    last 12 hours still show three. Age is the row's timestamp (`statusEnteredAt`). Pinned
    workspaces and the open workspace are never hidden and don't count toward N; a workspace
    with no timestamp is never hidden for its age.
  - A trimmed project ends with "> Show N more" (N is how many it hides) / "Show less", which
    shows every row (it replaces upstream's
    20-row Show more there). Expanded projects reset on restart. The label and chevron render
    at half size and 50% opacity, keeping the full click target so the control recedes when scanning.
  - Ctrl+1..9 number only the rows the sidebar shows.
  - Display preferences gains "Show Recent" (toggles the
    [Recent](#recent-workspaces-recent-workspaces-section-in-the-sidebar) section) and "Per
    project", a page with the count (3, 5, 10, All) and the age (6h, 12h, 24h, 3d, Any age).
    Stored in app storage (`custom-sidebar-workspace-limit`), not synced settings.
  - Status grouping mode is not limited.
- **Files:** `packages/app/src/sidebar-workspace-limit/` (`model.ts` the rule, `store.ts` the
  preferences, `use-sidebar-workspace-limit.ts` the live result with a minute tick, `context.ts`,
  `use-project-workspaces.ts` the per-project rows and toggle, `menu.tsx` the menu rows and page).
  New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(sidebar-workspace-limit)`):
  - `packages/app/src/components/sidebar/sidebar-model.tsx`: runs `useSidebarWorkspaceLimit`,
    passes `hiddenWorkspaceKeys` to the projection, and provides `SidebarWorkspaceLimitContext`.
  - `packages/app/src/components/sidebar/sidebar-projection.ts`: optional `hiddenWorkspaceKeys`
    input; project-mode shortcut sections skip those workspaces.
  - `packages/app/src/components/sidebar-workspace-list.tsx`: `ProjectBlock` feeds its rows
    through `useLimitedProjectWorkspaces` before `useLimitedSidebarGroup`, and its Show more row
    uses the limit's toggle when the limit trims the project.
  - `packages/app/src/components/sidebar/sidebar-group-toggle-row.tsx`: optional `hiddenCount`;
    set, the collapsed row shows a right chevron and "Show N more".
  - `packages/app/src/components/sidebar/display-preferences/menu.tsx`: the "Per project" page and
    `<SidebarWorkspaceLimitRootItems />` after the Show row.
  - `packages/app/src/recent-workspaces/section.tsx` (a custom file): returns null when Show
    Recent is off.
- **Re-apply:** In the sidebar model provider, compute the hidden keys from the filtered projects
  and entries (project mode only), filter project-mode shortcut sections by them, and provide the
  result through `SidebarWorkspaceLimitContext`. In the project block, filter `project.workspaces`
  by the hidden keys before the 20-row limiter and swap its toggle for the limit's when the
  project is limited. Add the menu rows and page. In the toggle row, when `hiddenCount` is
  supplied, halve the density font size and scale the chevron by 0.5; apply 0.5 opacity to both
  without shrinking the Pressable.
- **Verify:** `(cd packages/app && npx vitest run src/sidebar-workspace-limit/model.test.ts)` (the
  update script runs it). In the app, a project with many workspaces shows its three newest from
  the last 12 hours plus Show more; Ctrl+1..9 badges are consecutive; changing "Per project" or
  turning off "Show Recent" updates the sidebar at once. Check that Show more/less has half-size,
  faded text and chevrons while the full row remains clickable.

## new-workspace-terminal: Ctrl+J on the New Workspace screen

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: Ctrl+J opens a project terminal on the New Workspace screen`
- **Why:** [bottom-panel](#bottom-panel-ctrlj-toggles-a-bottom-panel) only works inside a
  workspace. On New Workspace you sometimes want a shell in the project first (pull, check a
  branch) without creating anything.
- **What:**
  - Ctrl+J (Cmd+J on macOS) on the New Workspace screen shows a panel under the form with a
    terminal in the selected project's folder and focuses it. Ctrl+J again hides it and returns
    the keyboard to the composer. Each visit to the screen starts with the panel hidden.
  - The daemon only runs a terminal inside a workspace, so the panel borrows the most recently
    active workspace whose folder is the project's folder (its main checkout). The terminal is
    a normal terminal of that workspace and shows up as a tab there too.
  - One terminal per folder, reused across visits while the daemon runs it (the memory is in
    the app, so it resets on restart). Typing `exit` hides the panel; the next Ctrl+J starts a
    new terminal. Changing the project shows that project's terminal.
  - No workspace in the folder (a project made only of worktrees): the panel says so.
  - Desktop and wide web only, same binding as the bottom panel.
- **Files:** `packages/app/src/screens/new-workspace/bottom-terminal.ts` (workspace pick, step
  logic, terminal memory) with `bottom-terminal.test.ts`, and `bottom-terminal-panel.tsx` (the
  panel and its Ctrl+J handler). New files; no conflict risk.
- **Core files touched** (marked `CUSTOM(new-workspace-terminal)`):
  - `packages/app/src/screens/new-workspace-screen.tsx`: renders
    `<NewWorkspaceBottomTerminal serverId={selectedServerId} cwd={selectedSourceDirectory} />`
    after the `content` view, inside `FileDropZone`.
- **Re-apply:** Render the panel at the bottom of the New Workspace screen's root column with the
  selected host and the project's source directory. It registers its own handler for
  `workspace.bottom-panel.toggle`, active only while the screen is on top.
- **Verify:** `(cd packages/app && npx vitest run src/screens/new-workspace/bottom-terminal.test.ts)`
  (the update script runs it). In the app, open New Workspace, press Ctrl+J three times: a
  terminal in the project's folder appears, hides, and comes back with the same shell.

## empty-composer-shortcuts: project cycling and message rewind

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Choose a project and reach rewind actions directly from an empty composer.
- **What:** Left cycles projects backwards with wraparound on New Workspace. In an ongoing
  chat, Up selects the latest sent message and scrolls it into view; more Up presses walk to
  older sent messages and Down walks back. A quiet accent ring marks the selected message. Enter
  opens its existing rewind menu. Esc, Down past the latest, or closing that menu clears the
  selection, jumps the transcript to the bottom, and focuses the composer. Escape or typing clears selection. Modified keys and autocomplete retain priority.
  Web and desktop placeholders show the appropriate hints, translated in every supported locale.
- **Core files touched:** `screens/new-workspace-screen.tsx`, `composer/index.tsx`,
  `composer/input/input.tsx`, `agent-stream/view.tsx`, `components/message.tsx`,
  `components/rewind/rewind-menu.tsx`, `components/ui/menu/menu-overlay.tsx`, and `i18n/resources/*.ts` under `packages/app/src/`.
- **Re-apply:** Forward an optional key callback through Composer after autocomplete. New
  Workspace uses the existing project selection callback. Running chat composers select from
  stream tail/head through `composer/empty-shortcuts.ts`; the transcript observes that selection
  to scroll, highlight the message (`bubbleKeyboardSelected`; web needs `outlineStyle` or the ring
  is invisible), and open RewindMenu on Enter. Scroll on a change of message only, not when
  the menu opens. In `components/ui/menu/menu-overlay.tsx`, the focus-first-item effect retries
  each frame until the item takes focus: Reanimated's web entering animation keeps the surface
  `visibility: hidden` for a few frames, and without the retry a menu opened from the keyboard
  loses focus and its arrow keys. Leaving the selection bumps `bottomRequest`, which
  the transcript answers with its scroll-to-bottom. Keep IME and modified keys out
  of the shortcut path. Add translated placeholder hints and the focused test to the update script.
- **Verify:** `cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts --bail=1`.
  In desktop, cycle past the first project with an empty prompt; type text and verify Left edits
  normally. In an ongoing chat, press Up a few times and Down back, then Enter; arrow keys move
  through the rewind options and Esc returns to the composer. Verify rewind options appear without
  executing a rewind; dismiss with Escape and verify typing resumes normally.

## composer-project-icon: identify the project beside context usage

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Recognize the current project directly in the chat composer.
- **What:** The ongoing chat toolbar shows the project's icon immediately before the context
  meter, with its name in a tooltip. It uses the sidebar's project identity, image cache, and
  colored-initial fallback. Worktrees use their parent project's icon; host-local project IDs
  are matched together with the host. Uploaded and discovered icon revisions remain live.
- **Core files touched:** `packages/app/src/composer/index.tsx` (marked
  `CUSTOM(composer-project-icon)`). New implementation files live alongside it in
  `project-icon.tsx`, `project-icon-model.ts`, and `project-icon-model.test.ts`.
- **Re-apply:** Render `ComposerProjectIcon` beside `ContextWindowMeter` in a horizontal group
  in `beforeVoiceContent`. Pass the composer host, agent, workspace, and meter glyph size.
  Resolve the workspace's project ID through session state and the canonical host project list;
  reuse `useProjectIcons` and `ProjectIconView` instead of looking up the worktree directory.
- **Verify:** `cd packages/app && npx vitest run src/composer/project-icon-model.test.ts --bail=1`
  (included in the update script). Open chats in two projects and a worktree: the icon follows
  the project, hovering reveals its name, and context usage still opens normally. Check a
  project with an uploaded icon and one using the colored initial.

## composer-branch-hint: current branch before the composer's project icon

- **Added:** 2026-11-02
- **Commit:** see `git log --grep "branch name beside"`
- **Why:** See which branch an agent works on without opening the workspace header or sidebar.
- **What:** Before the composer's project icon (see
  [composer-project-icon](#composer-project-icon-identify-the-project-beside-context-usage)), a
  small muted text shows the workspace's current git branch, truncated at 160 px. Hidden for a
  non-git folder or a detached HEAD. The favorites star in the project menu became a compact
  `ToolbarButton` (the `no-raw-pressable` lint rule blocked commits on this file).
- **Core files touched:** none beyond the composer-project-icon files: `composer/project-icon.tsx`
  and `composer/project-icon-model.ts` (marked `CUSTOM(composer-branch-hint)`).
- **Re-apply:** In `ComposerProjectIcon`, read `gitRuntime.currentBranch` of the resolved
  workspace from the session store, pass it through `normalizeBranchHint`, and render it as a
  one-line `Text` before the icon (both the tooltip and the menu variants), in a fragment so it
  sits in the same `projectContextIndicators` row.
- **Verify:** `cd packages/app && npx vitest run src/composer/project-icon-model.test.ts --bail=1`
  (already in the update script). Open a chat in a worktree: the branch shows before the icon and
  changes after `git switch`.

## empty-composer-voice: double Enter or double-click starts voice mode

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Start voice mode without reaching for the mic button.
- **What:** In a chat composer with no text and no attachments, pressing Enter twice within
  400 ms, or double-clicking the input, starts realtime voice mode for that agent. A single
  Enter on an empty composer does nothing, as before. Modified keys, autocomplete, and the
  rewind selection (Up then Enter) keep priority. Web and desktop only; native has no hardware
  Enter or double-click.
- **Core files touched:** `packages/app/src/composer/index.tsx` (marked
  `CUSTOM(empty-composer-voice)`). The timing logic is in `composer/empty-voice-trigger.ts`
  with `empty-voice-trigger.test.ts`.
- **Re-apply:** In the composer's key handler, after autocomplete and the rewind handler,
  intercept a plain Enter when the text is empty and feed it to a `createDoubleTrigger`; on the
  second hit call the same handler as the voice-mode button. Gate it on the voice button's
  conditions (voice shown, agent present, connected, not already in voice mode, no command
  draft, no attachments). Add a web-only `dblclick` listener on the input's native element with
  the same gate.
- **Verify:** `cd packages/app && npx vitest run src/composer/empty-voice-trigger.test.ts --bail=1`
  (included in the update script). In desktop, open a chat with an empty composer: press Enter
  twice quickly and voice mode starts; double-click the empty input and voice mode starts. Type
  text and verify Enter sends and double-click selects a word.

## voice-exit: leave voice mode without stopping the agent

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Leaving voice mode stopped the agent, and entering it while the agent worked was
  refused. Both reloaded the agent to swap the voice instructions, and a reload cancels the run.
- **What:**
  - The voice overlay has an X beside the stop button: it leaves voice mode and the agent keeps
    working. Esc exits before shortcut resolution, including when interrupt is bound to Esc Esc;
    the same key still advances that chord so the second Esc interrupts. The stop button still
    leaves and interrupts.
  - The voice-mode button shows while the agent works, and entering voice mode doesn't
    interrupt it.
  - Daemon: while the agent runs, the system prompt change waits and applies once the run ends,
    polled every second, one pending change per agent across sessions. Going back into voice
    mode before a deferred exit applied cancels it with no reload.
  - The speak tool, called after the user left voice mode, tells the agent to reply in text.
- **Core files touched:** server `session/voice/voice-session.ts` (`pendingPromptUpdates`,
  `updateSystemPromptWhenIdle`, enable/disable paths), `agent/tools/paseo-tools.ts` (speak error
  text; `agent/mcp-server.test.ts` expects it). App `components/realtime-voice-overlay.tsx`
  (`onExit`), `composer/input/input.tsx` (`handleRealtimeVoiceExit`, no "interrupt first"
  toast), `composer/index.tsx` (`exitVoiceMode` in the `agent.interrupt` dispatch, voice button
  no longer gated on `!isAgentRunning`), `hooks/use-keyboard-shortcuts.ts`,
  `keyboard/keyboard-action-dispatcher.ts`, `keyboard/voice-escape.ts`. String `settings.voiceSettings.voiceMode.exit`.
- **Re-apply:** In the voice session, before calling `reloadAgentSession` for a voice prompt
  change, check `host.hasActiveAgentRun`; if running, keep the change pending and apply it when
  the run ends. Add the overlay X calling `voice.stopVoice()` only, and make the composer's
  `agent.interrupt` handler leave voice mode first when it is on for that agent. Dispatch the
  dedicated voice-exit action before resolving Esc shortcuts, preserving chord advancement but
  suppressing any interrupt on that first keypress.
- **Verify:** `npx vitest run src/server/session/voice/voice-session.test.ts --bail=1` (server),
  in the update script. In the app, ask for a long task in voice mode, press Esc: voice mode
  ends, the agent keeps going; Esc again interrupts it.

## voice-new-agent: voice mode from New agent and New workspace

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Those screens have no agent yet, so only dictation showed.
- **What:** The composer takes `onStartVoice`; with no agent it shows the voice-mode button and
  calls it. The New agent tab creates the agent from what is typed (or nothing, so it starts
  idle) and starts voice mode when creation succeeds. Empty starts do not add a pending message;
  voice-start errors appear as a toast. Codex persistence records whether a turn has started:
  untouched threads are recreated on reload because Codex has not saved a resumable rollout yet.
  New workspace creates the workspace with
  its agent the same way and hands `startVoice` to the draft tab through the pending submission.
- **Core files touched:** app `composer/index.tsx` (`onStartVoice`), `composer/draft/workspace-tab.tsx`,
  `screens/new-workspace-screen.tsx` (`useNewWorkspaceVoiceStart`, `startVoice` on the chat
  path), `stores/workspace-draft-submission-store.ts` (`startVoice`),
  `composer/submission/writer.ts`; server `agent/providers/codex-app-server-agent.ts`.
- **Re-apply:** Find where each screen creates its first agent and the success callback that
  receives the agent snapshot; call `voice.startVoice(serverId, agent.id)` there when the
  creation came from the voice button. Allow an empty first message for that creation, without
  registering a message acknowledgement. Preserve `hasStartedTurn` in Codex handle metadata:
  try resume first, and recreate only an explicitly false handle rejected with "no rollout found".
  This preserves history when a saved handle predates its first accepted turn.
- **Verify:** `src/keyboard/voice-escape.test.ts`, `src/composer/submission/writer.test.ts` (app),
  `src/server/agent/providers/codex-app-server-agent.test.ts` (server), in the update script.
  In the app, open New agent, press the voice button: an agent appears and voice
  mode starts. Same from New workspace.

## local-speech-gpu: local speech recognition and synthesis on the GPU

- **Added:** 2026-10-13
- **Commit:** a040c449d
- **Why:** Voice mode on the CPU costs ~1.9 s of Kokoro synthesis per sentence and re-decodes
  the whole utterance on 2 CPU threads every 350 ms. On an RTX 4070 Ti SUPER the same work
  takes ~100 ms (TTS) and ~15 ms (STT) with almost no CPU. RAM does not drop: ONNX Runtime
  keeps a host copy of the weights, and the worker sits around 2 GB plus ~1-3.5 GB of VRAM.
- **What:** With GPU selected (Settings > Bruno's Customizations > Voice, stored as
  `providers.local.executionProvider: "cuda"`), the worker client forks the local speech
  worker with sherpa-onnx's CUDA build ahead of the CPU-only npm package on
  `LD_LIBRARY_PATH` and runs Parakeet and Kokoro on the `cuda` provider. The build lives in
  `~/.local/share/paseo-cuda/lib` (`PASEO_LOCAL_SPEECH_CUDA_DIR` or
  `providers.local.cudaLibDir` override it); when it is missing or doesn't match the bundled
  sherpa-onnx version, the worker stays on the CPU and Settings says why. Silero VAD stays on
  the CPU: per-window GPU launches cost ~8x more CPU than running it there. Adds the
  `parakeet-tdt-0.6b-v2-fp16` model (int8 kernels have no CUDA implementation, so int8 models
  stay on the CPU under CUDA). On CUDA the worker picks `encoder.fp16-cuda.onnx` when present:
  `custom/local-speech-gpu/patch-parakeet-encoder-for-cuda.py` fixes two fp16 bugs that only
  show on CUDA (its docstring has the details). Under CUDA the worker turns SIGTERM into
  SIGKILL, because Node's SIGTERM teardown deadlocks once the CUDA runtime is loaded and
  leaves a hung worker holding VRAM.
- **Setup:** `custom/local-speech-gpu/setup.sh [paseo-home ...]` installs the CUDA 12 runtime
  and cuDNN 9 as pip wheels under `~/.local/share/paseo-cuda` (no sudo, no driver changes),
  downloads the matching sherpa-onnx CUDA build, downloads the fp16 model, and patches the
  encoder. Then turn on "Use the GPU" in Settings. Rerun `setup.sh` when upstream bumps
  `sherpa-onnx-node`; the update script warns when the versions differ.
- **Core files touched:** in `packages/server/src/server/speech/providers/local/`:
  `worker-process.ts` (provider, SIGTERM), `worker-client.ts` (fork env, spawn log),
  `runtime.ts` (CPU fallback), `sherpa/model-catalog.ts` (fp16 entry),
  `sherpa/sherpa-offline-recognizer.ts` and `sherpa/sherpa-tts.ts` (provider option instead
  of hardcoded `"cpu"`). Logic lives in `local-speech-gpu.ts` and `model-files.ts`, with tests.
- **Re-apply:** Give the recognizer and TTS configs a `provider` field passed to sherpa's
  model config. The worker reads its provider from the env the client sets
  (`applyLocalSpeechWorkerEnv`, called right after `applySherpaLoaderEnv` when forking),
  passes it to both, and adds the SIGTERM handler under CUDA. `runtime.ts` resolves the
  requested provider against `checkCudaAvailability` before creating the worker client.
- **Verify:** `cd packages/server && npx vitest run src/server/speech/providers/local/local-speech-gpu.test.ts src/server/speech/providers/local/model-files.test.ts --bail=1`
  (included in the update script). Turn on "Use the GPU", use voice mode once, and the
  Status section shows "Running on GPU" with VRAM in use.

## voice-settings: Settings > Voice and dictation

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Speech settings lived only in `config.json` and env vars, needed a daemon restart,
  and nothing showed whether the voice worker was running or what it cost.
- **What:** A host settings page with:
  - Turn on: the Dictation and Voice mode switches from upstream's Voice page (patched as
    `features.dictation.enabled` / `features.voiceMode.enabled`). This page replaces upstream's
    on the same slug, and since 0.14 voice mode is off by default, so without them the status
    said "Turn it on in Settings > Voice" with no way to do it.
  - Status, refreshed every 2 s: engine state, worker PID and uptime, RAM, VRAM and CPU of the
    worker, the GPU's memory and load (`nvidia-smi`), loaded models, dictation and voice
    readiness, model downloads.
  - Engine: CPU/GPU switch (see local-speech-gpu).
  - Models: dictation, voice-mode listening and voice-mode speaking pickers over the catalog
    (now with Parakeet v3, 25 languages, and Kokoro v1.0 multi-language, 54 voices including
    Brazilian Portuguese) plus folders the user registers ("Add a model folder"; Electron with
    the local daemon gets a folder picker, other clients type a host path). A missing catalog
    model downloads in the background when picked. Folders are detected as NeMo transducer
    (Parakeet) or Kokoro by their files.
  - Voice: speaker (names and languages from the catalog), speed, and a preview played through
    the app's audio engine.
  - Voice mode instructions: edit or restore the built-in text the agent gets when voice mode
    turns on (`features.voiceMode.instructions`).
  - Thinking tone, per device: Off/Low/Medium/High, a sound picked from a file (web and
    desktop; decoded to the tone's PCM16 16 kHz format and capped at 10 s) and the silence
    between plays (default 10 s).
  - Microphone, per device on web and desktop: the browser's echo cancellation, noise
    suppression and automatic gain for voice mode's capture. Changing one reopens the mic in a
    running session. Bluetooth speakers with a mic, speakerphones and headsets cancel echo
    themselves (the LG XG5S mutes its mic while it plays). The browser's echo canceller on top
    of that removed the user's voice while the agent talked, so barge-in never fired even
    though the raw mic had over a second of clear speech.
  - Faster barge-in: while a spoken reply plays, Silero confirms speech after 300 ms instead
    of 800 ms, so one "stop" interrupts. The voice session flags the detector around
    `generateAndWaitForPlayback` (`setAssistantSpeaking`, forwarded to the worker as
    `session.assistant_speaking`). The turn controller also amplifies what the detector hears
    4x during a reply (not what STT hears), because a speakerphone ducks its mic while it plays.
  - Logs: recent speech lines from the daemon log (JSON or the dev daemon's pretty format).
    Changes apply live: the settings ride on the daemon config patch (`MutableDaemonConfig.speech`),
    and a `speech` field-change handler in `bootstrap.ts` re-resolves the speech config and calls
    `speechService.reconfigure()`, which swaps in a new worker client. Settings an env var
    controls show as locked. Multi-language Kokoro needs an espeak-ng `lang` (or a lexicon) or
    the native code aborts the process; the worker derives it from the voice name's first letter.
- **Core files touched:** protocol: `messages.ts` (import, `speech` on the mutable config and
  patch, three RPCs in the unions, `speechSettings` feature flag); schemas in
  `speech-settings.ts`. Server: `persisted-config.ts`, `daemon-config-store.ts`,
  `bootstrap.ts`, `session.ts` (handler, cases in `dispatchMiscMessage`), `websocket-server.ts`,
  `voice-config.ts`, `session/voice/voice-session.ts`, `authorization/operation-permissions.ts`,
  `speech/speech-runtime.ts` (`reconfigure`, `getLocalStatus`, `previewVoice`),
  `speech/speech-config-resolver.ts`, `speech/providers/local/{config,runtime,worker-*}.ts`,
  `sherpa/sherpa-tts.ts`, `sherpa/silero-vad-session.ts`, `speech/turn-detection-provider.ts`,
  `session/voice/voice-turn-controller.ts`; new `speech/speech-settings-service.ts`,
  `speech/providers/local/model-files.ts`. Client: `daemon-client.ts` (three methods). App:
  `settings-screen.tsx`, `utils/host-routes.ts`, `voice/voice-runtime.ts`,
  `contexts/voice-context.tsx`, each locale file (import + two keys); new
  `audio/audio-engine.web.ts` (capture constraints from the store, reopen on change); new
  `screens/settings/voice/`, `voice/thinking-tone-settings.ts`, `voice/microphone-settings.ts`,
  `i18n/resources/custom-voice-settings.ts`.
- **Re-apply:** Re-add the `speech` field and the three `speech.local.*` RPCs to the protocol
  unions and permission maps. In the config store, map `speech` to `features.dictation`,
  `features.voiceMode` and `providers.local` (reloadable paths and the persisted merge). Keep
  `SpeechService.reconfigure` validating before it mutates, because the store's rollback calls
  the field handler again with the old value. Register the host page slug `voice` with its
  sidebar item and render case.
- **Verify:** Server: `npx vitest run src/server/speech src/server/daemon-config-store.test.ts src/server/voice-config.test.ts src/server/speech/providers/local/sherpa/silero-vad-session.test.ts --bail=1`.
  App: `npx vitest run src/screens/settings/voice src/voice/thinking-tone-settings.test.ts src/i18n --bail=1`.
  Both are in the update script. In the app, open Settings > Bruno's Customizations > Voice: the
  status fills in; switch a model and the status shows the download or the new model loaded
  after the next use; Preview plays the selected voice.

## dictation-tuning: Settings > Voice and dictation > Dictation tuning

- **Added:** 2026-11-07
- **Commit:** `custom: dictation tuning settings in Voice and dictation`
- **Why:** The local dictation model (Parakeet) is offline: Paseo re-transcribes the whole open
  segment every 350 ms and closes a segment every 15 s, so the text keeps rewriting itself. Those
  numbers lived in env vars or were hardcoded, and nothing explained them.
- **What:** A Dictation tuning section under Models with the effective values and an info tip
  on each row:
  - Close segment after (`autoCommitSeconds`, default 15 s, Off = one segment).
  - Transcribe again every (`decodeIntervalMs`, default 350 ms; was hardcoded).
  - Silence threshold (`silencePeakThreshold`, PCM16 peak, default 300).
  - Transcription prompt (OpenAI only; empty = built-in).
  - Support: the daemon reports which fields the dictation provider reads
    (`status.dictationTuning`). Local models ignore the prompt; OpenAI sends no partial text,
    so it ignores the interval. Unsupported rows are dimmed and locked with "<model> doesn't
    use this setting". A row an env var sets is locked like the other host settings
    (`PASEO_DICTATION_AUTO_COMMIT_SECONDS`, `PASEO_DICTATION_DECODE_INTERVAL_MS`,
    `PASEO_DICTATION_SILENCE_PEAK_THRESHOLD`, `PASEO_DICTATION_TRANSCRIPTION_PROMPT`).
  - Values persist in `features.dictation.tuning` and apply from the next dictation, without a
    restart. Only en and pt-BR are translated; the other locales reuse the English strings.
- **Core files touched:** protocol: `speech-settings.ts` (four optional fields on the mutable
  speech config, optional `dictationTuning` on the status). Server: `persisted-config.ts`
  (`features.dictation.tuning`), `speech/speech-config-resolver.ts`, `bootstrap.ts`
  (`PaseoSpeechConfig.dictationTuning`, effective values in `buildMutableSpeechConfig`),
  `daemon-config-store.ts` (`mergeDictationTuningPatch`), `speech/speech-runtime.ts`
  (`resolveDictationTuning`), `websocket-server.ts`, `session.ts`, `session/voice/voice-session.ts`
  (pass the resolver), `dictation/dictation-stream-manager.ts` (reads it at each start; the
  module-level env reads are gone), `speech/speech-provider.ts` (`decodeIntervalMs` on
  `createSession`), `speech/providers/local/worker-{protocol,client,process}.ts` (forward it to
  `SherpaParakeetRealtimeTranscriptionSession`), `speech/speech-settings-service.ts`; new
  `speech/dictation-tuning.ts`. App: `voice-settings-page.tsx` (one line),
  `i18n/resources/custom-voice-settings.ts`; new `screens/settings/voice/dictation-tuning-*.ts(x)`.
- **Re-apply:** Keep `speech/dictation-tuning.ts` as the one place for defaults, env names and
  the support matrix. Thread a `tuning` resolver from the speech service to
  `DictationStreamManager` next to the dictation STT resolver, and read it in `handleStart`, not
  in the constructor, so Settings changes reach the next dictation. The decode interval rides
  on `createSession` and the worker's `session.create` message. Render
  `<DictationTuningSection>` after `ModelsSection`.
- **Verify:** `cd packages/server && npx vitest run src/server/speech/dictation-tuning.test.ts src/server/dictation/dictation-stream-manager.test.ts src/server/daemon-config-store.test.ts --bail=1`
  and `cd packages/app && npx vitest run src/screens/settings/voice/dictation-tuning-model.test.ts --bail=1`
  (both in the update script). Needs a daemon restart. In Settings > host > Voice and
  dictation, Dictation tuning shows 15 s, 350 ms and 300 with Parakeet, and the prompt row dimmed.
  Set "Transcribe again every" to 1000 ms and dictate: the text updates about once a second.

## voice-speak-eager: the first spoken reply skips tool search

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** Claude Code defers MCP tools behind tool search, so the first reply after entering
  voice mode always ran `ToolSearch select:mcp__paseo__speak` before `speak`: one extra model
  round trip, 1.5-2 s in the user's transcripts. Entering voice mode reloads the agent, so it
  happened every time. Loading the whole Paseo server eagerly (`alwaysLoad` on the server)
  would put ~60 tool schemas in every agent's context instead.
- **What:** `speak` is listed with `_meta: { "anthropic/alwaysLoad": true }`, which Claude Code
  reads per tool. Only agents in voice mode get `speak`, so other agents are unchanged. Other
  providers ignore `_meta`. A conversation that started before voice mode keeps `speak` in its
  deferred-tools list, but Claude Code also sends the full definition with it
  (`surfacedNames`/`surfacedDefinitions` on the `deferred_tools_delta` attachment in the session
  JSONL), so the model calls it without ToolSearch. Without the flag only the name was sent.
- **Core files touched:** server `agent/tools/types.ts` (`alwaysLoad` on `PaseoToolConfig`),
  `agent/tools/paseo-tools.ts` (`registerTool` copies it; `speak` sets it),
  `agent/mcp-server.ts` (maps it to `_meta`).
- **Re-apply:** Where the MCP server registers each catalog tool, pass
  `_meta: { "anthropic/alwaysLoad": true }` for `speak`.
- **Verify:** `cd packages/server && npx vitest run src/server/agent/mcp-server.test.ts -t "speak MCP tool" --bail=1`
  (in the update script). In voice mode, the first reply's tool calls start with Speak, with
  no Toolsearch row before it.

## voice-reply-mute: the ear button silences the agent's voice

- **Added:** 2026-10-13
- **Commit:** pending
- **Why:** To stop listening to a long spoken reply without leaving voice mode or interrupting
  the agent.
- **What:** The voice overlay has an ear button after the mic. Pressing it cuts the sentence
  playing and silences every reply after it; the agent keeps working and its speak calls
  return as usual (the app confirms the skipped audio without playing it), so the text still
  shows in the chat. Pressing it again turns the voice back on from the agent's next message:
  the rest of a message that was muted stays silent. The mic and the thinking tone are not
  affected. Each voice session starts unmuted.
  The daemon tags each `audio_output` with `utteranceId`, one per `speak` call (`groupId` is
  one sentence of it), so the app can tell where the next message starts.
- **Core files touched:** protocol `messages.ts` (optional `utteranceId` on `audio_output`).
  Server `agent/tts-manager.ts` (one `utteranceId` per `generateAndWaitForPlayback`). App
  `voice/voice-runtime.ts` (`isReplyMuted`, `toggleReplyMute`, `mutedUtteranceIds`, quiet
  play error when muted), `contexts/voice-context.tsx`, `composer/input/input.tsx`,
  `components/realtime-voice-overlay.tsx` (`Ear`/`EarOff`). Strings
  `settings.voiceSettings.voiceMode.muteReplies` and `unmuteReplies`.
- **Re-apply:** In the runtime, a new playback group gets `shouldPlay = false` when replies are
  muted or its `utteranceId` was muted; muting also flips `shouldPlay` on the queued groups and
  calls `engine.stop()` if one was playing (the queue loop then confirms the chunk). Add the
  ear button to the overlay beside the mic button.
- **Verify:** `cd packages/app && npx vitest run src/voice/voice-runtime.test.ts --bail=1` and
  `cd packages/server && npx vitest run src/server/agent/tts-manager.test.ts --bail=1` (both in
  the update script). In voice mode, ask for a long answer, press the ear: the voice stops, the
  chat keeps filling. Press it again while it still answers: silence until its next message.

## wake-dictation: copy hands-free dictation from the desktop sidebar

- **Added:** 2026-10-15
- **Commit:** `custom: wake dictation sidebar proof of concept`
- **Why:** Try a wake phrase and clipboard flow while the desktop window is open, before adding a
  background process or a dedicated keyword model.
- **What:** The desktop sidebar gets a Wake dictation control above Workspaces. Gray means off,
  yellow waits for "wake up", and green captures speech. After a spoken "done" at the end of a
  phrase, the assembled transcript is copied and the control returns to yellow. The listener
  uses energy-bounded utterances and the existing dictation STT service, so only speech segments
  are uploaded. It stops when Paseo closes, the local host disconnects, or voice mode starts.
- **Core files touched:** app `components/left-sidebar.tsx` (desktop row); new
  `always-listening/sidebar-toggle` files. The base toggle renders nothing outside Electron. The
  wake phrase and "done" logic, `WakeDictationController`, lives in
  `packages/client/src/wake-dictation.ts` (export `@getpaseo/client/wake-dictation`) since
  cli-dictation moved it there to share it with `paseo speech wake`. "done" ends the dictation
  anywhere in an utterance ("four, done, five" copies up to "four"), unless the word before it
  makes it part of a sentence ("I'm done", "get it done"; `SENTENCE_BEFORE_DONE`). Parakeet's
  punctuation around a spoken "done" varies (`4, done, 5`, `4, done 5`, `1234 done 5678`), so the
  rule ignores punctuation.
- **Re-apply:** Place `WakeDictationSidebarToggle` below the desktop `SidebarNavRows` and before
  the workspace list. Its Electron implementation captures PCM with the existing dictation audio
  source, sends each energy-bounded utterance through `DictationStreamSender`, detects "wake up"
  and final "done" in transcription text, and copies with `copyToClipboard`. Keep the base
  component empty for browser and native builds.
- **Verify:** `cd packages/client && npx vitest run src/wake-dictation.test.ts --bail=1`
  (in the update script). In desktop Paseo, switch it on: yellow appears. Say "wake up" and
  pause: it turns green. Dictate, then say "done" and pause: the text goes to the clipboard and
  the control returns to yellow. Switch it off and confirm microphone capture ends.

## sidebar-voice: an independent voice session above Workspaces

- **Added:** 2026-10-15
- **Commit:** `custom: add independent sidebar voice session`
- **Why:** Voice needs a permanent entry below Accounts, with its own conversation that continues
  while you browse other workspaces and tabs.
- **What:** Voice appears after the sidebar navigation rows on desktop and mobile. Start creates
  or resumes a labeled assistant in a background workspace under `~/.paseo-voice`, using the
  saved provider/model preference on first creation. The row shows status, microphone and reply
  mute controls, exit, interrupt, and a link to its conversation. Navigation and sidebar unmounts
  do not stop it. First Esc exits; a second within the shortcut chord window interrupts that
  assistant, even when a different chat or terminal has focus. Startup errors remain in the row
  with Retry. Microphone capture is never started automatically on app launch.
- **Core files touched:** `packages/app/src/app/_layout.tsx`,
  `components/sidebar/sidebar-nav-rows.tsx`, `keyboard/keyboard-shortcuts.ts`;
  implementation and lifecycle tests in `voice/sidebar/`, browser coverage in
  `e2e/browser/sidebar-workspace.spec.ts`.
- **Re-apply:** Mount `SidebarVoiceProvider` inside the global `VoiceProvider`, above route content.
  Add `SidebarVoiceRow` after the navigation items in their shared sidebar group. Keep the agent
  lookup label `custom.sidebar-voice=true` and background-workspace ownership separate from the
  selected workspace. Register Escape handling above composer priority, preserving the voice
  target through the second keypress. Share the keyboard chord timeout.
- **Verify:** `cd packages/app && npx vitest run src/voice/sidebar/session.test.ts --bail=1`
  (included in the update script). Targeted browser check:
  `npx playwright test e2e/browser/sidebar-workspace.spec.ts --project=browser --grep 'sidebar voice has' --workers=1`.
  In desktop, start Voice, switch workspace and tab, and check that listening continues and
  double Esc interrupts the Voice assistant rather than the selected chat.

## sidebar-shortcut-settings: direct access and forgiving shortcut search

- **Added:** 2026-10-15
- **Commit:** `custom: add shortcut search and sidebar access`
- **Why:** Frequent shortcut edits need direct access and forgiving lookup from the workspace.
- **What:** A keyboard icon between Help and Settings opens Settings → Shortcuts. It follows
  the existing shortcut editor availability rule (desktop only). A search field above the bindings
  filters by name, section, notes, and current keys. It ignores case and accents, accepts partial
  words and words in any order, treats `*` as a gap, and tolerates missing letters and small typos.
  Clear restores every row; editing and Reset all remain available while filtering.
- **Core files touched:** `packages/app/src/components/left-sidebar.tsx`,
  `screens/settings/keyboard-shortcuts-section.tsx`, and `keyboard/shortcut-help-search.ts` (app).
  Tests extend `shortcut-help-search.test.ts` and desktop `e2e/keyboard-shortcut-unassign.spec.ts`.
- **Re-apply:** Add a `FooterIconButton` with the Keyboard icon immediately after `SidebarHelpMenu`.
  Use the existing shortcuts label, Electron gate, and `buildSettingsSectionRoute("shortcuts")`.
  Add the shared SearchField above shortcut settings; filter effective bindings with the shared
  help filter in loose mode, using the protocol text matcher per term. Keep default help-dialog
  matching unchanged and Reset all outside the filtered sections.
- **Verify:** `npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/keyboard-shortcut-unassign.spec.ts --grep 'sidebar shortcut settings|shortcut settings search' --workers=1`
  and `cd packages/app && npx vitest run src/keyboard/shortcut-help-search.test.ts --bail=1`
  (both included in the update script). Check placement, navigation, filtering, clearing, and row actions.

## open-file-externally: open file tabs in the system browser or default app

- **Added:** 2026-10-15
- **Commit:** `custom: open file tabs in the system browser or default app`
- **Why:** Open local HTML reports and other files directly from their tab menu.
- **What:** Adds “Open in browser” and “Open with default app” after “Copy file path”.
  Paths resolve against the workspace directory. Actions appear only for the local desktop host.
  Browser mode selects the HTTPS handler (Linux desktop entry, macOS/Windows application);
  default mode uses Electron's OS file association, equivalent to a terminal opener command.
- **Core files touched:** `packages/app/src/screens/workspace/workspace-tab-menu.ts`,
  `workspace-screen.tsx`, `workspace-desktop-tabs-row.tsx`, `explorer-sidebar.tsx`,
  `compact-workspace-header/tab-switcher.tsx`, `packages/app/src/components/split-container.tsx`,
  `packages/app/src/desktop/host.ts`, `packages/desktop/src/preload.ts`,
  `packages/desktop/src/main.ts`; tests in `workspace-tab-menu.test.ts` and desktop `features/opener.test.ts`.
  New desktop module: `packages/desktop/src/features/file-opener.ts`.
- **Re-apply:** Add an optional file-opening callback alongside the copy-path callback through
  the split container and both tab menus. Resolve paths and catch launch errors in the workspace.
  Expose separate file-opening preload/IPC plumbing; preserve the existing HTTP(S)-only URL opener.
  Route browser launches to the registered HTTPS application and default launches to `shell.openPath`.
- **Verify:** App `src/screens/workspace/workspace-tab-menu.test.ts` and desktop
  `src/features/opener.test.ts`. Right-click a local HTML tab, check both entries after the copy
  actions, and verify each opens the original file with relative assets intact.

## compact-desktop-enter: Enter sends in narrow desktop windows

- **Added:** 2026-10-15
- **Commit:** `custom: preserve Enter to send in compact desktop windows`
- **Why:** Resizing Electron below the compact breakpoint made Enter insert a newline.
- **What:** Electron keeps Enter to send at every width. Shift+Enter and mobile behavior stay unchanged.
- **Core files touched:** `packages/app/src/composer/input/input.tsx`, `state.ts`, and `state.test.ts`.
- **Re-apply:** Resolve the composer's submit-on-Enter policy from both platform and layout:
  enable it on web when Electron is running or the layout is wide. Keep the existing Shift+Enter guard.
- **Verify:** `npx vitest run packages/app/src/composer/input/state.test.ts --bail=1`.
  Resize a desktop chat below the compact breakpoint: Enter sends, Shift+Enter inserts a newline.

## task-navigation: switch between workspace and task sidebars

- **Added:** 2026-10-15 (upstream 0.11.2)
- **Commit:** `custom: add optional task navigation alongside workspace sidebar`
- **Why:** Navigating several projects by workspace groups obscures which conversations have
  finished or need input. Keep the workspace layout available while refining a task-first view.
- **What:** A **Tasks** switch immediately after the header shortcut hints selects a global task
  sidebar. The choice persists locally and defaults off. Search and project/status filters span
  visible workspaces and hosts. **Your attention** separates blocked/failed tasks from unread
  finished responses; **In progress** and **Idle** show the rest. A row's second line shows the
  project, plus the host when it is remote, and not the workspace name: a workspace keeps the title
  of its first prompt, so every task in it repeated the same text. Managed children stay under
  their parent across workspaces. Selecting a task uses existing agent navigation and attention
  clearing. The **desks** customization below extends this mode with independent tab sets and
  replaces the original single-project filter and Browse workspaces footer.
- **Files:** `packages/app/src/task-navigation/` owns the projection, view, switch, and independent
  persisted preference. Its collection subscription excludes timelines and streamed text.
- **Core files touched:** `packages/app/src/components/left-sidebar.tsx` wraps each existing list
  with the mode boundary; `packages/app/src/components/sidebar/sidebar-model.tsx` exposes the
  workspace collection before project/label facets; `packages/app/src/header-shortcuts/layout.tsx`
  inserts the switch inside the measured button group so shortcut fitting reserves its width.
- **Re-apply:** Keep the original workspace list as the mode boundary's children, for both compact
  and wide sidebars. Add `TaskNavigationToggle` as the first measured header button after the
  shortcut strip. Reuse the host-scoped workspace collection before project/label facets and the app
  navigation owner; do not add routing, attention-clearing, or panel lifecycle logic to the view.
- **Verify:** Run `npx vitest run src/task-navigation/model.test.ts src/task-navigation/store.test.ts --bail=1` from `packages/app`.
  Run `npm run test:e2e:renderer --workspace=@getpaseo/desktop -- e2e/task-navigation.spec.ts --workers=1` from the repo root.
  The browser check covers cross-workspace selection, unread-to-idle behavior, search, reload
  persistence, and the original workspace sidebar fallback.

## desks: personal tab sets across projects in Tasks mode

- **Added:** 2026-10-16 (upstream 0.11.2)
- **Commit:** `custom: add cross-project Desks to task navigation`, then
  `custom: Desks reuse the workspace split layout and tab row`, then
  `custom: Desks as header chips with rename and delete`
- **Why:** Checking an agent should not replace the surrounding tabs. Group work by personal
  purpose while preserving the original workspace model as a toggleable fallback. Desks render the
  workspace's own split layout and tab row, so every tab customization (Copy full file path, Open
  in browser, the tab menu, splits) works in both modes without a second implementation.
- **What:** Tasks mode hosts saved **Desks**. The header shows a **+** for New Desk, then one chip per Desk
  ([desk-header](#desk-header-new-desk--before-the-desks-a-soft-green-selected-desk-no-project-name)). Clicking a chip switches to it;
  right-clicking offers Rename and Delete (confirmed, never the last Desk). Deleting drops only the
  tab references; agents and workspaces stay. Editor and Git header actions follow the
  focused tab's source workspace. A Desk is a workspace-style split layout whose tabs each
  remember their source host and workspace: the standard tab row, tab context menu, drag to
  reorder or split, Split right/down, maximize, middle-click close and the + launcher all work as
  in a workspace. Clicking a task opens it in the preview tab (italic label); middle-click or Keep
  tab retains it. Closing a tab drops its reference without archiving a session and asks before
  discarding unsaved changes. Links a Desk browser opens in a new tab land beside it. Activity and
  recent-open ordering preserve existing sibling positions until timestamps differ by at least one
  minute; attention groups still update immediately. Shift+Tab cycles Desks; tab navigation and
  closing use the focused pane's tabs. Search and checked project selection share a sidebar row,
  with Select all/none. Sorting offers attention, last activity, recently opened, and title. New
  workspace and Browse workspaces rows are removed from the Tasks sidebar. The top-bar Tasks
  switch restores the original layout.
- **Files:** `packages/app/src/task-navigation/` owns Desk persistence (`desks-store.ts`: a
  `WorkspaceLayout` plus `owners` per tab, migrated from the earlier flat tab list), the screen,
  task projection, and the navigation bridge. Desk state is local to this app installation and
  separate from workspace layouts. `screens/workspace/workspace-tab-menu-actions.ts` holds the tab
  menu actions both screens call.
- **Core files touched:** The host workspace route chooses DeskScreen in Tasks mode.
  `workspace-layout-storage.ts` exports the target and layout schemas. `workspace-tab-owner.ts`
  (new) is a context resolving a tab's workspace; `workspace-desktop-tabs-row.tsx`,
  `split-container.tsx` and `workspace-panel-host.tsx` read it for presentation, drag checks and
  modified-tab retention, and the tab chip gets an italic preview label and a `data-desk-tab`
  attribute. `panel-instance-attributes.ts` accepts that resolver. `workspace-tab-menu.ts` passes
  the tab id to the file actions. `workspace-screen.tsx` calls the shared tab menu actions.
  `desktop/browser/new-tab-requests` hands `openUrl` its request. The navigation store and explicit
  tab preparation bridge existing launchers into Desks; supporting Changes/PR opens honor Desks.
  Header shortcut hints label Desk cycling. Bottom terminals are supported by
  [desk-bottom-panel](#desk-bottom-panel-bottom-terminals-in-tasks-mode).
- **Re-apply:** Keep the original WorkspaceDeck branch intact. Insert DeskScreen only at the host
  workspace content boundary, after route/open-intent handling. Render `SplitContainer` with the
  Desk's layout under a `WorkspaceTabOwnerProvider`; every place the split container, tab row or
  panel host resolves a tab's presentation, host or panel attributes must use the owner, falling
  back to the screen's server/workspace when there is no provider. Change Desk layouts only through
  the pure functions in `workspace-layout-actions.ts`, never `useWorkspaceLayoutStore` (its tab ids
  are per-target and collide across workspaces). Keep workspace-screen tab menu handlers as thin
  calls into `workspace-tab-menu-actions.ts`. Never move sessions or replace their workspace
  layouts to implement a Desk. Keep panel-state updates attached to their Desk even while a
  different Desk is selected. Preserve the existing Tasks toggle and `custom-desks` storage keys.
  Keep prior sibling order across task updates; only cross a neighbor when its timestamp is at
  least 60 seconds older (or its attention priority is lower).
- **Verify:** Run the task-navigation model/store suites, `workspace-tab-menu.test.ts`, and the
  desktop task-navigation browser test already registered in the update script. The browser test
  covers previews, retained tabs, the tab context menu, splitting and closing a split, composer
  drafts, Desk creation/restoration, cycling, agent/terminal creation, project filters, sort
  persistence, and switching back to the workspace layout. Run typecheck/lint, build desktop, then
  install into a new build folder. Do not restart the user's daemons.

## sidebar-show-more: collapse secondary header navigation

- **Added:** 2026-10-16
- **Commit:** `custom: collapse secondary sidebar navigation`
- **Why:** Plugin links crowd out the daily controls and workspace/task list.
- **What:** History, Search, Voice, and desktop Wake dictation stay at the top, in that order.
  Show more reveals visible Schedules and plugin links; Show less collapses them. Secondary
  visibility preferences and ordering remain intact. Expansion resets when the sidebar remounts.
- **Core files touched:** `components/sidebar/sidebar-nav-rows.tsx` owns the disclosure;
  `components/left-sidebar.tsx` no longer renders a separate Wake dictation control.
- **Re-apply:** Render the daily controls before the disclosure in the shared navigation group.
  Keep Voice and Wake dictation mounted while expanding/collapsing; preserve plugin anchor refs
  and navigation callbacks. New workspace remains in its existing workspace-list location.
- **Verify:** The existing desktop `e2e/task-navigation.spec.ts` checks visible controls and
  Schedules expansion/collapse and remains registered in the customization update script.

## task-shortcuts: keyboard navigation and draft selection in Tasks mode

- **Added:** 2026-10-16
- **Commit:** `custom: add task mode shortcuts and draft project cycling`
- **Why:** Task navigation needs shortcuts matching its visible order, and new conversations need
  quick project/model selection without leaving the Desk.
- **What:** Hold Ctrl for numbered task badges; Ctrl+1–9 selects visible rows including expanded
  children in sidebar order. Shift+Tab cycles Desks, including from terminals and embedded browsers.
  In an empty draft, Up moves to the previous project on the current host that already has a
  workspace and Down to the next one (both wrap), and Left cycles available favorite models in favorites order (no favorites means no change). Right cycles the effort level forward with wraparound. Left and Right also work in an ongoing chat's empty composer and outside Tasks mode: `AgentControlCommandCenterRegistration` handles `task.draft.model`/`task.draft.effort` when the composer passes `isInputEmpty` (`composer/index.tsx` → `AgentControls`); the bindings no longer require `tasksMode`. The New Workspace screen keeps Left for its project cycle, since nothing handles the model action there. Drafts show the project icon beside their controls. Settings →
  Shortcuts has a **When in tasks mode** section with all six configurable bindings, including Ctrl+N to open New Desk. Tasks mode
  hides the New workspace header hint; workspace-mode bindings remain separate.
- **Core files touched:** The keyboard binding/context/dispatcher/routing modules, global keyboard
  hook, browser shortcut policy, header shortcut strip, task sidebar/Desk store/screen, draft project source, and composer.
- **Re-apply:** Keep mode checks in the central matcher, including modifier-hold badge derivation.
  Dispatch task indices to the sidebar's filtered, flattened rows, never workspace targets. Keep
  draft selection gated on the focused empty prompt and submission state. A project switch changes
  only the draft tab's source workspace; its ID and Desk remain unchanged. Reuse project icon lookup.
- **Verify:** Existing `composer/empty-shortcuts.test.ts`, `keyboard/keyboard-shortcuts.test.ts`,
  `keyboard/route-shortcut.test.ts`, `desktop/browser/shortcuts.test.ts`, `task-navigation/store.test.ts`, and desktop
  `e2e/task-navigation.spec.ts` are already in the customization update script. Browser coverage
  checks project/model arrows, typed-text protection, draft icons, numbered badges, task selection,
  Desk cycling, and the header hint.

## html-preview-links: open linked local HTML reports

- **Added:** 2026-10-16
- **Commit:** `custom: open relative HTML links from file previews`
- **Why:** “Open prototype” in a local report resolved against the app’s srcdoc base URL,
  so the linked interactive page never opened.
- **What:** Web/desktop previews forward relative `.html`/`.htm` link clicks to the file pane.
  Resolve against the source file’s folder and open another isolated preview. Inline scripts,
  modules, and blob workers keep the existing policy; external script dependencies still require
  the Browser panel with an HTTP server.
- **Core files touched:** `file-panels/html-preview-navigation.ts`, `html-preview-assets.ts`,
  `html-preview.web.tsx`, `html-preview.tsx`, `builtin.tsx` (`HtmlPreview` passes
  `onOpenHtmlLink`, built from `usePaneContext().openFileInWorkspace` and
  `resolvePreviewHtmlLink(params.path, url)`), and `SECURITY.md`. Before upstream 0.14 the
  callback came from `panels/file-panel.tsx` through `file-pane/pane.tsx`; neither is touched now.
- **Re-apply:** Inject the link bridge into web previews with an open callback, accept messages
  only from that iframe, resolve relative HTML paths with the shared bounded path resolver, and
  use the pane’s `openFileInWorkspace` action. Keep image MIME filtering in the image loader.
- **Verify:** The preview navigation/asset unit suites and asset browser suite are in the update
  script. Click “Open prototype” in the diagram-libraries report, then switch All/Ops/Names and
  toggle the theme in the opened prototype.

## desk-bottom-panel: bottom terminals in Tasks mode

- **Added:** 2026-10-16
- **Commit:** `custom: enable bottom terminal toggle in Tasks mode`
- **Why:** DeskScreen replaced the workspace screen but never registered its bottom-panel action,
  leaving both the sidebar button and Ctrl+J without a handler.
- **What:** The Desk gets the same bottom panel as a workspace: a `bottom-panel` pane of the Desk
  layout, with its own tab bar, split full-width under everything. The first toggle opens a
  terminal of the focused task's workspace in it; later toggles hide and show the pane, and its
  tabs (terminals of any workspace) keep running while hidden. Closing its last tab removes the
  pane. The header can show the shortcut hint.
- **Core files touched:** `task-navigation/desks-store.ts` (`toggleBottomPanel`),
  `task-navigation/new-tab-menu.tsx` (the Ctrl+J handler, next to the Desk launch shortcuts, so it
  can create the terminal), `workspace-tabs/bottom-panel.ts` (exports
  `releaseFocusFromBottomPanel`), and `header-shortcuts/strip.tsx`.
- **Re-apply:** Add a Desk store action that runs `toggleBottomPanelInLayout` on the active Desk
  layout (no explorer sidebar pane) and applies it with the given owner as fallback, so the new
  launcher tab belongs to the focused task's workspace. In `DeskLauncherProvider`, handle
  `workspace.bottom-panel.toggle`: skip on compact layouts, release focus when it hides, and on
  `created` call `createTerminal` with `{ kind: "replace", tabId: launcherTabId }`.
- **Verify:** `(cd packages/app && npx vitest run src/task-navigation/store.test.ts)` and the
  desktop `e2e/task-navigation.spec.ts`, which checks the footer button and Ctrl+J, the terminal
  tab in the pane, source workspace ownership, reuse without duplicate terminals, and that
  closing the last tab removes the pane. Both are registered in the update script.

## browser-no-toolbar: Warp opens as one app-like tab

- **Added:** 2026-10-18
- **Commits:** `custom: Warp tabs hide the browser toolbar and take focus`,
  `custom: Warp opens in one tab and keeps Ctrl+R and Ctrl+L`
- **Why:** Warp is the whole UI of its tab, so the URL bar and browser buttons were noise, and
  "+ → Warp" left two tabs: the plugin's launcher and the browser tab it opened. In the bottom
  panel, Ctrl+J showed the Warp tab again without giving it the keyboard, unlike a terminal. The
  browser's reserved Ctrl+R (reload) and Ctrl+L (focus URL) took history search and clear screen
  away from the shell.
- **What:** `navigation.openBrowser` takes three more options. `toolbar: false` hides the toolbar
  row, focuses the page whenever its pane becomes the focused one (Ctrl+J showing the bottom
  panel, clicking the tab), and gives Ctrl/Cmd+R, Ctrl/Cmd+Shift+R and Ctrl/Cmd+L to the page.
  `icon` is a Lucide icon name shown on the tab in place of the favicon. `replacePanel: true`,
  from a workspace panel, retargets the panel's own tab to the browser. The Warp plugin uses all
  three, so "+ → Warp" leaves one "Warp" tab with the terminal icon. The bridge page's title is
  plain "Warp". Warp tabs opened before this keep their old look; open new ones.
- **Core files touched** (marked `CUSTOM(browser-no-toolbar)`):
  - `packages/plugin/src/client/contracts.ts`: the three `openBrowser` options.
  - `packages/app/src/plugins/host-navigation-model.ts` and `host-navigation.ts`: pass them on,
    and the optional `replaceCurrentTab` owner hook; `plugins/workspace-panels/panel.tsx` hands it
    the pane's `retargetCurrentTab`.
  - `packages/app/src/desktop/browser/store/state.ts` and `store/index.ts`: optional
    `hideToolbar` and `tabIcon` on `BrowserRecord`, its strict persistence schema,
    `createBrowserRecord` and `createWorkspaceBrowser`.
  - `packages/app/src/desktop/browser/panel.tsx`: the tab icon; `plugins/icons.ts` exports
    `findPluginIcon`.
  - `packages/app/src/desktop/browser/pane/index.electron.tsx`: the toolbar row's style switches
    to `chromeRowHidden` (`display: none`), and an effect focuses the webview while the pane is
    interactive.
  - Reserved keys: `desktop/browser/resident-webviews.ts` sends `pageOwnsReservedKeys` with the
    attached-browser registration (`desktop/host.ts`, `packages/desktop/src/preload.ts`), the
    main process parses it (`packages/desktop/src/main.ts`, `readAttachedBrowserInput`) and
    `features/browser-keyboard/index.ts` skips `classifyBrowserReservedShortcut` for that guest.
    It also sets `setIgnoreMenuShortcuts(true)` for those keys: the app menu's Reload has the
    same accelerator and would otherwise reload the whole Paseo window.
- **Re-apply:** Add the fields end to end as above. Keep the toolbar JSX in place and only swap
  its style, so upstream edits to the toolbar still apply. The persisted schema is a
  `strictObject`: without the fields there, a saved record with them fails validation and every
  browser tab is dropped on load. After changing `contracts.ts`, run
  `npm run build --workspace=@getpaseo/plugin` before typechecking the app. The bridge title
  lives in `~/projetos/warp-web-custom/paseo-bridge/server.mjs`.
- **Verify:** `(cd packages/app && npx vitest run src/desktop/browser/store/state.test.ts src/plugins/host-navigation.test.ts)`
  and `(cd packages/desktop && npx vitest run src/features/browser-keyboard/index.test.ts)`. In
  the app, "+ → Warp" gives one Warp tab with no URL bar; Ctrl+R searches the shell history. Put
  it in the bottom panel, press Ctrl+J twice and type.

## bottom-panel-tab-keys: Ctrl+Tab, Ctrl+W and Ctrl+T stay in a page in the bottom panel

- **Added:** 2026-10-18, Ctrl+W and Ctrl+T added 2026-10-19
- **Commit:** `custom: Ctrl+Tab stays in Warp in the bottom panel`, then `custom: Ctrl+W stays in Warp in the bottom panel`,
  then `custom: Ctrl+T stays in Warp in the bottom panel`
- **Why:** Warp cycles its sessions with Ctrl+Tab and Ctrl+Shift+Tab, closes one with Ctrl+W and
  opens one with Ctrl+Shift+T, but leaves these keys unprevented for the browser. The guest preload
  forwarded them, so Paseo switched, closed or opened its own tabs on the same press.
- **What:** A Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W, Ctrl+T or Ctrl+Shift+T forwarded from a browser tab
  that sits in a bottom
  panel (workspace or Desk) is dropped on the Paseo side. Everywhere else, including a Warp tab in a
  normal pane, Paseo keeps its shortcut. Ctrl+W is only the non-mac binding; macOS Cmd+W is not
  covered.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel-browser.ts` and its test. No conflict
  risk.
- **Core files touched:** `packages/app/src/hooks/use-keyboard-shortcuts.ts`,
  `handleBrowserShortcutInput`, marked `CUSTOM(bottom-panel-tab-keys)`.
- **Re-apply:** In the handler for `browser-shortcut-input`, return before resolving the shortcut
  when `(isTabCycleKey(input) || isCloseSessionKey(input) || isNewSessionKey(input)) &&
isBrowserInBottomPanel(input.browserId)`.
- **Verify:** `(cd packages/app && npx vitest run src/workspace-tabs/bottom-panel-browser.test.ts)`.
  In the app, open two Warp sessions in the bottom panel's Warp and press Ctrl+Tab: Warp switches,
  the Paseo tab stays. Press Ctrl+W: Warp closes its session, the bottom panel stays open. Press Ctrl+Shift+T: Warp opens
  a session, and no Paseo tab opens.

## browser-shortcut-preempt: Ctrl+J hides the bottom panel from inside Warp

- **Added:** 2026-10-18
- **Commit:** `custom: Ctrl+J crosses ahead of the page in browser tabs`
- **Why:** App shortcuts reach Paseo from a browser tab only when the page leaves the key alone.
  Warp uses Ctrl+J (newline) and calls `preventDefault`, so Ctrl+J never left a Warp tab. Ctrl+T
  worked because Warp doesn't use it.
- **What:** The browser keyboard policy marks the bottom panel toggle as `preempt`. The guest
  preload's capture listener runs before the page's, so for a preempting key it forwards the
  shortcut at once and stops the event; the page never sees it. Every other shortcut still gives
  the page first refusal. A browser pane's focus listener also no longer focuses a pane that is
  hidden, so a guest that keeps focus can't show the panel again.
- **Core files touched** (marked `CUSTOM(browser-shortcut-preempt)`, the pane guard
  `CUSTOM(browser-no-toolbar)`):
  - `packages/app/src/desktop/browser/shortcuts.ts`: `preempt` on the prefix, `PREEMPTING_ACTIONS`,
    and `prefixKey`.
  - `packages/desktop/src/features/browser-keyboard/policy.ts`: parses `preempt`.
  - `packages/desktop/src/features/browser-keyboard/guest-preload.ts`: `findPolicyPrefix` returns
    the prefix, and a preempting one is sent from the capture phase.
  - `packages/app/src/desktop/browser/pane/index.electron.tsx`: `handleWebviewFocus` returns
    early while the pane isn't presented.
  - `packages/desktop/capture-harness/main.js`: a page that claims Ctrl+J, and the check.
- **Re-apply:** Add the optional `preempt: true` field to the prefix on both sides, set it when a
  single-step binding's action is the bottom panel toggle, and in the preload forward it from the
  capture listener with `preventDefault` and `stopImmediatePropagation`.
- **Verify:** `(cd packages/app && npx vitest run src/desktop/browser/shortcuts.test.ts)`,
  `(cd packages/desktop && npx vitest run src/features/browser-keyboard/policy.test.ts)`, and the
  real-Electron check:
  `ELECTRON_DISABLE_SANDBOX=1 PASEO_CAPTURE_HARNESS_GROUP=automation npm run capture-harness --workspace=@getpaseo/desktop`
  (the sandbox variable only because the repo's `chrome-sandbox` isn't setuid root here).

## ctrl-t-terminal: Ctrl+T opens a tab from inside a terminal

- **Added:** 2026-10-18
- **Commit:** `custom: Ctrl+T opens a new tab from inside a terminal`
- **Why:** In the bottom panel the terminal has focus most of the time, and upstream's Linux and
  Windows Ctrl+T binding skips terminals, so Ctrl+T never opened a tab there.
- **What:** Ctrl+T opens a new tab in the focused pane, also when a terminal has focus. The shell
  no longer gets Ctrl+T (readline's transpose-chars). Rebind it in Settings → Keyboard shortcuts
  ("New tab") to get it back. macOS uses Cmd+T and was not affected.
- **Core files touched:** `packages/app/src/keyboard/keyboard-shortcuts.ts`: the
  `workspace-tab-new-ctrl-t-non-mac` binding, marked `CUSTOM(ctrl-t-terminal)`.
- **Re-apply:** Drop `terminal: false` from that binding's `when`.
- **Verify:** `(cd packages/app && npx vitest run src/keyboard/keyboard-shortcuts.test.ts)` and
  the desktop `e2e/task-navigation.spec.ts`, which presses Ctrl+T inside the bottom panel's
  terminal.

## chat-esc-focus: Esc after selecting chat text returns to the composer

- **Added:** 2026-10-16
- **Commit:** `custom: return to the composer with Esc after selecting chat text`
- **Why:** After selecting text in the chat with the mouse, or after scrolling up to read,
  typing again needed a click back into the composer.
- **What:** On web and desktop, Esc with a non-empty text selection inside an agent's chat timeline
  clears the selection and focuses that agent's composer. It does nothing when focus is in an
  input, a menu, or a dialog, when the key has a modifier, or when a shortcut already handled Esc
  with `preventDefault`. Esc's other jobs still run on the same press: if Interrupt agent is bound
  to Esc and the agent is running, that Esc also interrupts it. Native has no mouse selection and
  renders the plain surface.
  Esc reaches the composer on the first press since 2026-11-03, through two fixes outside this
  module. The user binds Focus message input to `Escape` and Interrupt agent to `Escape Escape`
  (Settings > Shortcuts). The shortcut resolver used to let the chord win the prefix: the first
  Esc was swallowed waiting for the second, so Esc only reached the composer through this
  module's selection rule. Now a single combo fires at once when every chord sharing its first
  key only repeats that key, and the chord stays armed: Esc focuses the composer, Esc Esc also
  interrupts. Other chords (`Ctrl+W S`) still win their prefix. A click ends a pending chord, so
  Esc, click, Esc is two single presses and does not interrupt the agent. And a hover card opened
  only by the pointer (file links in the chat, the composer's status line, the context meter)
  closes on Esc without taking the key; before, it swallowed the first Esc.
  Enter also focuses the composer when focus sits in the chat (not on a button or link inside it)
  or nowhere, and scrolling the chat back to the bottom does the same unless chat text is
  selected. With several chats on screen (Desk panes), only the chat last clicked or scrolled
  reacts when nothing is focused.
- **Files:** `packages/app/src/chat-esc-focus/`: `model.ts` (pure Esc rules), `registry.ts`
  (composers register their focus function per server and agent), `surface.web.tsx` (window
  keydown listener, bubble phase), `surface.tsx` (native passthrough), `types.ts`. No conflict risk.
- **Core files touched:** `agent-stream/view.tsx` renders `ChatEscFocusSurface` in place of
  `AssistantSelectionCopySurface` (it wraps that surface, so JSX depth stays the same);
  `components/ui/hover-card.tsx` (`keyPressed`) closes a card without focus inside on Esc and
  returns `false`; `keyboard/keyboard-shortcuts.ts` (`resolveInitialChordStep`,
  `isRepeatedKeyChord`) fires the single combo before a repeated-key chord;
  `hooks/use-keyboard-shortcuts.ts` resets a pending chord on `pointerdown`;
  `composer/index.tsx` calls `useRegisterChatComposerFocus(serverId, agentId,
focusMessageInputForKeyboardAction)`; `agent-stream/view.tsx` passes its `isNearBottom` state
  to the surface.
- **Re-apply:** Wrap the chat timeline's selection-copy surface in a DOM element the Esc listener
  can test the selection against, and keep `enabled={!readOnly}`. In the composer, register the
  same focus function the `message-input.focus` keyboard action uses, keyed by server and agent.
  Leave the `agent.interrupt` binding untouched. In the hover card, an Esc with focus outside the
  card closes it and returns `false`. In `resolveInitialChordStep`, when a single combo matches
  and every advancing chord candidate repeats one combo, return the single match with the chord
  armed and `preventDefault: false`. In `useKeyboardShortcuts`, a capture `pointerdown` listener
  resets a pending chord.
- **Verify:** `(cd packages/app && npx vitest run src/chat-esc-focus/model.test.ts
src/keyboard/keyboard-shortcuts.test.ts)` and `(cd packages/app && npx vitest run --project
browser src/components/ui/hover-card.browser.test.tsx)` (the update script runs them). With
  `Escape` bound to Focus message input, click a sidebar row and press Esc once: the caret is in
  the composer; click the chat and press Esc again within a second: the caret returns and the
  agent keeps running. In the app, select a word in an agent reply, press Esc: the selection clears
  and the caret is in that agent's composer. Click the chat background and press Enter: the
  caret is back in the composer. Scroll up, then scroll back down: the caret returns.

## chat-code-run: Run button on suggested shell commands

- **Added:** 2026-10-16
- **Commit:** `custom: run suggested shell commands from chat code blocks`
- **Why:** Agents often suggest a command (`! gh auth login -h github.com -p https -w`). Running it
  meant copying it into the composer by hand.
- **What:** In an agent's chat, code blocks get a Run (play) button left of Copy. It shows for
  `bash`, `sh`, `shell`, `zsh`, `console`, and `shellsession` blocks of up to 12 command lines, and
  for unlabeled blocks of one line. A leading `$ ` or `!` prompt marker is stripped; in a
  transcript with `$ ` prompts, only the prompted lines run. Clicking it runs the command exactly
  as typing `!<command>` in that agent's composer does: the shell-command plugin's `sh` command,
  with output in a Terminal card. The button is hidden when the agent's host lacks the
  shell-command plugin, in read-only subagent views, and in markdown outside a chat.
- **Files:** `packages/app/src/chat-code-run/`: `model.ts` (which blocks are runnable, prompt
  stripping), `context.tsx` (`ChatCodeRunProvider` resolves `!<command>` against the agent's plugin
  slash commands and runs it), `run-button.tsx`. No conflict risk.
- **Core files touched:** `components/highlighted-code-block.tsx` renders `CodeBlockRunButton`
  before the top `CopyButton`; `panels/agent-panel.tsx` wraps `AgentStreamView` in
  `AgentStreamSection` with `ChatCodeRunProvider`.
- **Re-apply:** Provide the agent's server, workspace, and agent ids above the chat stream of the
  agent panel. In the provider, use `usePluginClientSlashCommands` and
  `resolvePluginClientSlashCommand({ text: "!" + command })`, then
  `executePluginClientSlashCommand`, the same calls the composer's submit path uses. Place the
  button absolutely, one icon slot left of the code block's top Copy button, with the same
  hover visibility.
- **Verify:** `(cd packages/app && npx vitest run src/chat-code-run/model.test.ts)` (the update
  script runs it). In the app, ask an agent for a ```bash block with `! echo hi`, hover the block,
click Run: a Terminal card with `hi` appears and the agent receives nothing.

## desk-pane-actions: pane toolbar buttons, Desk tab moves and launch shortcuts in Tasks mode

- **Added:** 2026-10-16
- **Commit:** `custom: Desk pane toolbar, tab moves and launch shortcuts`
- **Why:** Splitting a pane took three clicks through the "…" menu, archiving a session from a
  Desk meant leaving it, tabs could not change Desk, and Ctrl+T / Ctrl+Shift+T did nothing in
  Tasks mode because the workspace screen that handles them is not mounted there.
- **What:**
  - The pane toolbar shows **Split right** and **Split down** as direct buttons (the "…" menu is
    gone) in both modes. When the pane's focused tab is an agent, an **Archive session** button
    follows. In a workspace the archived agent's tab drops out on reconciliation; in a Desk the tab
    reference closes too.
  - A Desk tab's context menu ends with **Move to ›** listing the other Desks. The tab leaves the
    current Desk and opens kept (not preview) in the target, which stays unselected.
  - In Tasks mode Ctrl+Shift+T opens a terminal, Ctrl+T the new-tab launcher, and the agent/browser
    launch actions open drafts/browsers, all in the Desk's focused pane with the scope workspace.
    The handler takes both action families: the command center sends `workspace.agent.new` /
    `workspace.browser.new`, the "New agent" / "New browser" shortcuts send
    `workspace.tab.target.agent` / `workspace.tab.target.browser`.
- **Core files touched:** `screens/workspace/workspace-desktop-tabs-row.tsx` (direct split buttons,
  `PaneArchiveAgentButton`, `usePaneArchiveAgentTab`, reserved width, Move to submenu),
  `screens/workspace/workspace-tab-owner.ts` (`WorkspaceTabMoveProvider` context). Desk side:
  `task-navigation/desks-store.ts` (`moveTabToDesk`), `desk-screen.tsx` (provides the move menu and
  the launch-shortcut `enabled` flag), `new-tab-menu.tsx` (launch shortcut handler).
- **Re-apply:** Replace the split dropdown in `WorkspacePaneToolbarActions` with two
  `ToolbarButton`s using the same test IDs and shortcut hints, and double the split actions'
  reserved width. Add the archive button only for `host === "main"` agent tabs; archive through
  `useArchiveAgent`, and close the tab only when a Desk owner resolver is present (closing a
  workspace agent tab would archive it a second time). The Move to submenu reads an optional
  context that only DeskScreen provides, so the workspace tab menu is unchanged. Register the
  launch actions inside `DeskLauncherProvider`, gated on the Desk screen being focused.
- **Verify:** `store.test.ts` covers `moveTabToDesk`. The second test in desktop
  `e2e/task-navigation.spec.ts` checks the split buttons, the archive button, Ctrl+Shift+T and
  moving a tab between Desks. Both are already registered in the update script.

## task-sidebar-actions: idle limit, row menu and archived sessions in the Tasks sidebar

- **Added:** 2026-10-16
- **Commit:** `custom: Tasks sidebar idle limit, row menu and archived list`, then
  `custom: Tasks sidebar idle group opens on 30 minutes and pages by 5`
- **Why:** Old idle sessions buried the rest of the Tasks sidebar, task rows had none of the
  workspace row's everyday actions, and archived sessions could only be found in History.
- **What:**
  - Idle limit: in every sort (only **Attention first** until
    [task-idle-divider](#task-idle-divider-expand--collapse-on-the-line-under-the-pinned-tasks)),
    the idle tasks open on the 5 newest that changed in the last 30 minutes. The toggle row at the
    end of the Idle group (of the list, in the other sorts) (the workspace sidebar's toggle, with a label
    override) pages: **Show next 5** reveals the next five whatever their age, then **Show N more**
    reveals the rest, and **Show less** folds back to the opening limit. The crew holding the
    selected task is never hidden and does not count. Searching or choosing the Idle filter shows
    every idle task. Ctrl+1..9 number only visible rows.
  - Row menu: right-clicking a task opens the workspace row's context menu for its workspace:
    Copy path, Copy branch name (git), **Rename session**, Mark as read/unread, Labels, Open in file
    manager and **Archive session**. Rename and archive act on the agent. Mark as unread appears only
    on the workspace's newest finished root agent, because that is the one the daemon marks.
    Pin is the session pin from [task-pins](#task-pins-pinned-sessions-under-the-tasks-filters).
  - Archived: an **Archived** filter loads archived sessions from agent history (all hosts, paged,
    with Load more) plus sessions archived in this app session. Search and project selection apply.
    Clicking one opens it in the Desk, where the archived callout offers Unarchive. The count shows
    once loaded. Sessions whose workspace is archived or hidden are not listed.
- **Files:** `task-navigation/task-row-menu.tsx` (actions and rename modal),
  `task-navigation/use-archived-tasks.ts`, `limitIdleTasks` and `markableUnreadTaskKeys` in
  `task-navigation/model.ts`, rows in `task-navigation/sidebar.tsx`.
- **Core files touched:** `components/sidebar/sidebar-workspace-menu.tsx` gains an optional
  `renameLabel`; `components/sidebar/sidebar-group-toggle-row.tsx` gains an optional `label`.
- **Re-apply:** Wrap the task row's open button in `SidebarWorkspaceContextMenu` with the row's
  workspace entry, passing the middle-click ref as `triggerRef`. Keep one sidebar-level actions
  object and rename modal so rows stay memoized. Apply `limitIdleTasks` only to the attention
  sort's idle group, before flattening. Fetch history only while the Archived filter is selected.
- **Verify:** `model.test.ts` covers the idle limit and markable-unread rule. The second test in
  desktop `e2e/task-navigation.spec.ts` covers the row menu, Rename session, and the Archived
  filter after archiving. Both are already registered in the update script.

## history-content-search: History search finds sessions by what was said

- **Added:** 2026-10-16
- **Commit:** `custom: History search matches session messages`
- **Why:** Upstream History search matches only workspace, title, branch and project names, on
  purpose: the daemon doesn't keep every transcript loaded, so searching them would give partial
  results. A small full-text index makes message search complete.
- **What:**
  - The daemon keeps `$PASEO_HOME/history-search.db`, a SQLite FTS5 index on Node's built-in
    `node:sqlite` (no new dependency). It holds only user prompts and agent replies, not tool
    calls or output. About 5 MB for 200 sessions.
  - New turns are indexed from the timeline 2 s after each turn ends. 30 s after daemon start, a
    one-time backfill reads each stored session not indexed yet from its Claude transcript or
    Codex rollout (live and archived). Messages are keyed by content hash, so re-indexing never
    duplicates them. Other providers are indexed only from their live turns.
  - History search keeps the name match and also returns sessions with a message containing every
    query word (prefixes, case and accents ignored). Those rows show the best matching excerpt
    under the title with a user or bot icon and the words highlighted.
  - The query takes operators, for names and messages alike: `"at once"` (adjacent whole words),
    `relay OR tunnel` (also `|`, binds tighter than the implicit AND), and `-word` / `-"phrase"`
    (drops the session if its names or any of its messages mention it). Lowercase `or` is a word.
    Required terms must all land in one message; names still match on their own, with typo
    tolerance for unquoted terms only. A collapsed "Search syntax" toggle under the search field
    lists them (English only).
  - If the database fails to open, the daemon logs a warning and search stays name-only.
- **Files:** `packages/server/src/server/history-content-index.ts` (schema, search, snippet
  ranges), `history-content-indexer.ts` (turn-end indexing, backfill, transcript parsers),
  `packages/protocol/src/search/history-query.ts` (query operators, shared by daemon and app),
  app `components/history-search-syntax.tsx` (the syntax toggle).
- **Core files touched:** `server/bootstrap.ts` opens and closes the indexer;
  `server/session.ts` `collectFetchAgentsEntries` ORs content matches into the History search;
  `server/agent-history-search.ts` matches names against the parsed query (`matchAgentHistoryNames`);
  `protocol/src/messages.ts` adds optional `contentMatch` to directory entries;
  app `hooks/use-agent-history.ts`, `hooks/use-aggregated-agents.ts` and
  `components/agent-list.tsx` carry and render it, and highlight `historyQueryHighlightText` so
  operators and excluded words are not marked; `screens/sessions-screen.tsx` renders
  `<HistorySearchSyntax isVisible={isSearchSupported} />` under the filter row.
- **Re-apply:** Call `openHistoryContentIndexer` in bootstrap after agent storage initializes and
  its stop function at shutdown. Where History filters by search, `parseHistoryQuery(search)` once
  per request and run `getActiveHistoryContentIndex()?.search(query)`. Drop an entry when
  `matchAgentHistoryNames` says `excluded` or its id is in `excludedAgentIds`; otherwise keep it
  when names match or it has a content match, attaching `contentMatch`. Keep `contentMatch`
  optional on the wire. In the app, map `entry.contentMatch` onto the row's agent and render it in
  `SessionRow`.
- **Verify:** `history-content-index.test.ts`, `agent-history-search.test.ts` (server) and
  `search/history-query.test.ts` (protocol) are registered in the update script. By hand: search
  History for a word only said in a conversation, then for `"at once"` and `"at once" -qa`.

## task-state-settle: Tasks sidebar states hold for a second before changing

- **Added:** 2026-10-16
- **Commit:** `custom: Tasks sidebar settles task states for a second`
- **Why:** An agent's turn opens and closes many times a second during tool calls, so its row
  jumped between "In progress" and the Idle or review groups and its signal flickered.
- **What:** Each task's shown state changes only after the new live state has held for 1 s
  (`SETTLE_TASK_STATE_MS`). A flip that reverts within the second never shows. A task seen for the
  first time, and a change to Needs you or Failed, show at once. Sections, counts, filters, the
  row signal and label all read the shown state.
- **Files:** `settleTaskStates` in `task-navigation/model.ts` and the timer hook
  `task-navigation/use-settled-task-states.ts`; `sidebar.tsx` passes the shown states to
  `buildTaskTree` through its optional `states`. New code; no core files touched.
- **Re-apply:** Call `useSettledTaskStates(agents)` in `TaskNavigationSidebar` and pass the result
  as `states` to `buildTaskTree`.
- **Verify:** `model.test.ts` covers settling and is already registered in the update script.

## media-pause: voice mode and dictation pause playing media

- **Added:** 2026-10-16
- **Commit:** `custom: pause playing media during voice mode and dictation`
- **Why:** Music playing while you talk gets picked up by the mic and drowns out the reply.
- **What:** On Linux desktop, when voice mode starts (composer or sidebar voice) or dictation
  starts recording, every MPRIS player reporting `Playing` is paused. When the last of them ends,
  the players Paseo paused are resumed 2.5 s later (a Bluetooth headset needs that long to leave
  its low-quality Handsfree mode; resuming sooner plays the first moment through it), unless they are no longer `Paused` (you stopped or
  restarted one meanwhile). Wake dictation (always-listening) does not pause media, since its mic
  stays open. A reloaded or closed window releases its hold. Players are reached with `gdbus`
  (part of GLib, so no new dependency). Other platforms do nothing.
  Turning the volume down through PipeWire instead of pausing was tried on 2026-10-22 and rolled
  back at the user's request: the original pause and resume is what they want.
- **Files:** `packages/desktop/src/features/media-pause.ts` (MPRIS bus, pause/resume holders,
  IPC), `packages/app/src/media-pause/index.ts` (`usePauseMediaWhile`).
- **Core files touched:** desktop `main.ts` calls `registerMediaPauseHandlers`; `preload.ts`
  exposes `media.setCaptureActive`; app `desktop/host.ts` types it; `contexts/voice-context.tsx`
  holds the pause while the runtime's `isVoiceMode` is true; `hooks/use-dictation.ts` holds it
  while `status === "recording"`.
- **Re-apply:** Re-add the IPC registration next to the file opener in `main.ts`, the preload
  `media` bridge, and the two `usePauseMediaWhile` calls. The sidebar voice session runs on the
  same voice runtime, so the voice-context call covers it.
- **Verify:** `packages/desktop/src/features/media-pause.test.ts` is registered in the update
  script. By hand: play music, start dictation, it pauses; stop, it resumes.

## cli-dictation: `paseo speech dictate` and `paseo speech wake` outside the app

- **Added:** 2026-10-17
- **Commit:** `custom: paseo speech dictate and wake, for keyboard shortcuts`
- **Why:** Use Paseo's dictation in any app, from a global keyboard shortcut, without copying the
  speech code out of Paseo. The daemon already does the recognition, so the CLI is a second
  client of the same dictation stream and picks up every improvement to it.
- **What:** `dictate` opens the default mic with `pw-record` (16 kHz mono PCM, the app's format)
  first and connects to the daemon while you talk, buffering the audio until then; 100 ms
  segments stream as they are recorded. On Ctrl+C/SIGTERM it finishes the stream, prints the
  text and copies it with `wl-copy`. `wake` listens until stopped and runs the app's
  `WakeDictationController`: each energy-bounded utterance is transcribed, "wake up" starts
  capturing, and a spoken "done" copies what was said before it. The wake log
  (`$XDG_RUNTIME_DIR/paseo-wake.log`) shows each utterance as `Heard:`, to see why a phrase was
  missed. Both take `--toggle` (stop the running
  one, found by `$XDG_RUNTIME_DIR/paseo-<command>.pid`, or start one), `--no-copy`, `--notify`
  (`notify-send`, for use without a terminal) and `--home`/`--host`. Media is not paused (that
  lives in Electron). Stopping `wake` mid-capture drops the uncopied text. A daemon restart ends
  `wake` with an error notification; start it again.
- **Files:** `packages/cli/src/commands/speech/{shared,dictate,wake}.ts` and `shared.test.ts`.
  `custom/bin/paseo-speech` runs them from anywhere (keyboard shortcuts have no nvm `node` on
  PATH and no `~` expansion). Symlink it into `~/.local/bin` as `paseo-dictate` and `paseo-wake`;
  the name picks the command. With no arguments it runs `--toggle --notify --home ~/.paseo`,
  logging to `$XDG_RUNTIME_DIR/paseo-<command>.log`. For a fast shortcut it stops a running
  command itself in bash, and starts by running an esbuild bundle of
  `custom/bin/paseo-speech.entry.ts` with plain node (~0.5 s to recording, against several
  seconds through `tsx` and the full CLI). The bundle is `packages/cli/dist/paseo-speech.mjs`,
  rebuilt when the CLI sources or the workspace `dist` folders are newer; it must sit in
  `packages/cli/dist` because bundled code resolves `../package.json` and `require()` relative
  to its own file. Like the CLI, it reads `@getpaseo/client` from `packages/client/dist`, so run
  `npm run build:client` after changing the shared controller.
- **Core files touched:** `packages/cli/src/commands/speech/index.ts` adds both subcommands to
  the `speech` group. `packages/client/package.json` exports `./wake-dictation`, and
  `packages/client/src/wake-dictation.ts` (moved from the app's
  `always-listening/controller.ts`) holds the controller the app sidebar toggle also imports.
- **Re-apply:** Add `createDictateCommand()` and `createWakeCommand()` to the `speech` command
  group and re-add the client export. If upstream changes the `dictation_stream_*` client calls,
  update `DictationUpload`.
- **Verify:** `shared.test.ts` and the client's `wake-dictation.test.ts` are in the update
  script. By hand: `paseo-dictate`, speak, run it again; the text is on the clipboard. `paseo-wake`,
  say "wake up", a sentence, "done"; the sentence is on the clipboard. `paseo-wake` again stops it.

## title-max-four-words: agent and workspace titles stay at four words

- **Added:** 2026-10-18
- **Commit:** `custom: limit generated agent titles to four words`
- **Why:** Long titles overflow tabs and the sidebar; four words are enough to tell tasks apart.
- **What:** The provisional title (first line of the prompt) and the generated workspace title
  are cut to four words. The title prompt says "at most 4 words", and the result is clamped in
  code in case the model or a custom title style ignores it. Explicit and manually renamed titles
  are not limited. `~/.paseo/config.json` also pins `agents.metadataGeneration.providers` to
  `claude-haiku-5-5` (local config, not in the repo).
- **Core files touched:** `packages/server/src/server/agent/create-agent-title.ts` (adds
  `clampTitleWords`) and `packages/server/src/server/worktree-branch-name-generator.ts` (title
  prompt and clamp).
- **Re-apply:** Run `clampTitleWords` on the derived prompt title and on the generated `title`,
  and replace the "about 4 words" line in the title style with a hard 4-word limit.
- **Verify:** `cd packages/server && npx vitest run src/server/session.create-agent-title.test.ts --bail=1`
  (in the update script). A new agent from a long prompt gets a tab title of four words or fewer.

## desk-explorer: the Explorer sidebar in Tasks mode

- **Added:** 2026-10-18
- **Commit:** `custom: Explorer sidebar in Tasks mode`
- **Why:** DeskScreen replaced the workspace screen without its Explorer toggle, so Tasks mode had
  no Files or Changes sidebar and Ctrl+E did nothing.
- **What:** The Desk header shows the Explorer toggle; it and Ctrl/Cmd+E show the focused task's
  workspace Explorer docked at the right, with the same width, tabs and resize handle as in the
  workspace view. Its tabs and width are the workspace's, but open or closed belongs to each Desk
  tab: a new tab starts closed, switching a draft's project with Up keeps the tab's state, and the
  workspace view keeps its own. Changes, folder links and plugins that reveal the workspace's
  Explorer open it for the focused tab too. Files and diffs
  opened from it become Desk tabs in the focused pane. Its + menu launches into the Desk. Dragging
  tabs between the Explorer and Desk panes does nothing.
- **Files:** `packages/app/src/task-navigation/desk-explorer.tsx` (`useDeskExplorer`,
  `DeskExplorerDock`).
- **Core files touched:** `components/split-container.tsx` takes an optional
  `externalExplorerSidebar` (`{ workspaceKey, render }`) that replaces its own dock and keys the
  dock width by that workspace. `task-navigation/desk-screen.tsx` renders the toggle, passes the
  dock, and registers `sidebar.toggle.right`.
- **Re-apply:** In SplitContainer, when `externalExplorerSidebar` is set, render the resize handle
  and dock column as for its own Explorer pane but call `render()` for the content, and read and
  write `explorerSidebarWidthByWorkspace` under the external key. The Desk dock reads the
  workspace's layout from `useWorkspaceLayoutStore` (`selectExplorerSidebarPaneId`) and wraps
  `ExplorerSidebarDock` in null `WorkspaceTabOwnerProvider` / `WorkspaceTabMoveProvider` so the
  Desk's owner map and Move to Desk never apply to workspace tab ids. Keep visibility in the Desk
  (`explorerTabIds`, pruned by `withLayout`, carried over when a retarget changes a tab id), never in
  the workspace layout: reading the workspace's visibility made Up in a draft open the Explorer
  whenever the next project had it open. The dock still needs the workspace's Explorer pane, so
  create it hidden when missing. Follow the workspace's visibility only on a closed-to-open change
  for the same workspace key. Compact layouts keep `toggleExplorerSidebar`.
- **Verify:** `task-navigation/store.test.ts` covers the per-tab state. The third test in desktop
  `e2e/task-navigation.spec.ts` (both already in the update script) opens the Explorer from the
  Desk header, toggles it with Ctrl+E, checks a new tab starts closed and the task tab reopens it,
  and checks the workspace view stays closed.

## commit-selection: commit or discard the files checked in Changes

- **Added:** 2026-10-18
- **Commit:** `custom: commit and discard selected files from Changes`
- **Why:** The Changes sidebar could only commit everything (the header Commit action runs
  `git add -A`). Splitting work into commits, or throwing away part of it, meant leaving Paseo.
- **What:** In the Explorer's Changes tree, on the Uncommitted comparison, every file and folder
  row ends with a checkbox. A folder checks or clears every file under it and shows a dash when
  only some are checked. Nothing is checked when the app starts; the selection survives switching
  tabs and drops files that stop being changed. Below the tree, **Select all**, **Select none** and
  **Discard selected** (after a confirm dialog) act on the selection, and a message box with a
  **Commit N files** button commits only the checked files. Other changes, staged or not, stay as
  they were. A rename commits and discards both its paths. Hidden on daemons without the feature.
- **Files:** `packages/app/src/git/commit-selection/` (`model.ts` selection rules, `store.ts`,
  `use-commit-selection.ts`, `checkbox.tsx`, `commit-box.tsx`).
- **Core files touched:**
  - Protocol: `CheckoutCommitRequestSchema` gets optional `paths`; `server_info.features` gets
    `checkoutCommitPaths`.
  - Server: `utils/checkout-git.ts` `commitChanges` takes `paths` (`commitSelectedPaths`);
    `session/checkout/checkout-session.ts` passes `msg.paths`; `websocket-server.ts` advertises
    the feature.
  - Client: `daemon-client.ts` `checkoutCommit` sends `paths`.
  - App: `git/actions-store.ts` `commit` takes `message` and `paths`; `git/file-header.tsx` and
    `git/diff-folder-row.tsx` render `RowCommitCheckbox` after the diff stat;
    `git/changed-files-tree.tsx` takes `commitSelection`; `git/diff-pane.tsx` builds the selection
    for the tree presentation and renders `CommitBox` above the Commits section.
- **Re-apply:** On the server, stage only the selected paths that exist in the worktree or the
  index (`git add -A`), then `git commit --only -- <all selected paths>`, always with
  `--literal-pathspecs`. A staged rename's old path is in neither the index nor the worktree, so it
  must skip `git add` but stay in the commit pathspecs. While a merge, cherry-pick or revert is
  pending (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`), git refuses `--only` ("cannot do a
  partial commit during a merge"): stage the selection and commit the whole index, which
  concludes the operation. In the app, gate on
  `features.checkoutCommitPaths`, enable only for the tree presentation on the uncommitted
  comparison, and keep row checkboxes as primitive props (state + stable callback) so the rows'
  memo and the react-perf lint rules hold. Discard reuses `checkout.discard_changes`.
- **Verify:** `commit-selection/model.test.ts`, the `commitChanges with paths` server suite and
  `e2e/browser/changes-commit-selection.spec.ts` are in the update script. The browser test checks
  folder selection, mixed state, Select all/none, a partial commit, and a dismissed then accepted
  discard. Needs a daemon from this build: restart the daemon after installing.

## history-ai-search: ask History which session answers a question

- **Added:** 2026-10-18
- **Commit:** `custom: History AI search`
- **Why:** Finding a past session by keywords means guessing the words and the day it happened.
  An agent can do it by reading candidate sessions and judging them; this puts that in History.
- **What:**
  - An **Ask AI** field under History search. Enter sends the question, the list is replaced by
    the picks, best first, each with a one-line reason under its title. Clearing the field brings
    the History list back. A status line shows the keyword searches and the date range the model
    chose, or the error.
  - The daemon makes two calls to the metadata model, the same one that writes agent titles
    (`agents.metadataGeneration.providers`, here `claude-haiku-5-5`). The first turns the question
    into up to 6 keyword queries in the History search syntax plus an optional date range. Those
    run against the [history-content-search](#history-content-search-history-search-finds-sessions-by-what-was-said)
    index and session titles, and the 30 sessions found by the most queries become candidates. A
    dated question with few hits is filled with that period's other sessions. The second call
    reads each candidate's title, dates, opening request and matching messages, and picks at most
    8 with a reason in the question's language.
  - About 20 s per question. Results are cached for 5 minutes per question. With several hosts,
    each host searches its own History and the lists are interleaved.
  - Hidden on hosts without `features.historyAiSearch`.
- **Files:** `packages/server/src/server/history-ai-search.ts` (prompts, candidate collection,
  pick mapping) with `history-ai-search.test.ts`; app `hooks/use-history-ai-search.ts` and
  `components/history-ai-search.tsx` (field, status, results panel). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(history-ai-search)`):
  - Protocol `messages.ts`: `history.ai_search.request` / `.response` schemas in the session
    unions, their types, and `features.historyAiSearch`.
  - Server: `session.ts` `handleHistoryAiSearch` and `dispatchHistoryAiSearchMessage` (chained in
    `dispatchWorkspaceLifecycleMessage` because the top-level dispatch chain is at the complexity
    limit); `history-content-index.ts` `firstUserMessage`; `websocket-server.ts` advertises the
    feature; `authorization/operation-permissions.ts` maps both messages to `workspace.read`.
  - Client `daemon-client.ts`: `searchHistoryWithAi` (180 s timeout).
  - App: `hooks/use-agent-history.ts` exports `toAggregatedHistoryAgents` (the entry mapping
    `fetchAgentHistoryPage` used inline); `hooks/use-aggregated-agents.ts` adds `aiReason`;
    `components/agent-list.tsx` adds `orderBy="relevance"` (no date sections) and
    `HistoryAiReasonLine`; `screens/sessions-screen.tsx` calls `useHistoryAiSearch` and wraps the
    host-error banner and the list states in `<HistoryAiSearchPanel>`, which shows them only while
    no question is submitted.
- **Re-apply:** Add the RPC pair with `requestId`, `question` in and `results: {entry, reason}[]`,
  `queries`, `since`, `until`, `error` out, and gate it on a feature flag. In the session, list
  agents like History does (`includeArchived`, `includeUnavailablePersisted`), run
  `runHistoryAiSearch` with `createAgentStructuredTextGeneration` (no focused selection, cwd the
  home dir), and build each pick's project placement. In the app, keep the History list as the
  panel's children so a submitted question swaps it for the picks.
- **Verify:** `history-ai-search.test.ts` is in the update script. By hand, on a daemon from this
  build: open History, type a question in Ask AI (for example "relatório de melhorias para android
  de hoje") and press Enter. After about 20 s the picks appear with reasons, and the status line
  lists the searches and the date.

## diff-stat-uncommitted: the workspace diff stat counts what `git status` shows

- **Added:** 2026-10-18
- **Commit:** `custom: workspace diff stat counts only uncommitted changes`
- **Why:** The composer pill and the sidebar rows counted the branch against its base
  (`origin/main` on a main checkout), so local commits not yet pushed inflated the number and it
  never matched the Uncommitted count in the Changes sidebar.
- **What:** The workspace diff stat (composer pill, sidebar workspace rows) is the tracked diff
  against HEAD plus the lines of untracked files. Committing makes it drop; pushing does not change
  it. A repository without commits compares against the empty tree. Needs a daemon from this build.
- **Core files touched:** `packages/server/src/utils/checkout-git.ts`
  (`getCheckoutShortstatUncached`, marked `CUSTOM(diff-stat-uncommitted)`; the comparison-ref
  helper it used is removed). Upstream tests that asserted the branch diff in
  `checkout-git.test.ts` and `checkout-git-ref-derived.test.ts` now expect only uncommitted work.
- **Re-apply:** In the uncached shortstat loader, drop the comparison-ref and merge-base lookup and
  run `git diff --shortstat HEAD` (the empty tree when `rev-parse --verify HEAD` fails), keeping the
  untracked-line count. Leave refresh triggers alone: a commit rewrites `.git/index`, which already
  schedules a worktree refresh. Fix the upstream shortstat tests to the new numbers.
- **Verify:** The shortstat tests are in the update script. By hand, after restarting the daemon:
  on a checkout with unpushed commits and a few edits, the composer pill matches the Uncommitted
  total in Changes, and committing brings it to zero.

## bottom-panel-warp: a new bottom panel opens Warp

- **Added:** 2026-10-19
- **Commit:** `custom: a new bottom panel opens Warp`
- **Why:** The bottom panel is where Warp gets used, so opening a terminal there and then switching
  to Warp was a wasted step every time.
- **What:** When Ctrl+J (or the sidebar button) creates the bottom panel, its launcher tab becomes
  the Warp plugin panel, which turns itself into the Warp tab, in workspace mode and in Tasks mode.
  It falls back to a terminal outside Electron or when the workspace's host doesn't have the Warp
  plugin installed. A panel that already exists is only shown or hidden, as before.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel-default.ts` and its test.
- **Core files touched** (marked `CUSTOM(bottom-panel-warp)`):
  - `packages/app/src/screens/workspace/workspace-screen.tsx`: `handleBottomPanelToggle`.
  - `packages/app/src/task-navigation/new-tab-menu.tsx`: the `workspace.bottom-panel.toggle` handler.
- **Re-apply:** Where a `created` bottom panel fills its launcher tab with `createTerminal`, first
  call `resolveBottomPanelWarpTarget({ serverId, plugins: pluginRegistry.getSnapshot(),
isElectron: getIsElectron() })`. If it returns a target, retarget the launcher tab to it
  (`replaceWorkspaceTabTarget` in the workspace screen, `useDesksStore.getState().updateTab` in
  Tasks mode) instead of creating the terminal.
- **Verify:** `(cd packages/app && npx vitest run src/workspace-tabs/bottom-panel-default.test.ts)`.
  In the app, close every tab in the bottom panel and press Ctrl+J: a Warp prompt opens there.

## shell-command-composer: history and Tab completion for `!<command>`

- **Added:** 2026-10-19
- **Commit:** `custom: history and Tab completion for !<command>`
- **Why:** Typing `!<command>` (see [shell-command](#shell-command-run-command-from-the-chat))
  had no shell conveniences: every command was typed in full, and running one again meant finding
  its card.
- **What:** On a one-line composer text that starts with `!`:
  - **Up / Down** walk the commands run before in this project, newest first. What is typed after
    `!` filters them by prefix, like zsh's history-beginning-search (`!git` + Up shows only `git`
    commands). Down past the newest restores the typed text. Up on an empty composer still selects
    the last message for rewind.
  - **Tab** completes. The list only opens on Tab, never while typing. With the cursor at the end,
    past commands that extend the line come first; then files and folders for the word under the
    cursor, resolved on the agent's host like a shell does (`src/co`, `~/`, absolute paths;
    dotfiles only after a `.`; names with spaces come back escaped). A lone `!` lists history only.
    A single match applies directly; several open the list (Up/Down, Tab or Enter picks, Escape
    closes). Files get a trailing space; folders a `/`, so Tab again goes deeper. Typing a space or
    leaving the word closes the list.
  - History is per project, so a project's worktrees share it. An agent without a workspace falls
    back to per-directory history. It is stored on the daemon in
    `$PASEO_HOME/plugin-data/shell-command/history.json`, newest 500 per project, so every
    device sees the same history. Run again on a Terminal card also counts.
  - Desktop and browser only: the composer gets no key events on iOS/Android.
- **Files:**
  - `custom/plugins/shell-command/`: `server/history.ts` (store, project lookup from the
    workspace, cached), `server/complete.ts` (path listing), the `history` and `complete-path`
    RPCs, and an optional `workspaceId` on `run` (also kept on the timeline row for Run again).
  - `packages/app/src/shell-command-composer/`: `model.ts` (line parsing, history stepping,
    completions) and `use-shell-command-completion.ts` (queries, list state, keys). No conflict
    risk.
- **Core files touched** (marked `CUSTOM(shell-command-composer)`):
  - `packages/app/src/hooks/use-agent-autocomplete.ts`: calls `useShellCommandCompletion`, runs
    its `onKeyPress` before the slash/@ list's, and `withShellCompletion` swaps in its list while
    open. `AgentAutocompleteKeyPressEvent` gains `hasModifier`.
  - `packages/app/src/plugins/client-slash-commands/model.ts`: exports `BANG_COMMAND_NAME`.
- **Re-apply:** In the composer's autocomplete hook (the one that owns the slash and @ lists and
  the key handler the composer calls first), call `useShellCommandCompletion` with the agent's
  server and id, the text, cursor, `setUserInput`, and the plugin slash commands. Try its
  `onKeyPress` before the existing one, and while its `isVisible` is true return its options,
  selected index, and `onSelectOption` instead of the slash/@ ones. The composer must pass
  `hasModifier` through to that handler.
- **Verify:** `npx vitest run custom/plugins/shell-command packages/app/src/shell-command-composer`
  and the shell-command e2e test (the update script runs both). In the desktop app, run `!git
status` and `!ls`, type `!g` + Up: `git status` shows. Type `!cat packages/ap` + Tab: it
  completes to `packages/app/`.

## tldr: a TLDR pill that asks the agent for a TLDR

- **Added:** 2026-10-19 (based on upstream 0.11.2, `0d61cca50`). Changed 2026-10-20: Haiku wrote
  the summary into a TLDR row; dropped the same day because the summaries were poor. The pill now
  sends the prompt to the agent.
- **Commit:** `custom: TLDR pill in the composer`
- **Why:** Agents often answer with two pages. One click asks for the short version without typing
  it.
- **What:** Each open agent's composer gets a **TLDR** pill, after the other plugin pills. Clicking
  it sends the saved message (`TLDR` until you change it, see
  [tldr-prompt](#tldr-prompt-the-tldr-pills-chevron-edits-its-message-tldr-sends-it)) to the agent
  as a normal message (`paseo.agents.ref(id).send`), so the agent answers in the chat with its full
  context. While a turn runs, it behaves like any message sent then.
- **Files:** `custom/plugins/tldr/` (client only: `client/pills.ts`; the server entry is empty). No
  conflict risk.
- **Core files touched:** none.
- **Re-apply:** Nothing to re-apply. If upstream changes the plugin API, register one composer pill
  per open agent whose action sends `TLDR` to that agent.
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
- **Verify:** `npx vitest run custom/plugins/tldr` (the update script runs it). In the app, click
  **TLDR** under an agent's composer: `TLDR` shows as your message and the agent answers.

## agent-status-summary: what each agent was asked and where it stands, under the composer

- **Added:** 2026-10-20 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: agent status line under the composer`
- **Why:** With many tabs open, coming back to one meant scrolling up to remember what it was
  about.
- **What:**
  - A line of small, soft text under the composer box (12 px, muted) with the session's topic,
    at most 6 words, like a tab title ("Resumo de sessão em uma frase"). It is plain text, not a
    pill, so it doesn't compete for attention or squeeze the pills; the box moves up about 12 px
    to make room. Hover it (press it on mobile) for the current request and status in full, plus
    when, by which model and at what cost the summary was written. It appears once the agent has
    a summary; summaries from before the topic existed show the request instead.
  - The daemon writes the summary with Haiku through a lean `claude -p` call
    (`lean-claude.ts`: no tools, settings, MCP servers, CLAUDE.md or saved session), about 1-2k
    tokens and $0.0003-0.0007 at list price per call. Not the metadata model: that path starts a
    full Claude Code session per call, 20k-40k tokens of context, and reports no model or cost.
    It runs 4 s after a turn starts, 2 s after it ends, and at most every 3 minutes while a long
    turn keeps producing output. It skips the call when the messages and state are the same as
    last time, runs at most 2 at a time, and never for internal agents.
  - The panel's last line names the model and cost of the call that wrote the summary.
  - **Usage:** every call adds a line to
    `$PASEO_HOME/custom-llm-usage.jsonl` with model, tokens, list-price cost, duration and
    errors. `node custom/llm-usage.mjs` totals calls, tokens and cost per day and feature for
    `~/.paseo` and `~/.paseo-telus` (`--home`, `--days`). The calls are billed to the Claude
    subscription, so the cost is what the API would charge, not money spent.
  - The input is the first user message, the last three, and the activity after the last one
    (about 3k characters), plus the previous summary. "Request" follows the latest messages, so it
    changes when the session changes goal.
  - The summary is also saved in the agent's record, so a daemon restart or an agent reload
    shows the last one (see
    [agent-status-summary-persist](#agent-status-summary-persist-the-line-under-the-composer-survives-restarts)).
- **Files:** `packages/server/src/server/agent-status-summary.ts` (triggers, prompt, queue) and
  `lean-claude.ts` (the `claude -p` runner and usage file), each with a test;
  `packages/app/src/composer/agent-status-line.tsx`; `custom/llm-usage.mjs`. New files; no
  conflict risk.
- **Core files touched** (each marked `CUSTOM(agent-status-summary)`):
  - Protocol `messages.ts`: `AgentStatusSummaryPayloadSchema` (with optional `topic`, `model`
    and `costUsd`) and an optional `statusSummary` on `AgentSnapshotPayloadSchema`.
  - Server: `agent/agent-manager.ts` (`statusSummary` on `ManagedAgentBase`,
    `setStatusSummary`/`getStatusSummary`, which emit state without touching `updatedAt`);
    `agent/agent-projections.ts` (`toAgentPayload` copies it); `bootstrap.ts` (starts and stops
    `AgentStatusSummaries`).
  - App: `stores/session-store.ts` (`Agent.statusSummary`); `utils/agent-snapshots.ts` (both
    mappers copy it); `panels/agent-panel.tsx` (renders `AgentStatusLine` after `<Composer>` in
    `ActiveAgentComposer`).
- **Re-apply:** Add the optional `statusSummary` to the agent snapshot and copy it from the managed
  agent in the payload projection. Start `AgentStatusSummaries` in bootstrap with
  `createLeanClaudeStatusGenerate(config.paseoHome)`. In the app, carry the field through snapshot
  normalization and render `AgentStatusLine` right after the agent composer; its negative top
  margin tucks it into the composer's bottom padding.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent-status-summary.test.ts
src/server/lean-claude.test.ts)` (the update script runs them). On a daemon from this build,
  send an agent a message: a few seconds later the line under the composer box shows the request
  and status, and hovering it names `claude-haiku-5-5`; after the turn ends it updates.
  `node custom/llm-usage.mjs` lists the calls.

## commit-wip: a "Commit: wip" pill beside the diff stat

- **Added:** 2026-10-20 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: Commit: wip pill beside the diff stat`; `custom: Commit: wip waits for the
commit, then offers Git push`
- **Why:** Saving work in progress was typing the same `!git add . && git commit -m 'wip'` again
  and again.
- **What:** Right of the composer's diff stat pill (`+255 -18`), a **Commit: wip** pill runs
  `git add . && git commit -m 'wip'` in the agent's directory, as if typed after `!`
  ([shell-command](#shell-command-run-command-from-the-chat)): the output shows in a Terminal card,
  the command enters the `!` history, and the agent never sees it. The pill always shows, with or
  without changes: gating it on the diff stat hid it at times while there were changes, and with
  nothing to commit git says so in the card. Without the shell-command plugin on the daemon, a
  press shows an error toast. Commits with no confirmation.
  While the command runs the pill fades and ignores presses. A commit that exits 0 turns it into
  **Git push** (runs `git push` the same way); a push that exits 0 turns it back. A failure keeps
  the label, for a retry. Git push turns back into **Commit: wip** when the checkout changes again,
  read from `gitRuntime.isDirty` in the workspace descriptor: it must read clean once first,
  because it can still say dirty right after the commit. The pill opens on Git push when the
  checkout is clean and ahead of its remote (`aheadOfOrigin`). No file watcher: the pill reads the
  `!<command>` card's status from the agent's stream (last 40 items, only while a run is pending)
  and the descriptor the daemon already sends.
- **Core files touched** (marked `CUSTOM(commit-wip)`):
  - `packages/app/src/composer/commit-wip-pill.tsx`: the pill. New file.
  - `packages/app/src/composer/commit-wip-pill-model.ts`: finds the run's card, decides the next
    step. New file, tested in `commit-wip-pill-model.test.ts`.
  - `packages/app/src/panels/agent-tracks.tsx`: renders it (now second in the row, see
    [pill-order](#pill-order-tldr-commit-wip-and-rename-session-lead-the-pill-row)), and
    `hasAgentTracks` returns true so the track row (and its clearance in `agent-panel.tsx`) always
    shows.
  - `packages/app/src/chat-code-run/context.tsx`: the `!<command>` runner moved out of
    `ChatCodeRunProvider` into `useRunChatCommand`, which both use. Its `run` takes an optional
    `onError`, so the pill stops waiting when the command never starts.
- **Re-apply:** In the composer track bar, after the workspace diff stat pill, render a pill that
  always shows (make the track row's "has tracks" check true) and, on press, runs the command
  through the plugin client slash command `sh` (resolve `!<command>` with
  `resolvePluginClientSlashCommand`, run it with `executePluginClientSlashCommand`). To wait for
  it, note the newest shell-command plugin card with the same `data.command` before running, then
  wait for a newer one to leave `running` (`completed` with `exitCode` 0 is success). Flip between
  the commit and `git push` on success; return to commit when `gitRuntime.isDirty` goes false and
  then true.
- **Verify:** Typecheck. In the app, **Commit: wip** shows under every agent's composer. Edit a
  file and press it: the pill fades, a Terminal card shows the commit, the diff stat pill goes away
  and the pill reads **Git push**. Edit a file again: it reads **Commit: wip**. Press Git push: it
  fades, pushes, and reads Commit: wip.

## task-pins: pinned sessions under the Tasks filters

- **Added:** 2026-10-20
- **Commit:** `custom: pinned sessions under the Tasks filters`
- **Why:** A few sessions the user keeps going back to drift around the Tasks sidebar as their state
  changes. Pinning keeps them in one place.
- **What:** Right-clicking a task offers **Pin**, an agent tab **Pin to Tasks** (named apart
  from [tab-pins](#tab-pins-pin-tab-keeps-a-tab-at-the-left-of-its-row)' **Pin tab**); a pinned one
  offers **Unpin** / **Unpin from Tasks** (archived sessions offer neither). Pinned sessions show right under the filter buttons, in pin order, with no
  heading and a divider below, whatever the search, project selection or filter. They also stay
  in their usual place in the list. Only the copy you clicked shows as selected; a session
  opened another way (a tab, Ctrl+1..9) selects its list row. A pinned crew member shows on its own, without its children.
  Pins are task keys (`serverId:agentId`) kept in this app's storage (`custom-task-pins`); the
  daemon knows nothing about them. A pin whose session is archived or gone is skipped.
- **Files:** `task-navigation/pinned-tasks-store.ts`, `pinnedTaskNodes` in
  `task-navigation/model.ts`, `togglePin` in `task-navigation/task-row-menu.tsx`, the
  `ListHeaderComponent` in `task-navigation/sidebar.tsx`, `task-navigation/agent-tab-pin.ts`.
- **Core files touched:** `components/sidebar/sidebar-workspace-menu.tsx` gains an optional
  `pinLabel`, because upstream's workspace pin reads "Pin to top".
  `screens/workspace/workspace-tab-menu.ts` gains an optional `agentPin` input and `pin`/`pin-off`
  icons; `screens/workspace/workspace-desktop-tabs-row.tsx` passes `useAgentTabPin` into it and
  renders the icons (all marked `CUSTOM(task-pins)`).
- **Re-apply:** Pass `isPinned`, `onTogglePin` and `pinLabel="Pin"` from `TaskRowContextMenu` to
  `SidebarWorkspaceContextMenu` (upstream's workspace menu already renders the item). Build the
  pinned nodes from the unfiltered task tree and render them as `TaskRow`s in the list's
  `ListHeaderComponent`, with their own `task-pinned-<agentId>` test ids so the original row's
  `task-agent-<agentId>` stays unique. Remember which copy opened the task and highlight only
  that one. In the tab menu, add the Pin/Unpin entry after Rename for agent tabs, keyed by the
  tab owner's host.
- **Verify:** `model.test.ts` covers `pinnedTaskNodes`. The row menu test in desktop
  `e2e/task-navigation.spec.ts` pins and unpins from the task and the tab menus and checks that
  only the clicked copy is selected. Both are already registered in the update
  script.

## agent-tab-project-icon: agent tabs show the project icon

- **Added:** 2026-10-20
- **Commit:** `custom: agent tabs show the project icon`
- **Why:** With every tab showing the same provider icon, tabs from different projects looked
  alike.
- **What:** Agent tabs (tab strip, tab switcher, drag chip, subagents track) show the icon of the
  agent's project: the uploaded or discovered image, or the colored initial. The status ring and
  dots still sit on top. Until the project resolves, the tab keeps the provider icon.
- **Files:** `panels/agent-project-tab-icon.tsx`. It reuses `resolveComposerProjectIdentity` from
  [composer-project-icon](#composer-project-icon-identify-the-project-beside-context-usage).
- **Core files touched:** `panels/agent-panel.tsx`, in `useAgentPanelDescriptor` (marked
  `CUSTOM(agent-tab-project-icon)`).
- **Re-apply:** In the agent panel descriptor, set `icon` to `useAgentProjectTabIcon(serverId,
agentId) ?? useProviderIcon(provider, serverId)`. Call both hooks unconditionally. The hook
  returns a memoized component, so the tab presentation only changes when the project icon does.
- **Verify:** The row menu test in desktop `e2e/task-navigation.spec.ts` checks the
  `agent-tab-project-icon` inside the agent's Desk tab (already registered in the update script).

## desk-dead-terminals: Desks close tabs of terminals that are gone

- **Added:** 2026-10-21
- **Commit:** `custom: Desks close tabs of terminals that are gone`
- **Why:** Desks persist their tabs locally, but the daemon's terminals die with it. After every
  reboot the Desk restored its terminal tabs (bottom panel included) as blank panes with only a
  cursor. A shell that exited left the same blank tab. The workspace screen already closes those
  tabs (`collapseStaleEntityTabs`); Desks never did.
- **What:** For each workspace that owns a terminal tab in any Desk, the Desk screen keeps that
  workspace's terminal list (the same replica query and push route as the workspace screen). Each
  list fetched or pushed after it mounts closes, in every Desk, that workspace's terminal tabs
  whose terminal isn't in it. A list cached before it mounted is refetched instead of trusted, so
  a script terminal opened a moment before isn't closed.
- **Files:** `packages/app/src/task-navigation/desk-terminal-tabs.tsx`.
- **Core files touched:** none. In the Desk files: `task-navigation/desks-store.ts`
  (`closeDeadTerminalTabs`, marked `CUSTOM(desk-dead-terminals)`) and
  `task-navigation/desk-screen.tsx` (mounts `<DeskTerminalTabs />` next to `DeskVisibleAgents`).
- **Re-apply:** Keep the query key `buildTerminalsQueryKey(serverId, directory, workspaceId)` and
  `workspaceTerminalsPushRoute`, as `useWorkspaceTerminals` uses them: a terminal created from a
  Desk is upserted into that cache before its tab opens. Close tabs only through the store action,
  matching the tab's owner workspace, never all terminal tabs of a host.
- **Verify:** `(cd packages/app && npx vitest run src/task-navigation/store.test.ts)` and the
  desktop `e2e/task-navigation.spec.ts`, which kills the bottom panel's terminal through the daemon
  and expects the pane to go. Both are already registered in the update script. In the app,
  open a terminal in a Desk, type `exit`: the tab closes. After a reboot, no blank terminal tabs.

## new-agent-projects: the + menu's Agent row lists projects on hover

- **Added:** 2026-10-21
- **Commit:** `custom: + menu Agent row opens a project flyout`
- **Why:** Starting an agent in another project meant opening a default agent, then switching its
  project (Ctrl+M, the composer's project icon, or Up). One click from the **+** menu is faster.
- **What:** In the **+** (new tab) menu, a click on **Agent** still opens a default agent where it
  did. Hovering it opens a flyout with every project that has a workspace on that host (icon and
  name, sorted). A click on a project opens a new agent tab in that project: its main checkout, or
  a worktree when it has none. The current project uses the default launch, so a worktree stays
  in its worktree. Workspace mode navigates to that workspace; Tasks mode opens the tab in the
  focused pane of the Desk. Where there is no hover (native, sheets), pressing the row opens the
  project list as before for submenus.
  - Projects with no workspace are listed too (2026-10-22). Adding a project only registers it,
    so a folder added from the Projects page, such as a git worktree added as its own project,
    had no workspace and never showed. Picking one creates a workspace in the project's root
    (`createWorkspace` with a `directory` source and the `projectId`; a worktree gets
    `kind: worktree`), then opens the agent there.
  - Each project shows its main workspace's current branch, small and faint at the right of the
    row (2026-10-23, commit `custom: the new agent project flyout shows each project's branch`).
    Projects with no workspace show none.
- **Files:** `packages/app/src/new-agent-projects/` (`model.ts` picks one workspace per project,
  `menu.tsx` builds the page and launches), with `model.test.ts`.
- **Core files touched** (marked `CUSTOM(new-agent-projects)`):
  - `packages/app/src/components/ui/menu/menu-sub.tsx`: `MenuSubTrigger` takes `onSelect` (a press
    runs it and closes the menu where hover opens the flyout) and `accessory` (shown before the
    chevron, used for the shortcut).
  - `packages/app/src/screens/workspace/workspace-new-tab-menu.tsx`: the `agent` launch item renders
    as a `DropdownMenuSubTrigger`, and the content passes the projects page.
- **Re-apply:** Give the menu engine's sub-trigger an optional press action that applies only on web
  popovers, keeping hover-to-open. In the new-tab menu, render the `agent` launch item through it
  with `buildNewAgentProjectsPage`, passing the item's own launch as `launchDefault`. Keep the page
  content a component so closed menus don't subscribe to projects or icons. Feed the model the
  session's `projects` as well as its workspaces, and create a workspace before launching when a
  project has none.
- **Verify:** `(cd packages/app && npx vitest run src/new-agent-projects/model.test.ts)` and the
  "New agent flyout" test in desktop `e2e/task-navigation.spec.ts` (both in the update script). In
  the app, open **+**, hover **Agent**, click another project: a new agent tab opens with that
  project's icon in the composer.

## session-auto-rename: the status summary names the session, once

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`); reworked 2026-11-04
- **Commits:** `custom: the status summary renames the session`, then
  `custom: auto-rename from the first summary, following it until renamed by hand`, then
  `custom: a session is named once, with at most two words`.
- **Why:** A session's tab title is the first line of its first message, which rarely says what
  the session turned out to be about. The status summary under the composer already knows. A name
  that keeps changing is worse than none, and two words say the subject at a glance.
- **What:**
  - The [agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer)
    call also asks Haiku for a `title` of at most 2 words: a complete name for the subject. The
    reply is clamped to two words (`tidyGeneratedTitle`), and connector words the cut leaves at the
    end ("de", "e", "por", "and", "of"...) are dropped.
  - The daemon renames the session from its first summary, a few seconds after the first message,
    and never again. It only replaces a title that is empty or still the first message's
    provisional title, so a later summary, a rename by hand and an explicit title from the CLI/MCP
    all leave the name alone, daemon restarts included.
  - A **Rename session** pill right of **Commit: wip** renames the session to the current summary
    title on demand (falling back to the topic for older summaries). It is a manual rename: it no
    longer hands the title back to the auto-rename. With no summary yet, it shows an error toast.
  - **History:** until 2026-10-25 the rename waited for the third user message. Until 2026-11-04
    the title had 2 to 4 words and followed the summary while it was the one this feature wrote.
- **Core files touched** (marked `CUSTOM(session-auto-rename)`):
  - Protocol `messages.ts`: optional `title` on `AgentStatusSummaryPayloadSchema`.
  - Server `agent-status-summary.ts`: the `title` field in the prompt and reply,
    `tidyGeneratedTitle` and `maybeAutoRename`; `agent/create-agent-title.ts`: `clampTitleWords`
    takes an optional word limit; `bootstrap.ts` passes `agentStorage` to `AgentStatusSummaries`.
  - App `composer/rename-session-pill.tsx` (new) and `panels/agent-tracks.tsx` (renders it after
    `CommitWipPill`).
- **Re-apply:** Depends on agent-status-summary and commit-wip. Add `title` to the summary prompt
  ("at most 2 words"), schema and payload. After storing a summary, call `agentManager.setTitle`
  with its title only when the stored title is empty or equals
  `resolveCreateAgentTitles({ initialPrompt: firstUserMessage }).provisionalTitle`. In the app, a
  pill after Commit: wip calls `client.updateAgent(agentId, { name: summary.title })`.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent-status-summary.test.ts)`
  (already in the update script) covers the first rename, the name staying after later summaries,
  the kept manual title and the two-word tidying. In the app, send a fresh agent a message: a few
  seconds later its tab title changes to a name of up to 2 words. Send more messages that change
  the subject: the title stays. Needs the daemons restarted.

## status-topic-breadcrumb: the line under the composer keeps the first topic

- **Added:** 2026-11-07 (based on upstream 0.14.0)
- **Commit:** `custom: status line shows first topic › current topic`
- **Why:** The [agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer)
  topic changed with every summary, so the line under the composer lost what the session started
  as and was confusing to read.
- **What:** The daemon saves the first summary's topic as `firstTopic` and carries it into every
  later summary. From the second summary on, once the topic differs, the line reads
  `first topic › current topic` (the Tasks sidebar hover card too). A summary from before this
  change promotes its topic to `firstTopic` on the next summary.
- **Core files touched** (marked `CUSTOM(status-topic-breadcrumb)`):
  - Protocol `messages.ts`: optional `firstTopic` on `AgentStatusSummaryPayloadSchema`.
  - Server `agent-status-summary.ts`: `generate` sets `firstTopic` from the previous summary
    (`previous.firstTopic ?? previous.topic`), or from the new topic when there is none.
  - App `composer/agent-status-line.tsx`: `formatSummaryTopic`.
- **Re-apply:** Add the optional field, set it in the daemon before `setStatusSummary`, and render
  `${firstTopic} › ${topic}` when both exist and differ.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent-status-summary.test.ts)`
  (already in the update script). In the app, send an agent two messages on different subjects:
  after the second summary the line reads `first › current`. Needs the daemons restarted.

## agent-status-summary-persist: the line under the composer survives restarts

- **Added:** 2026-10-23 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: the status summary survives daemon restarts`
- **Why:** The [agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer)
  line lived only in daemon memory. Whenever the daemon restarted (closing Paseo, an update,
  `kill-paseos-and-daemons.sh`), every tab came back without its line until the agent's next turn.
- **What:** Each new summary is also written to the agent's JSON record (`statusSummary`). Agent
  payloads built from a record, or from a loaded agent that has no summary in memory yet, carry
  the stored one. The next summary call gets it as the previous summary.
- **Core files touched** (marked `CUSTOM(agent-status-summary-persist)`):
  - Server `agent/agent-storage.ts`: optional `statusSummary` in the stored schema,
    `setStatusSummary`, and `applySnapshot` keeps the existing one (snapshots don't carry it).
  - `agent/agent-manager.ts`: `setStatusSummary` also persists it (not for internal agents).
  - `agent/agent-projections.ts`: `buildStoredAgentPayload` copies it.
  - `session.ts`: `enrichAgentPayload` fills it from the record when the live agent has none.
  - `agent-status-summary.ts`: the previous summary falls back to the stored one.
- **Re-apply:** Add `statusSummary` (the protocol's `AgentStatusSummaryPayloadSchema`, optional)
  to the stored agent record. Write it from `AgentManager.setStatusSummary` through a storage
  mutation on the existing record, keep it across `applySnapshot`, and read it wherever a payload
  comes from a record or is enriched from one. No protocol change.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent/agent-storage.test.ts -t "keeps the status summary")`
  (in the update script). In the app: wait for a summary line, run `kill-paseos-and-daemons.sh`;
  after the restart the line is back before the agent does anything.

## draft-agent-title: New Agent tabs show the project icon and can be named

- **Added:** 2026-10-23 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: New Agent tabs show the project icon and take a name`
- **Why:** A New Agent tab showed a generic pencil, so several drafts in different projects looked
  the same; and naming a session meant waiting for the agent to exist.
- **What:**
  - The New Agent tab shows its workspace's project icon (the same as
    [agent-tab-project-icon](#agent-tab-project-icon-agent-tabs-show-the-project-icon)), falling
    back to the pencil. A Desk draft moved to another project (Ctrl+M, the composer's project
    icon) switches icon with it; a new project icon shows as soon as it is set.
  - Its context menu has **Rename**, and F2 renames it too. The name shows as the tab label and is
    kept in this app's storage (`custom-draft-agent-titles`) until the agent is created.
  - The agent is created with the name as its explicit `config.title`. The daemon keeps an
    explicit title instead of deriving one from the prompt, and
    [session-auto-rename](#session-auto-rename-the-status-summary-names-the-session) never
    replaces a title that differs from the prompt-derived one, so the LLM never renames it.
- **Files:** `packages/app/src/draft-agent-title/store.ts` (`withDraftAgentTitle`).
- **Core files touched** (marked `CUSTOM(draft-agent-title)`):
  - `panels/agent-panel.tsx` (`useDraftPanelDescriptor`: icon and title) and
    `panels/draft-panel-descriptor.ts` (optional `title`).
  - `panels/agent-project-tab-icon.tsx`: `useWorkspaceProjectTabIcon`, which the agent hook now
    calls.
  - `screens/workspace/use-workspace-tab-rename.tsx`: a `draft` rename kind that writes the store.
  - `screens/workspace/workspace-tab-menu.ts`: Rename for draft tabs.
  - `composer/draft/workspace-tab.tsx`: `withDraftAgentTitle` on the create config; clears the
    name after creation.
- **Re-apply:** In the draft panel descriptor, resolve the project icon from the descriptor
  context's `workspaceId` and use the stored name as label. Let the tab rename hook handle draft
  targets locally. Pass the name as `config.title` when the draft creates its agent.
- **Verify:** `(cd packages/app && npx vitest run src/panels/agent-panel-descriptor.test.tsx src/screens/workspace/workspace-tab-menu.test.ts)`
  (in the update script). In the app, open a New Agent tab: it shows the project icon. Right-click
  it, Rename to "Auth fix", send a prompt: the agent tab stays "Auth fix" after three messages.

## tab-pins: "Pin tab" keeps a tab at the left of its row

- **Added:** 2026-10-23 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: Pin tab in the tab context menu`
- **Why:** The tabs the user keeps going back to drift around the row as others open and close.
- **What:** Right-clicking any tab offers **Pin tab** (**Unpin tab** when pinned): after Rename,
  right before **Pin to Tasks** on agent tabs; before the close actions on tabs without Rename. Pinning
  moves the tab right after the pinned tabs already at the left; unpinning moves it to the start of
  the unpinned ones. At rest (not active, not hovered) a pinned tab is a shade darker than the row:
  black at 32% in dark themes, 7% in light ones. Pins are per workspace and per Desk (the split
  layout's `workspaceKey`), kept in this app's storage (`custom-tab-pins`), and work in every pane
  and the bottom panel. Dragging still moves pinned tabs freely; only pin and unpin reorder.
- **Files:** `packages/app/src/tab-pins/` (`model.ts` reorders, `store.ts`, `use-tab-pins.ts`),
  with `model.test.ts`.
- **Core files touched** (marked `CUSTOM(tab-pins)`):
  - `components/split-container.tsx`: `SplitPaneView` takes `pinScope={workspaceKey}` and passes
    it to its tab row.
  - `screens/workspace/workspace-screen.tsx`: the fallback tab row gets `pinScope={persistenceKey}`.
  - `screens/workspace/workspace-tab-menu.ts`: optional `tabPin` input and its entry after Rename;
    the task pin entry reads **Pin to Tasks**.
  - `screens/workspace/workspace-desktop-tabs-row.tsx`: the optional `pinScope` prop;
    `WorkspaceDesktopTabsRow` builds the toggle over all its tabs and reorders through
    `onReorderTabs`; the chip gets the `tabPinned` style and `data-tab-pin="pinned"`.
- **Re-apply:** Pass the split layout's workspace key to its tab rows as `pinScope` (a row without
  one offers no pin). In the tab row, pass `{ pinned, toggle }` into the tab menu builder; the
  toggle updates the store and calls the row's `onReorderTabs` with `reorderForPinToggle`. Add the
  darker style to the chip when pinned and neither active nor hovered.
- **Verify:** `(cd packages/app && npx vitest run src/tab-pins/model.test.ts src/screens/workspace/workspace-tab-menu.test.ts)`
  and the first test of desktop `e2e/task-navigation.spec.ts` (pins the last Desk tab and expects
  it first), all in the update script. In the app, pin the third tab: it moves first and darkens;
  pin another: it sits second.

## bottom-panel-warp-tab-button: a + in the bottom panel's Warp chip opens a Warp tab in the agent's project

- **Added:** 2026-10-23 (based on upstream 0.11.2, `7f9b65d46`)
- **Commits:** `custom: a bottom panel button opens a tab inside Warp in the agent's project`,
  `custom: the new Warp tab button moves into the Warp tab chip as a +`, then
  `custom: the Warp chip's + sits a space after the label, clear of the ×`. It replaces
  `desk-bottom-panel-warp` (commits `custom: showing the Tasks bottom panel opens Warp in the
task's workspace` and `custom: showing the Tasks bottom panel opens a session inside Warp in the
task's folder`), which did this on every show of the panel and never opened the Warp tab: the
  Ctrl+Shift+T it sent through `sendInputEvent` didn't reach Warp. Showing the panel only shows it
  again.
- **Why:** In Tasks mode one bottom panel serves every task, so its Warp shells sit in whatever
  folder they started in. The + gives a shell in the current agent's project in one click.
- **What:** Every Warp tab chip in the bottom panel has a `+` about a space after its label, with
  20px clear before the `×`, so hovering the chip never covers it. Clicking it selects that Warp tab and opens a new tab inside Warp in the
  agent's project folder: in Tasks mode the workspace of the last focused agent tab
  ([desk-context-tab](#desk-context-tab-the-explorer-follows-the-last-focused-agent-tab)), in a
  workspace the workspace itself. Its accessibility label names the folder.
- **How the Warp tab opens:** the Warp patch `PASEO: the host page opens a terminal tab with a
paseo-warp-new-tab event` listens for that window event. Paseo runs `executeJavaScript` on the
  webview to set the `cwd` of `window.PASEO_WARP_PTY_URL`, which Warp reads for every new session,
  and dispatch the event. Warp tabs whose page loaded before that Warp build ignore the event until
  reloaded.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel-warp-tab-button.tsx` (the `+`) and
  `packages/app/src/workspace-tabs/warp-session.ts`.
- **Core files touched** (marked `CUSTOM(bottom-panel-warp-tab-button)`):
  - `screens/workspace/workspace-desktop-tabs-row.tsx`: in the `bottom-panel` pane the row finds
    its Warp tabs (browser tabs with `hideToolbar`), adds `WARP_CHIP_NEW_TAB_WIDTH` to their label
    width (`actionWidth` on `WorkspaceTabLabel`) so the label ends before the `+`, and passes
    `warpNewTabWorkspaceId` through `ResolvedDesktopTabChip` to `TabChip`, which renders
    `WarpChipNewTabButton` after the close overlay.
- **Re-apply:** Give the bottom panel's Warp tab chips an absolutely positioned `+` that opens a
  session with `openWarpSession`, and widen those chips by its width in the row's tab measurement,
  or the label runs under it.
- **Verify:** No unit test: the logic is the chip wiring and the Warp page call. In the app, with
  a Warp tab in the bottom panel, focus an agent of another project and click the `+` in the Warp
  chip: a new tab opens inside Warp, and `pwd` prints that project's folder. Hover the chip: the
  `+` stays put, 20px left of the `×`.

## btw: `/btw` asks about the session without interrupting the agent

- **Added:** 2026-10-23 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: /btw asks about the session from a fork of its live context`
- **Why:** Claude Code's `/btw`: ask "what did you change so far?" while the agent works, without
  queueing a message, stopping the turn or adding the question to its history.
- **What:** `/btw <question>` in a Claude agent's composer adds a **BTW** card to the chat with the
  question; about a second later the answer fills it in (plain text, selectable, Copy). It works
  while a turn runs. The agent never sees the question or the answer.
  - The daemon calls `askSideQuestion` on the agent's live Claude Agent SDK `Query`: the
    `side_question` control request Claude Code's own `/btw` uses. The CLI answers from a fork of
    the live context, with no tools and outside the transcript. Same process, model, system prompt
    and tools as the main session, so the request reuses its prompt cache. The SDK ships the method
    without declaring it in `sdk.d.ts`; the provider types it locally.
  - An idle agent with no running CLI gets one started (resume), as `listCommands` does.
  - Other providers answer with an error in the card.
  - Cards live in daemon memory, like other plugin rows: a daemon restart drops them.
- **Files:** `custom/plugins/btw/` (slash command `btw`, RPC `ask`, card renderer, `answeredData`
  test); `packages/server/src/server/plugins/custom-btw-plugin.e2e.test.ts`. New files.
- **Core files touched** (each marked `CUSTOM(btw)`):
  - Protocol `messages.ts`: `agent.side_question.request` / `.response` (`answer`, `error`) in the
    session unions, `AgentSideQuestionResponse`, and `features.agentSideQuestion`.
  - Server: `agent/agent-sdk-types.ts` (optional `AgentSession.askSideQuestion`),
    `agent/provider-registry.ts` (binds it), `agent/providers/claude/agent.ts` (calls
    `query.askSideQuestion`), `session.ts` (`handleAgentSideQuestion`, chained in
    `dispatchWorkspaceLifecycleMessage` next to History AI search), `websocket-server.ts`
    (advertises the feature), `authorization/operation-permissions.ts` (same permissions as
    `send_agent_message`), `test-utils/fake-agent-client.ts` (echo answer for tests).
  - Client: `daemon-client.ts` `askAgentSideQuestion`; `index.ts` `PaseoAgentHandle.askSideQuestion`,
    which the plugin's server handler calls.
- **Re-apply:** Add the RPC pair gated on a feature flag. In the session, load the unarchived agent
  and call the optional `askSideQuestion` on its session; the Claude session gets it from
  `ensureQuery()` and the SDK's `query.askSideQuestion(question)` (`{ response } | null`). Expose it
  on the SDK agent handle for the plugin. If a newer SDK declares `askSideQuestion` on `Query`, drop
  the local type.
- **Setup:** One-time plugin install per daemon. See [README.md](README.md#one-time-setup-plugins).
  Needs a daemon from this build (otherwise the card says "Update the host to use /btw.").
- **Verify:** `npx vitest run custom/plugins/btw` and
  `(cd packages/server && npx vitest run src/server/plugins/custom-btw-plugin.e2e.test.ts)` (the
  update script runs both). In the app, while a Claude agent runs a long command, send
  `/btw what are you doing right now?`: a BTW card answers in about a second and the turn goes on.

## btw-actions: follow-ups, TLDR, branch and copy icons in the BTW card

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: the BTW card asks follow-ups, TLDRs and branches into a tab`
- **Why:** A /btw answer often needs one more question, a shorter version, or turns into real work
  worth its own session.
- **What:** Under the answer of a [btw](#btw-btw-asks-about-the-session-without-interrupting-the-agent)
  card:
  - Right side, left to right: **TLDR** (list icon), **branch** (the chat's fork icon), then 25px
    later **copy** (the latest answer).
  - **TLDR** asks the side thread for the gist of its last answer; it shows in the same card.
  - **Ask follow up** on the left opens, under it, a half-width composer: dictation, **+** to
    upload files, send, Esc closes. The answer lands in the same card. Side questions take text
    only, so the daemon inlines attached text files into the question (64 KiB each); images and
    binary files go in as a note that they were left out.
  - Follow-ups and TLDR pass the card's earlier answered questions as `history` of Claude Code's
    `side_question`, so the fork answers in the thread.
  - **Branch** forks the whole chat (no boundary, so it includes a running turn) and appends the
    card as text: every question, follow-up, attached file name and answer.
  - In Tasks mode every fork button (this one and the one on assistant replies) opens the branch in
    a tab right away, without the "new tab or new workspace" menu.
  - Cards from before this change have no `id` in their data and show no actions.
- **Files:** `custom/plugins/btw/` (`follow-up` RPC in `server/ask.ts`, thread helpers in
  `shared/btw.ts`, card in `client/btw-card.tsx`). New in the app:
  `packages/app/src/plugins/react-native/host-components.tsx`, `follow-up-composer.impl.tsx`,
  `agent-fork-menu.impl.tsx`.
- **Core files touched** (marked `CUSTOM(btw-actions)` or `CUSTOM(btw)`):
  - Protocol `messages.ts`: optional `history` on `agent.side_question.request`. Client
    `daemon-client.ts` `askAgentSideQuestion(agentId, question, { requestId, history })` and
    `index.ts` `askSideQuestion(question, { history })`. Server `session.ts`,
    `agent-sdk-types.ts`, `providers/claude/agent.ts` (maps `answer` to the SDK's `response`),
    `test-utils/fake-agent-client.ts` (echoes how many history turns it got).
  - Plugin SDK `packages/plugin/src/client/react-native.ts`: declares `FollowUpComposer` and
    `AgentForkMenu`; `packages/app/src/plugins/react-native/runtime.ts` supplies them.
  - `hooks/use-fork-agent.ts`: optional `extraContext`, appended to the chat history attachment.
  - `components/assistant-fork-menu.tsx`: in Tasks mode, a plain button that forks into a tab.
- **Re-apply:** Add the optional `history` array to the side question request and thread it to
  `query.askSideQuestion(question, { history: [{ question, response }] })`. Lend the plugin two app
  components through the plugin react-native runtime: the chat `MessageInput` with a file-only
  attachment menu, and `AssistantForkMenu` driving `useForkAgent` with `extraContext`. In
  `AssistantForkMenu`, when `useTaskNavigationStore` is enabled, render a button that calls
  `onFork("tab")`.
- **Setup:** `plugin reload btw` on each daemon, and a daemon from this build for the follow-up
  history (an older daemon answers each follow-up without the thread).
- **Verify:** `npx vitest run custom/plugins/btw` and
  `(cd packages/server && npx vitest run src/server/plugins/custom-btw-plugin.e2e.test.ts)` (the
  update script runs both). In the app, `/btw what changed?`, then **Ask follow up** "and why?"
  with a text file attached, then the TLDR icon: both answers land in the card. Branch: a new tab
  whose draft carries the chat history ending with the BTW thread. Turn on Tasks and press a fork
  icon on an assistant reply: it opens a tab with no menu.

## attachment-thumbnail-zoom: hovering an image thumbnail shows it magnified

- **Added:** 2026-10-24 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: hovering an image attachment thumbnail shows it magnified`
- **Why:** A pasted screenshot shows as a 48px square crop, too small to tell what was pasted
  without opening the lightbox.
- **What:** On web and desktop, hovering an image thumbnail (composer and sent messages) opens a
  card above it with the whole image, uncropped: the short side at 6× the thumbnail (288px), the
  long side up to 3× that (864px), shrinking both past that ratio. It uses the app's `HoverCard`,
  so it closes when the pointer leaves and never shows on native.
- **Files:** `packages/app/src/attachments/attachment-thumbnail-zoom.tsx` (the hover card) and
  `attachment-thumbnail-zoom-size.ts` (+ test). New files.
- **Core files touched** (marked `CUSTOM(attachment-thumbnail-zoom)`):
  - `components/attachment-pill.tsx`: `AttachmentThumbnail` wraps its `Image` in
    `AttachmentThumbnailZoom`.
- **Re-apply:** Wrap the image of the attachment thumbnail component in a `HoverCard` whose
  content is the same URI at `computeAttachmentZoomSize`, placed on top.
- **Verify:** `(cd packages/app && npx vitest run src/attachments/attachment-thumbnail-zoom-size.test.ts)`
  (the update script runs it). In the app, paste a screenshot in the composer and hover its
  thumbnail: the whole image shows above it, and leaving the thumbnail closes it.

## chat-file-actions: file links in the chat resolve to full paths and get a hover card of actions

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: chat file links resolve against the session's files and get hover actions`
- **Why:** Agents name files by basename or by a path relative to wherever they were working
  (`deploy.sh`, `out/report.html`), so a link could open the wrong file or nothing, and a script
  could only be run by typing its path by hand.
- **What:**
  - **Session file paths.** A chat file link first matches the files the agent's tool calls touched
    in this session (Read, Edit and Write `filePath`, Search `filePaths`, and every file name with
    an extension in a Shell command, after its `cd`: `shellMentionedFiles` in
    `components/shell-output-files.ts`), newest first: the same relative path, or a full path
    ending in `/<link>`. Only then the workspace and the daemon's suffix lookup, as upstream does.
    This finds files outside the workspace too. Shell commands count because agents often work
    with `cd <dir>; grep … file.html` and then name the file by its basename; before 2026-11-10 a
    file touched only that way, outside the workspace, never resolved.
  - **Hover card.** On web and desktop, resting the pointer on a file link for 200 ms opens a card
    with icons first and the full path after them. The card opens with its first icon right above
    the pointer (`pointerAnchorOffset`), shifting left only when the screen's right edge is near: **Copiar caminho completo** and **Abrir em aba** (what clicking
    the link does) for every file; for a `.sh`, **Executar aqui** (the shell-command plugin, as
    `!cd <folder> && bash ./<script>`) and **Executar no Warp** (a new tab inside the bottom
    panel's Warp, in the script's folder, running `bash ./<script>`); for `.html`,
    **Abrir no navegador**; for anything else,
    **Abrir no gerenciador de arquivos** (Electron's `shell.showItemInFolder`). Browser and file
    manager only show for the local desktop host; Warp only in Electron with the Warp plugin.
  - **Web links** get the same card (`UrlHoverActions`): **Copiar link** (the same Copy icon as
    files; a chain-link icon read as "open"), **Abrir em aba** (a Paseo browser tab of the chat's
    workspace, Electron only), **Abrir no navegador** (what clicking does) and **Novo agente com
    este link** (see link-new-agent), then the URL (a markdown link shows its target).
    `useFileLink` returns `externalUrl` for them.
  - Every action closes the card (`useHoverCardClose`): after **Abrir em aba** the link is hidden
    behind the new tab, the pointer never "leaves" it, and the card stayed up over the new tab.
  - The card also closes, in the same render, when its retained chat goes inactive, and can't open
    while it is. A hidden chat freezes one commit later (`retained-chat-content.web.tsx`,
    react-freeze); a card still open then could never commit its close and stayed in the
    workspace's portal host over the new tab until that tab closed. Tooltip already gated itself
    this way. `hover-card.browser.test.tsx` reproduces it.
  - While the daemon's suffix lookup runs, the card says **Procurando arquivo…**; when it finds
    nothing (`useFileLink`'s `lookupFailed`), **Arquivo não encontrado na pasta do workspace**.
    Before, a failed lookup left "Procurando arquivo…" up forever.
  - When the daemon's suffix lookup finds a `.sh` (it wasn't a session file) and more than one file
    matches, the card lists each match with its own actions instead of guessing.
  - **Executar no Warp** shows the bottom panel and selects its Warp tab. Without a bottom panel it
    runs Ctrl+J's action, which opens Warp there, and waits up to 20 s for the page. A bottom panel
    without a Warp tab gets a toast instead.
  - Labels are Portuguese only.
- **How the command reaches Warp:** `openWarpSession` adds `run` and a fresh `run_id` to
  `window.PASEO_WARP_PTY_URL`. The Warp bridge (`paseo-bridge/server.mjs`, commit `PASEO: the
bridge types a command into a new session after Warp bootstraps it`) types the command into
  that session once per `run_id`. See `docs/custom-warp-web-embedded.md`.
- **Files:** `packages/app/src/assistant-file-links/session-paths.ts` (+ test),
  `hover-actions.tsx`, `hover-actions-model.ts` (+ test), and
  `packages/app/src/workspace-tabs/warp-run.ts`. New files.
- **Core files touched** (marked `CUSTOM(session-file-paths)` or `CUSTOM(chat-file-actions)`):
  - `assistant-file-links/resolver.ts`: `classifyForResolution` checks `context.sessionPaths`
    right after the external-link case.
  - `assistant-file-links/provider.tsx` and `use-file-link.ts`: carry `sessionPaths` (also in the
    context value, so links re-resolve) and return `lookupQuery`.
  - `assistant-file-links/link.tsx`: upstream 0.14 deleted it; the fork keeps it for
    `wrapWithFileLinkHover(source, useFileLink result, anchor)` (file links get
    `FileLinkHoverActions`, web links `UrlHoverActions`, anything else null) and the standalone
    `AssistantMarkdownCodeLink` of shell-output-files.
  - `components/markdown/renderers.web.tsx`: `WebLink` returns `wrapWithFileLinkHover(...)` when
    it is not null, instead of the path tooltip.
  - `agent-stream/view.tsx`: `useSessionFilePaths` over the stream, passed to the provider.
  - `components/ui/hover-card.tsx`: `openDelayMs` on `HoverCard`, `style` on `HoverCardTrigger`,
    `useHoverCardClose()`, `pointerAnchorOffset` on `HoverCardContent` (the trigger tracks the
    pointer's x until the card opens), and `open` gated on `useRetainedPanelActive()` with an
    effect that closes the card when the panel goes inactive. Test in
    `hover-card.browser.test.tsx`.
  - `chat-code-run/context.tsx`: `ChatCodeRunProvider` also provides `useChatWorkspace()`.
  - `screens/workspace/workspace-tab-menu-actions.ts`: exports `resolveFullTabFilePath`.
  - `workspace-tabs/warp-session.ts`: `openWarpSession` takes an optional command.
  - Desktop: `features/file-opener.ts` gains mode `reveal` (+ test in `opener.test.ts`),
    `main.ts` passes `shell.showItemInFolder`, and the mode type in `preload.ts` and the app's
    `desktop/host.ts`.
- **Re-apply:** Pass the agent's tool-call file paths to the chat's file link resolver and match
  them before the workspace lookup. Wrap web file links in a `HoverCard` whose content gets the
  chat's contexts as props: the card renders in a portal, outside the chat's providers (resolver,
  run command, keyboard dispatcher, query client), and throws if it reads them itself. The web
  Markdown link renderer (`WebLink` in `components/markdown/renderers.web.tsx` since 0.14) is
  where the wrapping happens; keep the upstream tooltip for links that are neither.
- **Verify:** `(cd packages/app && npx vitest run src/assistant-file-links/session-paths.test.ts src/assistant-file-links/hover-actions-model.test.ts src/assistant-file-links/use-file-link.test.tsx src/components/shell-output-files.test.ts)`
  and the desktop opener test (the update script runs both). In the app, have an agent read a
  `.sh` outside the workspace and name it by basename in backticks; hover it: the card shows its
  full path, and **Executar aqui** prints the script's folder for `pwd`. **Executar no Warp** opens
  a Warp tab in that folder with the script running as its first block.

## desk-close-returns: closing a tab in Tasks mode returns to the tab it was opened from

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: closing a Desk tab returns to the tab it was opened from`
- **Why:** Opening a file from the chat in Tasks mode and closing it landed on the tab next to it,
  not on the agent the user came from.
- **What:** In Tasks mode, a tab opened while another had focus (a file from the chat, an agent from
  the sidebar, a new terminal) records that tab as its parent. Closing it focuses the parent while
  it is still open, else the neighbor as before. Workspace mode already did this for chat files:
  the workspace screen passes `parentTabId` when it opens them.
- **Core files touched** (marked `CUSTOM(desk-close-returns)`):
  - `packages/app/src/task-navigation/desks-store.ts`: `openInDesk` wraps the old body
    (`openInDeskWithoutParent`) and sets `layout.parentTabIdByTabId[opened] = previous`.
  - `task-navigation/store.test.ts`: a test for it.
- **Re-apply:** Where Desks open a tab, remember the focused tab before and record it in the
  layout's `parentTabIdByTabId` for the tab focused after. `closeTabInLayout` already prefers an
  open parent.
- **Verify:** `(cd packages/app && npx vitest run src/task-navigation/store.test.ts)` (the update
  script runs it). In Tasks mode, from an agent tab with other tabs to its right, click a file in
  the chat, then close the file tab: the agent tab gets focus.

## power-workboard: a board of registered tasks with an agent orchestrator

- **Added:** 2026-10-25 (based on upstream 0.11.2). It started as a copy of our patched
  [fxbing/paseo-workboard](https://github.com/fxbing/paseo-workboard) 0.2.0 (`custom/plugins/workboard`,
  plugin id `paseo-workboard`), which was then removed from the repo and from both daemons. The
  old board is saved in `<home>/plugin-settings.bak-workboard-20261025/`.
- **Commit:** `custom: Power Workboard replaces Workboard, with a review step and a tab beside the Desks`
- **Why:** Workboard imports every Paseo workspace as a task (280+ cards) and watches all of them.
  We want a board that only holds tasks created on it, and an orchestrator that hands them to
  agents and brings their work back for review.
- **What:**
  - Plugin id `power-workboard` (folder `custom/plugins/power-workboard`), its own storage
    (`plugin-settings/power-workboard`, images in `plugin-data/power-workboard/images/`).
  - **On by default:** the update script installs it on every daemon home with plugins enabled
    that has no entry for it. A daemon where the user disabled it keeps it disabled.
  - **No import:** a workspace enters the board only when one of its tasks starts work on it
    (Start work, or the orchestrator). The host inventory, conversation reads, provider-child
    listings and pins only cover those workspaces; changes and agent streams elsewhere are ignored.
  - **Groups:** Backlog, Ready to start, In progress, Ready to review, Done, on labels `pwb:*`, so
    the original Workboard never saw them as its own (Ready to start is a new draft kind, `ready`;
    a board saved without it gets it after Backlog on load). Inbox and Canceled are no longer
    required (a Canceled group can still be added; archiving a draft needs one).
  - **Refinement:** a draft's **Refine** button opens a real agent chat in the task's project
    folder (mode `default`, so it asks before any edit), primed with the title and description.
    `/write-ticket [focus]` in that chat (a plugin slash command) asks the agent for the final
    ticket between `<ticket>` tags; when its turn ends the plugin replaces the draft's title and
    description with it. The card shows the refinement state; moving it to Ready to start is
    still the user's call. Reopening uses the same chat while its agent is not archived.
  - **Orchestrators:** the board screen has tabs: **Board**, **Orchestrators** (the admin
    panel), and one closable tab per opened orchestrator. Create as many as needed. Each one has a
    name, a project (or all projects), a schedule, how many tasks at a time, how many tasks per
    run, the agent (`provider/model`, mode, thinking), worktree or project folder, and
    instructions prepended to every task prompt. Schedules (daemon host's local time):
    **Manual** (only **Run now**), **Time window** (days plus from/to; keeps taking tasks while
    open, an end before the start crosses midnight), **Daily times** (days plus `HH:MM` list; each
    time starts one run, a trigger missed by more than an hour is skipped). A run (Run now or a
    daily time) takes up to its batch, as many at a time as its limit allows, and ends when the
    batch is used or Ready to start has nothing for it; **Stop** ends it. Disabling an orchestrator
    stops its schedule; Run now still works. There is no global Play any more.
  - **Which orchestrator takes a task:** the one chosen in the task editor (a chip row under the
    projects); a task sent back from review stays with the one that ran it; otherwise the first
    orchestrator in the list whose project matches (or that covers all projects). Tasks are taken
    from the top of Ready to start. Moving a task there, or editing it, triggers a pass at once;
    otherwise passes run with the minute refresh. A task without a project takes its
    orchestrator's. A task with no project at all, or whose start fails, shows the error on its
    card and is retried after it is edited. Deleting an orchestrator sets its tasks back to
    automatic.
  - **Starting a task:** a workspace in the task's project (a worktree for git projects), the
    task moves to In progress, and an agent starts whose first message is the title and
    description. When the agent's turn ends the task moves to Ready to review with the agent's
    last reply. The card names the orchestrator and has an **Open agent** link that opens the
    agent's chat, like clicking it in the sidebar.
  - **Orchestrator tab:** the settings form (Save), Run now / Stop, Delete, the tasks it runs now
    with Open agent links, and its log (newest first, last 100 entries: runs, starts, finishes,
    skips and errors, each with an Open agent link when it has an agent). Start work on a card
    still works by hand, from any draft group.
  - **Review:** a Ready to review card asks like an agent's question: the agent's last reply
    (Show more past six lines), then **Done** and **Continue task**. Done moves it to the first
    Done group. Continue task opens a feedback field; **Send back** moves the task, workspace and
    all, to the first Ready to start group with status `queued` and the feedback. The next pass of
    the orchestrator that ran it (right away when it is active; otherwise its next run or window)
    sends the feedback to the same agent, or starts a new one in the workspace with the task and
    the feedback when the agent is gone, and moves the task to In progress. A queued task takes a
    slot like a new one, in column order.
  - **Done:** marking a task Done changes only its group; its work stays in the worktree. A Done
    card in a git project shows three buttons, each the user's call: **Commit** (everything
    uncommitted, with a generated message), **PR description** (asks the task's agent through a
    side question, which stays out of its history, and shows the title and body with **Copy
    description**; no PR is created), and **Merge into project** (commits what is left, then merges
    the branch into the project's base branch in the main checkout). The card shows the step
    running, Committed or Merged, or the git error. Commit and merge are the daemon's own
    `checkout_commit` and `checkout_merge` requests, the same as the app's Git menu; results are in
    `finishes`. The workspace is not archived.
  - **Task editor:** New task and Edit open at 80% of the window (see
    [plugin-modal-size](#plugin-modal-size-plugin-modals-at-80-of-the-window)), with a bold title,
    a description that takes the free height, and Ctrl+Enter to save. A **+** under the
    description inserts an image from a file (web and desktop, same upload as pasting), a
    checklist item, an Acceptance criteria section or an Out of scope section at the cursor.
    Project and orchestrator chips wrap instead of scrolling sideways; each project has its own
    color (from its id, `projectColor` in `client/colors.ts`). A new task picks **Create in**:
    its To do group or Ready to start, where an active orchestrator takes it at once.
  - **Default orchestrator:** a board with no orchestrators gets one named Default when it loads:
    all projects, always on (a window from 00:00 to 00:00 every day), 2 at a time, with the agent
    defaults. `defaultOrchestratorSeeded` keeps it from coming back after it is deleted.
  - **Tab and images** (from the patched Workboard): the board is also a workspace panel ("+"
    new-tab menu, or "Open Power Workboard tab" in the Command Center). Pasting an image into a
    task description uploads it to the daemon and inserts `![image](<absolute path>)`; thumbnails
    show under the field. Web and desktop only; PNG, JPEG, GIF and WebP up to 10 MB. The read RPC
    serves only files directly inside the image folder.
- **Core files touched:**
  - `packages/app/src/components/sidebar/sidebar-nav-rows.tsx` (`CUSTOM(sidebar-pinned-plugins)`):
    plugins in `PINNED_SIDEBAR_PLUGIN_IDS` render right under Wake dictation, above the Show more
    toggle, instead of inside it.
  - `.oxlintrc.json` and `.oxfmtrc.json` skip `custom/plugins/power-workboard/**`. The plugin keeps
    upstream Workboard's style (Prettier, 80 columns) and is checked with its own `tsc`, `vitest`
    and `prettier`. JSON has no comments; on conflict, re-add the patterns.
- **Re-apply:** Plugin: none. Sidebar: in the header rows, split the visible plugin items with
  those ids out of the Show more list and render them before the toggle.
- **Tests:** `tests/power-workboard.test.ts` (no import, tracking, Ready to start migration,
  orchestrator limits, disable, project retry, Run now batches, daily time and Stop, task
  assignment and delete, refinement and `/write-ticket`, review Done, Continue while active and
  while disabled, the default orchestrator, Commit, Merge and PR description, creating in Ready to
  start) and `tests/schedule.test.ts` (windows across midnight, daily triggers, next
  run). The upstream Workboard suites that assume import and the old groups
  were moved to `tests/upstream-workboard/` and are not run. The update script runs
  `tsc` and `vitest` in the plugin folder.
- **Setup:** automatic (see On by default). By hand:
  `paseo plugin install "$PWD/custom/plugins/power-workboard" --home <home>`. **Don't
  `plugin remove` it without saving the board first:** removing a plugin deletes
  `$PASEO_HOME/plugin-settings/<id>/`, which holds the board.
- **Verify:** `(cd custom/plugins/power-workboard && npm run check)`. In the app, Power Workboard
  sits under Wake dictation; create a task with a project, move it to Ready to start, press Play,
  and watch it go to In progress and then Ready to review with the agent's summary. Press
  Continue task, write feedback and Send back: the same agent chat gets it and the card returns
  to In progress.

## plugin-modal-size: plugin modals at 80% of the window

- **Added:** 2026-10-25 (based on upstream 0.11.2)
- **Commit:** `custom: Power Workboard task editor at 80% of the window, colored projects and an insert menu`
- **Why:** Plugin modals are capped at 520 px; Power Workboard's task editor needs room for a
  long ticket.
- **What:** `Modal.Content` takes `size: "large"`: on desktop the card is 80% of the window's
  width (`desktopMaxWidth`) and 80% of its height. Phone sheets are unchanged. A plugin passes it
  untyped (`{ size: "large" } as object`) because published plugin types lack it; an older Paseo
  ignores it.
- **Core files touched** (marked `CUSTOM(plugin-modal-size)`):
  `packages/plugin/src/client/react-native.ts` (the prop) and
  `packages/app/src/plugins/react-native/modal.tsx` (width from `useWindowDimensions`, height
  `"80%"`).
- **Re-apply:** Add the optional prop to `ModalContentProps`; in the app's `ModalContent`, pass
  `desktopMaxWidth` and `desktopHeight` to `AdaptiveModalSheet` when it is `"large"`. Rebuild
  `@getpaseo/plugin` (`npm run build:plugin`) before typechecking the app.
- **Verify:** In Power Workboard, New task opens at 80% of the window.

## desk-workboard: Power Workboard as a tab beside the Desks

- **Added:** 2026-10-25 (based on upstream 0.11.2)
- **Commit:** `custom: Power Workboard replaces Workboard, with a review step and a tab beside the Desks`
- **Why:** The board is where tasks get handed out and reviewed; it should be one click away in
  Tasks mode, next to the Desks, without leaving them.
- **What:** In Tasks mode the header shows a **Power Workboard** chip before the Desk chips
  whenever a connected host has the plugin (the local daemon's copy first). Clicking it shows the
  plugin's board under the Desk header; the Desk stays mounted underneath, hidden, so its tabs
  keep their state. Clicking a Desk chip, switching Desks or opening another tab (a task in the
  sidebar, or a workspace/agent the board opens) returns to the Desk. The chip's × or
  right-click > Close removes it; then **+** opens a menu with **New Desk** and **Power
  Workboard**, which brings it back. Open/closed and selected are kept in this app's storage
  (`custom-desk-workboard`).
- **Files:** `packages/app/src/task-navigation/desk-workboard.tsx` (store, the installation
  lookup, the cover that swaps the board in, and the surface renderer modeled on
  `plugins/surface-screen.tsx`).
- **Core files touched:** `packages/app/src/task-navigation/desk-screen.tsx`
  (`CUSTOM(desk-workboard)`): the chip and the + menu in the header, Desk chips unselected while
  the board shows, the Desk content wrapped in `DeskWorkboardCover`, and `DeskVisibleAgents`
  stops marking agents visible while covered.
- **Re-apply:** In `DeskScreen`, call `useDeskWorkboard(desk.id, active)`. In the header, render
  `DeskWorkboardChip` before the Desk chips when `open`, and `DeskCreateMenu` instead of the New
  Desk button when the plugin exists but its tab is closed. Wrap everything inside the root view
  up to the bottom-panel expand button in `DeskWorkboardCover` with `plugin` set only while
  `selected`. If upstream changes how plugin screens render, follow `SurfaceRenderer` in
  `plugins/surface-screen.tsx`.
- **Verify:** Typecheck and lint. In Tasks mode with the plugin installed: the chip shows and opens
  the board; clicking a task in the sidebar returns to the Desk; × hides it and + > Power
  Workboard brings it back.

## task-summary-hover: hovering a Tasks sidebar row shows the agent's status summary

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: hovering a Tasks sidebar row shows the agent's status summary`
- **Why:** The sidebar shows a title and the workspace name, which often isn't enough to tell
  sessions apart; the summary under each agent's composer is.
- **What:** Resting the pointer on a row of the Tasks sidebar for 400 ms opens a card to its right
  with the [agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer):
  the topic, the request, the status, and when, by which model and at what cost it was written.
  Rows without a summary, compact layouts and native get no card. The delay keeps a sweep down
  the list from flashing a card per row.
- **Files:** `packages/app/src/task-navigation/task-summary-hover-card.tsx`.
- **Core files touched** (marked `CUSTOM(task-summary-hover)`):
  - `task-navigation/sidebar.tsx`: `TaskRow` wraps its row in `TaskSummaryHoverCard`.
  - `composer/agent-status-line.tsx`: exports `StatusDetails`, with an optional topic on top.
- **Re-apply:** Wrap each task row of the Tasks sidebar in a `HoverCard` (`openDelayMs`,
  placement `right`) whose content renders `StatusDetails` for the row's agent.
- **Verify:** No unit test: the logic is the hover wiring. In the app, in Tasks mode, rest the
  pointer on a session that has a line under its composer: the card shows that line's topic,
  request and status.

## bottom-panel-warp-project-tab: showing the bottom panel puts Warp on the project's tab

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: showing the bottom panel switches Warp to the project's tab`
- **Why:** One bottom panel serves every task in Tasks mode (and every visit to a workspace), so
  Warp kept showing whatever tab was last used, often another project's. The
  [+ in the Warp chip](#bottom-panel-warp-tab-button-a--in-the-bottom-panels-warp-chip-opens-a-warp-tab-in-the-agents-project)
  opened a new tab every time, piling up tabs.
- **What:** When Ctrl+J or the sidebar button shows a hidden bottom panel whose selected tab is
  Warp, Warp switches to the tab whose shell is in the agent's project (in Tasks mode the last
  focused agent tab's workspace, in a workspace the workspace itself), or opens one there when no
  tab is. The active tab stays when it is already in the project or below it. A panel whose
  selected tab is a terminal or another page is left alone. How Warp picks the tab is in
  [docs/custom-warp-web-embedded.md](../docs/custom-warp-web-embedded.md#warp-tabs-opened-by-paseo).
- **Warp side:** the commit `PASEO: the host page shows the tab of a folder with a
paseo-warp-show-cwd event` on the `paseo` branch of `~/projetos/warp-web-custom`
  (`app/src/workspace/view.rs`). Needs a Warp rebuild; Warp pages loaded before it ignore the
  event until reloaded.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel-warp-project.ts`;
  `bottomPanelWarpBrowserId` in `bottom-panel-default.ts` (+ test) and `showWarpSessionIn` in
  `warp-session.ts`.
- **Core files touched** (marked `CUSTOM(bottom-panel-warp-project-tab)`):
  - `screens/workspace/workspace-screen.tsx`: `handleBottomPanelToggle` on a `shown` result.
  - `task-navigation/new-tab-menu.tsx`: the `workspace.bottom-panel.toggle` handler, through
    `showDeskBottomPanelWarpProject`.
- **Re-apply:** Where Ctrl+J's toggle returns `kind: "shown"`, call `showBottomPanelWarpProject`
  with the returned layout and the agent's server and workspace.
- **Verify:** `(cd packages/app && npx vitest run src/workspace-tabs/bottom-panel-default.test.ts)`
  (already in the update script). In the app, in Tasks mode with Warp in the bottom panel, hide it,
  focus an agent of another project and press Ctrl+J: Warp shows a tab in that project (`pwd`
  prints its folder). Hide and show again from an agent of the first project: Warp goes back to
  its tab instead of opening another.

## shell-output-files: shell tool calls link the files their command writes or reads back

- **Added:** 2026-10-25 (based on upstream 0.11.2, `7f9b65d46`)
- **Commit:** `custom: shell tool calls link the log files their command writes or reads back`
- **Why:** Agents often send a command's output to a file and print only part of it
  (`... > $S/out.txt; head -150 $S/out.txt`), or poll a file a tool writes. The chat then shows a
  fraction of the log, and the file sits in a scratchpad folder nobody opens.
- **What:** A **Logs:** row above the command in an expanded shell tool call lists those files by
  name. Each is a chat file link
  ([chat-file-actions](#chat-file-actions-file-links-in-the-chat-resolve-to-full-paths-and-get-a-hover-card-of-actions)):
  clicking opens the file in a tab, hovering shows the full path and the usual actions. The files
  are the targets of `>`, `>>`, `&>` and `N>` redirects and of `tee`, and the files given to
  `cat`, `head`, `tail`, `less` and `more`. Variables assigned in the same command
  (`S=/tmp/x; ... $S/out.txt`) and `cd` are followed; paths that depend on what the shell
  computes at run time (`$(...)`, unknown variables, `~`, globs) are left out, as are
  `/dev/null`, descriptor copies like `2>&1` and heredoc bodies. Relative paths need the tool
  call's `cwd` or an absolute `cd`. Web and desktop only.
- **Files:** `packages/app/src/components/shell-output-files.ts` (+ test) and
  `shell-output-file-links.tsx`.
- **Core files touched** (marked `CUSTOM(shell-output-files)`):
  - `components/tool-call-details.tsx`: `ShellDetailSection` renders `ShellOutputFileLinks` and
    takes the detail's `cwd`.
  - `agent-stream/view.tsx`: shell tool calls get an `AssistantFileLinkResolverProvider`, like
    assistant messages, so their links resolve.
  - `assistant-file-links/provider.tsx`: `useHasAssistantFileLinkResolver`, since tool call details
    also render outside the stream (the native tool call sheet).
- **Re-apply:** Run `shellOutputFiles(command, cwd)` in the shell tool call detail and render each
  path as an `AssistantMarkdownCodeLink`, only where a file link resolver provider is mounted; in
  the agent stream, wrap shell tool calls in that provider.
- **Verify:** `(cd packages/app && npx vitest run src/components/shell-output-files.test.ts)` (in
  the update script). In the app, have an agent run `S=/tmp/x; mkdir -p $S; ls / > $S/out.txt;
head -3 $S/out.txt` and expand the tool call: **Logs: out.txt** opens the full listing.

## content-width-boost: -, + and maximize buttons widen the chat content on a maximized window

- **Added:** 2026-10-26
- **Commit:** `custom: content width buttons in the agent panel on a maximized window`
- **Why:** On a maximized window the chat column (Settings > Appearance > content width) leaves
  most of the screen empty; the user wants to widen it on the spot.
- **What:** While the desktop window is maximized, the top left of the agent panel (below the
  tabs) shows `-`, `+` and the maximize-pane icon. They step the content width through 1x (the
  configured width), 1.5x, 2x and full pane width: `+`/`-` move one step, maximize jumps to full
  and back to 1x. The step is saved in app storage, so it holds for every agent and across
  restarts. Unmaximizing the window restores the
  configured width. Web and desktop only.
- **Files:** `packages/app/src/content-width-boost/store.ts` (+ test) and `controls.tsx`.
- **Core files touched** (marked `CUSTOM(content-width-boost)`):
  - `appearance/provider.tsx`: wraps the resolved `contentMaxWidth` in `boostContentMaxWidth`.
  - `panels/agent-panel.tsx`: renders `ContentWidthBoostControls` in `dockContent`.
  - `agent-stream/view.tsx` (`StreamItemWrapper`, empty state), `agent-stream/turn-footer.tsx`,
    `composer/tracks.tsx`, `composer/agent-status-line.tsx`: add `useContentMaxWidthStyle()` after
    the stylesheet entry. Unistyles patches `theme.contentMaxWidth`, but these stylesheet entries
    kept handing the re-rendered rows the old width (checked in the browser), so the width is
    passed inline. The provider publishes `appliedWidth` after patching the theme.
  - `composer/index.tsx`, `composer/dock/index.tsx`: `useContentWidthBoostRerender()`; a re-render
    is enough for their styles.
  - `agent-stream/view.tsx`: the list's `contentMaxWidth` (height estimates, image rail) is the
    applied width.
- **Re-apply:** Where the appearance provider passes `contentMaxWidth` to `applyAppearance`, pass
  `boostContentMaxWidth(width, store state)` and re-run on store changes; mount the controls
  (absolute, top left) inside the agent panel content container.
- **Verify:** `(cd packages/app && npx vitest run src/content-width-boost/store.test.ts)` (in the
  update script). In the app, maximize the window, press `+` twice: the messages, pill row and
  composer double at once; maximize icon: they fill the pane.

## worktree-pill-done: a done worktree session gets a green Worktree pill at the front

- **Added:** 2026-10-26
- **Commit:** `custom: the Worktree pill turns green and leads the row when the agent is done`
- **Why:** With several worktree sessions open, the user wants to see at a glance which ones are
  ready to review and merge back.
- **What:** The
  [status summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer)
  gets a `done` flag: Haiku sets it when the agent says the current request is done or nearly
  done (only review, a commit or a merge left), and clears it while work, a question or a failure
  is pending. While it is set, the **Worktree: <branch>** pill has a green border
  (`statusSuccess`) and moves to the first slot of the pill row. A loose `done` from the model
  ("true" as a string) still counts; anything else is not done, and never costs the rest of the
  summary. Summaries written before this change have no flag, so the pill stays as it was until
  the next summary.
- **Files:** `readDoneFlag` in `packages/server/src/server/agent-status-summary.ts` (+ test).
- **Core files touched** (marked `CUSTOM(worktree-pill-done)`):
  - Protocol `messages.ts`: optional `done` on `AgentStatusSummaryPayloadSchema`.
  - Server `agent-status-summary.ts`: the prompt asks for `done` and shows the previous one;
    `SummarySchema` reads it loosely.
  - App `composer/worktree-pill.tsx`: `done` prop, green border.
  - App `panels/agent-tracks.tsx`: renders the pill first when `done`, in its usual slot
    otherwise.
- **Re-apply:** Add `done` to the status summary JSON the Haiku prompt asks for and pass it into
  the payload. In the pill row, read `useAgentStatusSummary(serverId, agentId)?.done` and render
  `WorktreePill` with a `statusSuccess` border as the row's first child when it is true.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent-status-summary.test.ts)` (in
  the update script). Needs the daemon from this build (`kill-paseos-and-daemons.sh`). In a
  worktree session, let the agent finish a task: a few seconds after the turn ends, the Worktree
  pill is green and first in the row; send a new request and it goes back once the next summary
  says work is pending.

## scroll-arrows: the chat's scroll arrows fade when idle, and a top arrow joins the bottom one

- **Added:** 2026-10-26
- **Commit:** `custom: scroll-to-top arrow, and both scroll arrows fade after 3 s without scrolling`
- **Why:** Going back to the start of a long chat meant dragging or spinning the wheel, and the
  scroll-to-bottom button sat over the messages for as long as the chat was not at the bottom.
- **What:** Scrolling up in the chat shows an up arrow at the top center, the mirror of the
  scroll-to-bottom button. It jumps to the start of the loaded history; older pages load from
  there as on a manual scroll, so pressing it again goes further back. Both arrows show only
  while scrolling and fade 3 s after the last scroll. The top arrow needs upward input behind the
  move (wheel, keys, scrollbar, touch drag), so layout corrections and history loading don't flash
  it, and it hides once the start of the conversation is on screen. The reading modes (Columns,
  Compact) keep their bottom arrow as before, without the fade.
- **Files:** `packages/app/src/agent-stream/scroll-arrows.ts` (+ test).
- **Core files touched** (marked `CUSTOM(scroll-arrows)`):
  - `agent-stream/strategy.ts`: `onScrollActivity` on `StreamRenderInput`, `scrollToTop` on
    `StreamViewportHandle`.
  - `agent-stream/strategy-web.tsx`: `handleDomScroll` reports through `reportWebScrollActivity`;
    the handle's `scrollToTop` stops following output, marks upward input and rearms history
    loading.
  - `agent-stream/strategy-native.tsx`: `handleScroll` reports drags (the list is inverted, so a
    growing offset is up); `scrollToTop` is `scrollToEnd`.
  - `agent-stream/view.tsx`: `useScrollArrows`, `ScrollToTopArrow`, and `isScrollAwake` in
    `shouldShowScrollToBottom`.
- **Re-apply:** Have each stream viewport call `onScrollActivity({ direction, atTop })` on user
  scrolls and expose `scrollToTop`. In the stream view, feed `useScrollArrows(agentId)` from it,
  gate the scroll-to-bottom button on `awake` in chat mode, and render a ChevronUp copy of it at
  the top while `showTop`.
- **Verify:** `(cd packages/app && npx vitest run src/agent-stream/scroll-arrows.test.ts)` (in the
  update script). In the app, scroll up in a long chat: the up arrow appears at the top and the
  down arrow at the bottom; stop scrolling and both fade after 3 s; press the up arrow and the
  chat jumps to the start of what is loaded.

## effort-favorites: star effort levels; → cycles only the starred ones

- **Added:** 2026-10-26
- **Commit:** `custom: star effort levels in the effort menu; → cycles only the starred ones`
- **Why:** → in an empty composer
  ([task-shortcuts](#task-shortcuts-keyboard-navigation-and-draft-selection-in-tasks-mode)) walked every effort level; the user only uses a few.
- **What:** Each row of the effort menu has a star at the right. Clicking it stars the level
  (yellow) without selecting it or closing the menu. When any level offered by the current model
  is starred, → cycles only through starred levels; with none starred it cycles all of them.
  Stars are keyed by effort id (`high`, `max`), so they apply to every provider, and are saved
  in app storage.
- **Files:** `packages/app/src/composer/effort-favorites-store.ts`.
- **Core files touched** (marked `CUSTOM(effort-favorites)`):
  - `composer/empty-shortcuts.ts`: `nextEffortId` takes `favoriteIds` (+ test).
  - `composer/agent-controls/index.tsx`: `ThinkingComboboxOption` passes a star `trailingSlot`
    to `ComboboxItem`; the agent → handler passes the favorites.
  - `composer/draft/workspace-tab.tsx`: the draft → handler passes the favorites.
- **Re-apply:** Give the effort menu rows a star toggle bound to the store and pass the store's ids
  into whatever picks the next effort level for →.
- **Verify:** `(cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts)` (in the
  update script). In the app, star Medium and Max, empty the composer, press →: it goes
  Medium → Max → Medium.

## worktree-pill-merged: a done worktree session already merged gets a filled pill with a check

- **Added:** 2026-10-26
- **Commit:** `custom: the Worktree pill fills green with a check once the worktree is merged`
- **Why:** After merging a finished worktree session, the user wants to see it is merged, and to
  see when the agent changed it again and it needs another merge.
- **What:** On top of
  [worktree-pill-done](#worktree-pill-done-a-done-worktree-session-gets-a-green-worktree-pill-at-the-front),
  every 10 s the daemon checks each agent whose status summary is `done`: its worktree is merged
  when it is clean and its HEAD is contained in the main checkout's HEAD (the branch the pill's
  Merge action merges into, not the repo's default branch). The result is a `merged` flag on the
  summary. A done and merged pill gets a green tint background, green label and a check before
  the label. Uncommitted changes, or commits the main checkout lacks, clear the flag within 10 s,
  leaving the green border of a done session that needs merging again. A new turn that clears
  `done` also clears the look. Agents outside linked worktrees cost one `git rev-parse` per poll
  while done; others four git calls, with `GIT_OPTIONAL_LOCKS=0` so status never takes the index
  lock.
- **Files:** `packages/server/src/server/worktree-merge-status.ts` (+ test, on real git repos).
- **Core files touched** (marked `CUSTOM(worktree-pill-merged)`):
  - Protocol `messages.ts`: optional `merged` on `AgentStatusSummaryPayloadSchema`.
  - Server `bootstrap.ts`: starts and stops `WorktreeMergeStatus`.
  - App `composer/worktree-pill.tsx`: `merged` prop (tint, label color, `Check` icon).
  - App `panels/agent-tracks.tsx`: passes `merged` when the summary is done and merged.
- **Re-apply:** Start a poller in bootstrap that, for agents with a `done` summary, runs
  `readWorktreeMerged(agent.cwd)` and writes `merged` into the summary with `setStatusSummary`
  when it changes. In the pill, fill it with `statusSuccessTint` and prepend a `Check` when the
  summary is done and merged.
- **Verify:** `(cd packages/server && npx vitest run src/server/worktree-merge-status.test.ts)` (in
  the update script). Needs the daemon from this build. In a done worktree session, use the pill's
  **Merge back to main project**: within 10 s it fills green with a check. Have the agent change a
  file: the fill and check go away, the green border stays.

## bottom-panel-toggle-inline: the bottom panel toggle sits left of the agent summary

- **Added:** 2026-10-26
- **Commit:** `custom: bottom panel toggle left of the agent summary, ⌃⌃ to show and ⌄⌄ to hide`
- **Why:** The floating ⌃⌃ button
  (`bottom-panel-expand-button.tsx`, part of [bottom-panel](#bottom-panel-ctrlj-toggles-a-bottom-panel)) sat far from the chat; the user wants it next to
  the summary under the composer, and usable to hide the panel as well.
- **What:** While an agent status line
  ([agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer))
  is on screen, a toggle sits left of its summary: ⌃⌃ shows the bottom panel, ⌄⌄ hides it. The
  floating ⌃⌃ button hides meanwhile, and comes back where no status line shows. The ⌄⌄ in the
  bottom panel's own tab row stays.
- **Files:** `packages/app/src/workspace-tabs/bottom-panel-expand-button.tsx` (a small store: the
  floating button publishes whether the panel is open, and the inline toggles count themselves).
- **Core files touched** (marked `CUSTOM(bottom-panel-toggle-inline)`):
  - `composer/agent-status-line.tsx`: renders `BottomPanelInlineToggle` first in the row, which
    is now a row.
- **Re-apply:** Have `BottomPanelExpandButton` publish the panel state and hide while an inline
  toggle is mounted; render the inline toggle at the start of the status line.
- **Verify:** In the app, open an agent with a summary line: ⌃⌃ left of it opens the bottom panel
  and turns into ⌄⌄, which closes it.

## chip-cycle: clicking the model or effort chip cycles favorites, its chevron opens the menu

- **Added:** 2026-10-26
- **Commit:** `custom: model and effort chips cycle favorites on click, their chevron opens the menu`
- **Why:** The user switches between a few models and effort levels all the time; one click on
  the chip is faster than opening a menu.
- **What:** In the composer toolbar (agents and drafts, desktop layout):
  - A click on the model chip outside its ⌄ moves to the next favorite model (the ★ ones in the
    Ctrl+M picker, in picker order, wrapping). With no favorite to move to, it opens the picker.
  - A click on the effort chip outside its ⌄ moves to the next effort level, only through starred
    ones when any are starred ([effort-favorites](#effort-favorites-star-effort-levels--cycles-only-the-starred-ones)).
  - The ⌄ is its own button and opens the menu the chip opened before (the Ctrl+M picker for the
    model, the effort menu for effort).
- **Files:** none new.
- **Core files touched** (marked `CUSTOM(chip-cycle)`):
  - `components/ui/combobox-trigger.tsx`: `onChevronPress` makes the chevron a nested button.
  - `components/combined-model-selector.tsx`: `onBodyPress` (returns false to fall back to
    opening) and `splitTriggerPress`.
  - `composer/agent-controls/index.tsx`: `cycleFavoriteModel` / `cycleFavoriteEffort` /
    `useChipCycle`; `ControlledAgentControls` takes `cycleControls` (the agent's
    `commandCenterControls`, the draft's `pickerControls`) and the desktop content wires the
    chips.
  - `composer/empty-shortcuts.ts`: `nextModelSelection` (+ test).
- **Re-apply:** Split the toolbar chip triggers so the chevron opens the menu and the body calls a
  cycle function built from the same controls the ←/→ shortcuts use.
- **Verify:** `(cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts)` (in the
  update script). In the app, star two models in Ctrl+M and two effort levels; clicking each chip
  alternates between them, and its ⌄ opens the menu.

## commit-box-keys: Ctrl+Enter commits then pushes, Ctrl+E focuses the message, stale lists stop

- **Added:** 2026-10-26
- **Commit:** `custom: Changes commit box: Ctrl+Enter commits then pushes, Ctrl+E focuses it, stale lists refresh`
- **Why:** Committing from the Changes sidebar needed the mouse, and a list that trailed the
  working tree let the user commit without seeing the latest changes.
- **What:** Follow-up to [commit-selection](#commit-selection-commit-or-discard-the-files-checked-in-changes).
  - Ctrl/⌘+Enter in the commit message presses the primary button.
  - With no uncommitted changes left and commits ahead of origin, the button reads **Push** and
    Ctrl+Enter pushes. After a commit the message takes focus again, so commit then push is
    Ctrl+Enter twice.
  - An empty message commits as `wip` (the placeholder says so); the Commit button is never
    disabled for a missing message.
  - Committing with nothing checked asks "Nothing is selected, do you want to select all?"
    (**Select All** is the default). Select All checks every file and commits them.
  - Before committing, the app fetches the current uncommitted diff and compares paths and line
    counts with the list on screen. If they differ it alerts, refreshes the list, and doesn't
    commit.
  - Ctrl+E (upstream's Explorer toggle; ⌘+E on macOS) focuses the commit message when it opens
    the Explorer on the Changes tab. Closing is unchanged.
- **Files:** `git/commit-selection/use-commit-guard.ts` (the stale-list check),
  `git/commit-selection/focus-request.ts` (a focus request, from Ctrl+E or a finished commit,
  that any commit box mounted in the next 2 s honors; the box can remount while the status
  catches up after a commit, and the expiry keeps a later switch to Changes from stealing focus), `model.ts` `changesDifferFromList` (+ test).
- **Core files touched:**
  - `git/diff-pane.tsx`: passes `status` and `beforeCommit` (`useCommitGuard`) to `CommitBox`.
  - `screens/workspace/workspace-screen.tsx` and, for Tasks mode,
    `task-navigation/desk-screen.tsx` (`CUSTOM(commit-selection)`): each `sidebar.toggle.right`
    handler requests commit focus when the Explorer was closed.
- **Re-apply:** Keep Ctrl+E on upstream's `sidebar.toggle.right`; a second Ctrl+E binding never
  fires because that one matches first. Tasks mode has its own handler for that action (the
  desk Explorer); request focus in both, or Ctrl+E in Tasks mode leaves focus in the chat. The request has to outlive the toggle because the commit
  box mounts only after the Explorer opens, and a claim-once request with a short TTL keeps it
  from firing later.
- **Verify:** `commit-selection/model.test.ts` and `e2e/browser/changes-commit-selection.spec.ts`
  (both already in the update script). The second browser test closes and reopens the Explorer
  with Ctrl+E, checks the message is focused, and with no message commits everything as `wip`
  with Ctrl+Enter through the Select All prompt.

## turn-usage-inline: the token-ledger usage row joins the turn footer line

- **Added:** 2026-10-26
- **Why:** The token-ledger plugin appends a usage row (`in 10 · cache 1.18M · out 2.2k · $0.32 · 45s`)
  after each finished turn. It sat on its own line between the reply and the footer icons, pushing
  the copy and fork icons away from the message.
- **What:** The stream no longer draws that row on its own. The turn footer draws it on the same
  line, after the icons and "Worked for ...". A turn with no footer (no assistant message) keeps
  the standalone row.
- **Files:** `packages/app/src/agent-stream/turn-usage.ts` (+ test).
- **Core files touched** (marked `CUSTOM(turn-usage-inline)`): `agent-stream/view.tsx` (skips the row
  when a footer shows it, passes `renderTurnUsage`, and `renderStreamItemWithTurnFooter` still draws
  the footer of an item that renders nothing), `agent-stream/turn-footer.tsx` (finds the row,
  passes `trailing`), `components/message.tsx` (`AssistantTurnFooter` renders `trailing`).
- **Gotcha:** A finished turn's footer hangs off the turn's last item, which is this usage row.
  Upstream's `renderStreamItemWithTurnFooter` returns `null` for an item with no content, footer
  included, so hiding the row also hid every footer above the latest turn: copy, fork, and time
  showed only on the bottom footer. Fixed in
  `custom: earlier turns keep their footer when the usage row moves inline`.
- **Re-apply:** Find the plugin's `turn-usage` timeline item newer than the footer's assistant
  message in the same response, render it through `PluginTimelineItemView` after the footer's
  duration label, and return `null` for that item in the list. In `renderStreamItemWithTurnFooter`,
  return early only when there is neither content nor a `completedFooter`, and skip the content
  wrapper when the content is empty.
- **Verify:** `(cd packages/app && npx vitest run src/agent-stream/turn-usage.test.ts)`. In the app,
  finish a turn: one line with copy, fork, "Worked for", then the dot and token figures. Send
  another message: the earlier turn keeps that line.

## shell-shortcuts: `/wip` and `/status` slash commands

- **Added:** 2026-10-26 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: /wip and /status slash commands`
- **Why:** To commit work in progress or check `git status` from the composer without reaching for
  the pill or typing the `!` command.
- **What:** In an agent's composer, `/wip` does what the **Commit: wip** pill does
  ([commit-wip](#commit-wip-a-commit-wip-pill-beside-the-diff-stat)): runs
  `git add . && git commit -m 'wip'` as if typed after `!`. `/status` runs `!git status`. Both go
  through the shell-command plugin's `run` RPC, so the output lands in a Terminal card, the
  command enters the `!` history, and the agent never sees it. Arguments are ignored. As plugin
  commands they win over a provider's command of the same name, so Claude Code's own `/status`
  is hidden in Paseo.
- **Files:** `custom/plugins/shell-command/client/shortcut-commands.ts` (+ test), registered in
  `custom/plugins/shell-command/index.client.tsx`. No conflict risk.
- **Core files touched:** none. `packages/app/src/composer/commit-wip-pill.tsx` only gains a comment
  pointing at `/wip`; keep the two commands in step.
- **Re-apply:** In the shell-command plugin's client, add agent slash commands `wip` and `status`
  whose `onSubmit` calls `runShellCommandRpc` with the fixed command, the agent's id, cwd and
  workspace id.
- **Verify:** `npx vitest run custom/plugins/shell-command/client` (in the update script through
  `custom/plugins/shell-command`). Plugin-only: reload `shell-command` on each daemon, then type
  `/wip` and `/status` in an agent's composer: each shows a Terminal card.

## project-icon-text: your own text in a project's generated icon

- **Added:** 2026-10-26 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: click a project's generated icon in Edit project to put your own text in it`
- **Why:** The generated icon only showed the project's first letter, so projects starting with
  the same letter (DreamMMO, DreamMMO-wt1) looked alike.
- **What:** In Settings > project > Edit project, the colored icon is a button. Clicking it shows
  an "Icon text" field (up to 8 characters, emoji too); the preview follows as you type, and Save
  changes keeps it. Everywhere the project's generated icon shows (sidebar, tabs, composer,
  menus), the text replaces the initial and shrinks to fit on one line. Empty text goes back to
  the initial. An uploaded image still wins: the icon is only clickable while no image is set
  (Use automatic first). The text is saved in this app's storage (`custom-project-icon-text`),
  keyed by project view key, so each install and launcher profile keeps its own; the phone
  doesn't see it.
- **Files:** `packages/app/src/projects/icon-text-store.ts`.
- **Core files touched** (marked `CUSTOM(project-icon-text)`):
  - `components/project-icon-view.tsx`: optional `text` prop, the store lookup by
    `projectViewKey`, and `projectIconTextFontSize`.
  - `components/project-edit-sheet.tsx`: the icon `Pressable`, the text field, and Save writing
    the store (Save is enabled when only the text changed).
- **Re-apply:** Have `ProjectIconView` render the stored text for its `projectViewKey` instead of
  `initial`, sized down for longer text. In the edit sheet, make the preview icon open a text
  input whose value previews in the icon and is written to the store on save.
- **Verify:** In the app, open a project's settings, Edit project, click the "D" icon, type `wt1`,
  Save: the sidebar and composer show `wt1` in that project's icon. Clear it and Save: back to
  "D".

## project-favorites: star projects; ↑/↓ cycle only the starred ones

- **Added:** 2026-10-26 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: star projects in the composer's project menu; ↑/↓ cycle only the starred ones`
- **Why:** Like [effort-favorites](#effort-favorites-star-effort-levels--cycles-only-the-starred-ones):
  ↑/↓ in an empty draft ([task-shortcuts](#task-shortcuts-keyboard-navigation-and-draft-selection-in-tasks-mode))
  walked every project; the user only switches between a few.
- **What:** Each row of the project menu opened by the composer's project icon
  ([composer-project-icon](#composer-project-icon-identify-the-project-beside-context-usage)) has a
  star at the right. Clicking it stars the project (yellow) without picking it or closing the
  menu. When any listed project is starred, ↑/↓ in an empty draft and ← on New Workspace cycle
  only through starred ones; with none starred they cycle all of them. Stars are keyed by project
  view key and saved in app storage (`custom-project-favorites`). The + menu's Agent flyout
  ([new-agent-projects](#new-agent-projects-the--menus-agent-row-lists-projects-on-hover)) lists
  starred projects first, then the rest; each group stays sorted by name (added 2026-10-28,
  commit `custom: the + menu's Agent flyout lists starred projects first`).
- **Files:** `packages/app/src/composer/project-favorites-store.ts`.
- **Core files touched** (marked `CUSTOM(project-favorites)`):
  - `composer/empty-shortcuts.ts`: `projectCycleIds` (+ test).
  - `model-picker/project.ts`: optional `favoriteKey` on `ModelPickerProjectOption`.
  - `composer/project-icon.tsx`: star `trailing` on `ProjectMenuItem`.
  - `composer/draft/workspace-tab.tsx`: the ↑/↓ handler cycles `projectCycleIds(...)`.
  - `screens/new-workspace-screen.tsx`: ← cycles `projectCycleIds(...)`; the Ctrl+M project
    options carry `favoriteKey` (the option ids there are prefixed, the view key is not).
  - `new-agent-projects/model.ts`: `favoritesFirst` (+ test); `new-agent-projects/menu.tsx` sorts
    the flyout with it, matching stars by the identity's `target.projectViewKey`.
- **Re-apply:** Give the composer project menu rows a star toggle bound to the store and filter
  the ids the project cycle walks to the starred ones when any are starred. In the Agent flyout,
  move the rows whose project view key is starred to the top with a stable partition.
- **Verify:** `(cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts)` and
  `src/new-agent-projects/model.test.ts` (both in the update script). In the app, star two
  projects in the composer's project menu, empty the composer of a draft, press ↑: it alternates
  between the two. Hover + > Agent: the two starred projects come first.

## desk-header: New Desk + before the Desks, a soft green selected Desk, no project name

- **Added:** 2026-10-27 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: Desk tabs sit in free rows; the Desk header loses the project name`
- **Why:** The user never looked at the project name at the start of the header (every tab shows
  its project's icon), kept clicking the New Desk + when they meant the tab row's +, and couldn't
  tell the selected Desk from the selected tab because both used the same grey fill.
- **What:** The Desk header starts with the sidebar toggle, then the New Desk **+** (or the
  New Desk / Power Workboard menu while the board is closed), a thin divider, and the Desk chips.
  The project icon and name (or "Choose a task") are gone. The selected Desk has a soft green fill
  (green at 20% in dark themes, 12% in light) with light green text; the others use the extra-muted
  text color.
- **Core files touched** (marked `CUSTOM(desk-header)`): `task-navigation/desk-screen.tsx` only
  (`DeskProject` removed; `newDeskDivider`, `deskTabSelected`, `deskTabText*` styles).
- **Re-apply:** In the Desk `headerLeft`, drop the project element and render the create button
  before the Desk chips, followed by a 1px divider. Recolor the selected Desk chip.
- **Verify:** In the app, Tasks mode: the header reads `[sidebar] + | Primary tasks …`, and the
  selected Desk is green, not grey.

## tab-lanes: Desk tabs sit in free rows; drop a tab anywhere

- **Added:** 2026-10-27 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: Desk tabs sit in free rows; the Desk header loses the project name`
- **Why:** With many tabs the single row scrolled and hid tabs past the right edge. The user wanted
  a second row they can use whenever they like, not only once the first is full, and to put a tab
  anywhere in it (alone in the middle, gaps included) with nothing re-packing around it.
- **What:** With [flexible-tabs](#flexible-tabs-the-flexible-tab-movement-setting-and-the-tidy-button)
  on, every Desk pane's tab row in Tasks mode (not the bottom panel, not the Explorer) holds its
  tabs at free positions. It is one row by default. While any tab is dragged, an extra row
  shows below the tab bar, over the pane content; dropping a tab there starts a second row (and so
  on). A tab dropped in empty space stays exactly where it lands. A tab dropped over others fits
  into the gap between the tabs left and right of its center: if the gap is wide enough nothing
  else moves; if not, the gap opens just enough, taking room first from the side the tab came from
  (so moving a tab past its neighbor in a packed row swaps them, like a reorder), then pushing the
  tabs on the right. Dragging never shoves the neighbors along. A new tab opens right after the
  tab before it in the pane's list (next to the tab you were on), nudging its neighbors; with no room it goes to the end
  of the next row with room, or a new row. Closing a tab leaves its gap. (Since
  [tab-lanes-sticky](#tab-lanes-sticky-only-tabs-you-moved-keep-their-spot), only tabs you dragged
  keep their spot; the rest pack left.) A row that gets too narrow
  (window resize, a title that grows) slides its tabs back left and hands its rightmost tabs to the
  row below; empty rows disappear. Tabs keep their natural width (no squeezing, no scrolling). The
  inline + sits after the rightmost tab of the first row; the split/maximize/Explorer buttons stay
  on the first row. **Pin tab** also moves the tab to the start of the first row, after the other
  pinned ones. After a drop, the pane's tab list is reordered by row then x, so Ctrl+1…9 and
  Ctrl+Tab follow what you see. Dragging to another pane's rows moves the tab there. Positions are
  per Desk, kept in this app's storage (`custom-tab-lanes`); closed tabs are forgotten.
- **Files:** `packages/app/src/tab-lanes/` (`model.ts` the placement rules, `store.ts` storage and
  drop/pin commits, `geometry.ts`, `lanes.tsx` the rows, `dnd.web.tsx`/`dnd.native.tsx` the dnd-kit
  draggable chip and drop area), with `model.test.ts`.
- **Core files touched** (marked `CUSTOM(tab-lanes)`):
  - `components/split-container.tsx`: `tabLanes` prop, passed to panes as `laneScope`
    (`workspaceKey`); a `tab-lanes` drop kind that wins collision detection; `laneDropPreview`
    from the dragged chip's rect; `applyLaneDropEnd` commits, moves the tab between panes and
    reorders the pane; `paneTabs` gets `zIndex: 1` so the drag row paints over the pane content.
  - `screens/workspace/workspace-desktop-tabs-row.tsx`: `laneScope`/`laneDrop` props;
    `resolveLaneRow` and `LaneTabsArea` replace the scrolling row with `TabLanes`, measure tabs
    unbounded, and put the pane buttons in a one-row-tall box; the pin toggle calls
    `commitLanePin`.
  - `task-navigation/desk-screen.tsx`: `tabLanes` on the Desk's `SplitContainer`; an effect
    forgets the positions of closed tabs.
- **Re-apply:** Give the tab row an alternative to the sortable scroll list: absolutely
  positioned chips (dnd-kit `useDraggable` with the same `workspace-tab` data) at stored
  `{row, x}` per tab id, plus a `useDroppable` area covering the rows and one more. In the split
  container's drag handlers, treat that area like a tab drop: compute row/x from the overlay
  chip's rect, show it as a preview, and on drop save positions through `dropOnLanes`.
- **Verify:** `(cd packages/app && npx vitest run src/tab-lanes/model.test.ts)` and the first test
  of desktop `e2e/task-navigation.spec.ts` (drags a tab into the second row and back), both in
  the update script. In the app, Tasks mode: drag a tab down and to the middle; it stays there on
  a second row, and the first row keeps the gap.

## flexible-tabs: the "Flexible tab movement" setting and the tidy button

- **Added:** 2026-10-27 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: Flexible tab movement setting (off by default) and a button that tidies Desk tabs`
- **Why:** [tab-lanes](#tab-lanes-desk-tabs-sit-in-free-rows-drop-a-tab-anywhere) should be a
  choice per install: the user wants it in `paseo-personal` but not forced everywhere. And after
  moving tabs around freely, they wanted one click to line them all up again.
- **What:** Settings > Bruno's Customizations > Tabs has a **Flexible tab movement** switch (desktop app only). Off, the
  default, Desks use the original single scrolling tab row. On, they use the free rows of
  tab-lanes, and each row starts with a refresh button (**Tidy tabs**) before the pinned tabs that
  packs every tab to the left in the order they show, wrapping to more rows only when one is full.
  The switch is a desktop setting (`tabs.flexibleMovement` in `<userData>/desktop-settings.json`),
  so each launcher profile has its own: on in `~/.config/Paseo` (paseo-personal), off in
  `~/.config/Paseo-telus`. The key is absent until first saved, and absent means off.
- **Files:** `packages/app/src/tab-lanes/settings.ts` (`useFlexibleTabMovement`); `packLanes` in
  `tab-lanes/store.ts`.
- **Core files touched** (marked `CUSTOM(flexible-tabs)`):
  - `packages/desktop/src/settings/desktop-settings.ts`: optional `tabs` in the settings, schema,
    patch coercion and merge (+ a test in `desktop-settings.test.ts`).
  - `packages/app/src/desktop/settings/desktop-settings.ts`: the same optional field in the
    renderer's parse, merge and patch.
  - `screens/settings/editor-section.tsx`: the switch row.
  - `task-navigation/desk-screen.tsx`: `tabLanes={flexibleTabs}`.
  - `screens/workspace/workspace-desktop-tabs-row.tsx`: the Tidy tabs button in `LaneTabsArea`.
  - `packages/desktop/e2e/support/runtime.ts`: a `flexibleTabMovement` option for the fake
    desktop bridge.
- **Re-apply:** Add an optional boolean desktop setting, read it where the Desk renders its
  `SplitContainer`, and show its switch in Settings > Bruno's Customizations > Tabs. Put a button before the lane
  chips that clears the pane's stored positions in row order.
- **Verify:** `(cd packages/desktop && npx vitest run src/settings/desktop-settings.test.ts)` and
  the first test of desktop `e2e/task-navigation.spec.ts` (turns the setting on, drags a tab to a
  second row, tidies it back), both in the update script; the other tests there run with it off.
  In the app, Settings > Bruno's Customizations > Tabs: turn the switch off and the Desk shows one scrolling row.

## history-search-tabs: a History search becomes a tab

- **Added:** 2026-10-28 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: History searches open as tabs`
- **Why:** The user wanted each History search kept, like a browser tab, instead of losing it when
  they leave History.
- **What:** Enter in the History search field, or in its Ask AI field, opens a **History search**
  tab in the last workspace (or the current Desk in Tasks mode) and goes there. The tab shows the
  History list filtered by the search, without the screen header; its label is the search, its icon
  is History (Sparkles for an Ask AI question). Typing in the tab filters live; Enter on another
  search opens another tab. The same search reveals its existing tab. With no workspace opened
  yet, History searches in place as before. Tabs persist with the layout.
- **Files:** `packages/app/src/history-search-tabs/` (`open.ts` opens the tab from History,
  `use-history-search-tabs.ts` routes Enter in both fields, `panel.tsx` the panel).
- **Core files touched** (marked `CUSTOM(history-search-tabs)`):
  - `workspace-tabs/model.ts`: `HistorySearchTabTarget` (`kind: "history_search"`, `query`, `ai?`).
  - `workspace-tabs/identity.ts`: normalize, equality (`historySearchTabTargetsEqual`) and the
    deterministic id `history_search_<ai|keywords>_<query>`.
  - `stores/workspace-layout-storage.ts`: the storage schema entry.
  - `panels/panel-manifest.ts` and `panels/register-panels.ts`: manifest and registration.
  - `screens/sessions-screen.tsx`: `SessionsScreenContent` is exported and takes an optional
    `tab` binding; the header is hidden in a tab; `useHistorySearchTabs` supplies the AI search
    and the Enter handler.
  - `components/ui/search-field.tsx`: optional `onSubmit`. `components/history-ai-search.tsx`
    and `hooks/use-history-ai-search.ts`: an optional initial question.
  - `compact-workspace-header/tab-switcher.tsx` and `workspace-tab-menu.ts`: the label and the
    close-button test id for the new kind.
- **Re-apply:** Add the tab kind everywhere a kind is enumerated (model, identity, storage schema,
  manifest, register). Render the History screen's content in the panel with the tab's query, and
  route Enter in both History fields through `openHistorySearchTab` (History screen) or the pane's
  `openTab` (inside a tab).
- **Verify:** `workspace-tabs/identity.test.ts` is in the update script. By hand: open History,
  type a word and press Enter: the app goes to the last workspace with a tab named after the word.
  Ask AI a question and press Enter: another tab, with the Sparkles icon, shows the picks.

## chat-comments: right-click selected response text to comment on it

- **Added:** 2026-10-28 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: comment on parts of a response`
- **Why:** Reviewing a long answer means replying to several parts of it. Quoting each one by hand
  is slow.
- **What:** On desktop and web, right-clicking text selected inside a response opens a menu with
  **Comment** and **Copy** in place of the browser menu. Comment opens a small box at the click
  showing the excerpt; Enter (Shift+Enter for a new line) adds the excerpt as a `>` quote and the
  comment under it to the end of that agent's composer, and focuses the composer. Several comments
  pile up there and go with the next message. Text comments only for now: no highlight stays on the
  commented text, and selections outside responses (tool calls, user messages) keep the browser
  menu. Native has no right click, so it has no comments.
- **Files:** `packages/app/src/chat-comments/` (`model.ts` formats the quote, `registry.ts` lets
  a chat reach its composer, `surface.web.tsx` the menu and the box, `surface.tsx` the native
  pass-through).
- **Core files touched** (marked `CUSTOM(chat-comments)`):
  - `chat-esc-focus/surface.web.tsx`: wraps `AssistantSelectionCopySurface` in
    `ChatCommentSurface`.
  - `composer/index.tsx`: `useRegisterChatComposerAppend` appends the comment to the input.
- **Re-apply:** Listen for `contextmenu` around the chat timeline; when
  `createAssistantSelectionClipboardContent` returns text for the selection, prevent the default
  menu and open a `ContextMenu` at the click. Each composer registers an append function for its
  agent, beside the chat-esc-focus focus registration.
- **Verify:** `chat-comments/model.test.ts` is in the update script. By hand: select part of a
  response, right-click, Comment, type and press Enter: the composer gets the quote and the comment.

## cache-warmup: big idle Claude sessions get a ping before their cache expires

- **Added:** 2026-10-28 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: keep the prompt cache of big idle Claude sessions warm`, then
  `custom: hide cache keep-alive pings and add a toggle for them`,
  `custom: cache keep-alive counts from the last turn, not agent activity`,
  `custom: a cache keep-alive ping no longer notifies`
- **Why:** Anthropic's prompt cache lives an hour after its last use. A session over 100k tokens
  left idle loses it, and the next message pays to write the whole context again. The pings and
  their "pong" replies cluttered the chat and raised an "Agent finished / pong" OS notification,
  and some sessions are not worth keeping warm.
- **What:** Every 30 s the app looks for Claude sessions that are idle, over 100k context tokens
  (the composer's context meter), open in a tab of any workspace or Desk, and whose cache was last
  used 57 to 60 minutes ago. Cache use is the later of the agent's last user message and the last
  time this app saw its turn start or end (kept in memory). The agent's activity time doesn't
  count: the daemon moves it for things that send nothing to Claude (reloading the agent when
  Paseo reopens, a title change, a label write), so tabs reopened the next day got pinged. Each gets the message "Keep-alive ping to keep the prompt cache warm.
  Reply with just: pong", once per idle stretch; the reply starts the next 57 minutes. Past the
  hour the cache is already gone, so the session is left alone; that also keeps tabs left open for
  days from being pinged. A session stays warm for as long as its tab stays open, with one ping
  every 57 minutes. Another window or device showing the same agent sees its activity move after
  the first ping and skips it. Only the app pings, so with every Paseo window closed nothing does.
  The chat hides each ping and everything after it up to the next user message. The daemon
  doesn't count a ping's turn as finished: no OS or push notification, and the agent isn't marked
  unread. A flame toggle
  after the Ctrl+M chip in a Claude session's composer turns pings off for that session (on by
  default, saved per session in app storage). On, the flame is filled in a muted red; off, it is a
  gray outline. Its tooltip says whether it is on and how many minutes until the cache goes cold.
- **Files:** `packages/app/src/cache-warmup/` (`model.ts` the rule, the tooltip text and the chat
  filter, `cache-warmup.tsx` the timer, `store.ts` the sessions turned off, `toggle.tsx` the
  toggle); `packages/protocol/src/cache-warmup.ts` (the ping text, shared with the daemon).
- **Core files touched:** `app/_layout.tsx` renders `<CacheWarmup />` in `ProvidersWrapper`;
  `agent-stream/view.tsx` runs `hideCacheWarmupTurns` on the stream tail and head before
  `useRetainedValue`; `composer/agent-controls/index.tsx` passes `cacheWarmupAgentId` from
  `AgentControls` to `ControlledAgentControls`, which renders `<CacheWarmupToggle>` after
  `ModelPickerShortcutChip`; server `agent/agent-manager.ts` `checkAndSetAttention` returns
  before setting "finished" attention when the turn's last user message is the ping, read with
  `getLastUserMessage` added to `agent/agent-timeline-store.ts` (all marked
  `CUSTOM(cache-warmup)`).
- **Re-apply:** Mount a root component that records in `useCacheWarmupStore.lastTurnSeenAt` when an
  agent's status goes into or out of `running` (a `useSessionStore.subscribe`), and every 30 s reads
  the session store (agent status, `lastUsage.contextWindowUsedTokens`, `cacheLastUsedAt` of
  `lastUserMessageAt` and the recorded turn time; never `lastActivityAt`), the workspace layouts
  and the Desks, and sends `client.sendAgentMessage` to what `pickAgentsToWarm`
  returns, skipping the keys in `useCacheWarmupStore`. Filter the items the agent stream view
  renders through `hideCacheWarmupTurns`, and render `CacheWarmupToggle` at the end of the
  composer's agent control row. In the daemon's running-to-idle "finished" branch, skip attention
  when the last user message in the timeline is the ping.
- **Verify:** `cache-warmup/model.test.ts` and the server's
  `agent-manager.test.ts -t "keep-alive ping"` are in the update script. By hand: leave a Claude session
  over 100k tokens idle with its tab open; 57 minutes later the session's activity moves but no
  ping or "pong" shows in the chat and no "Agent finished" notification appears. Close Paseo with such a tab open and reopen it more than an
  hour later: the flame's tooltip says "Cache is cold" and the session is never pinged. Hover the flame: "Cold in N min". Click it: the flame turns
  to a gray outline and that session is no longer pinged.

## tab-lanes-sticky: only tabs you moved keep their spot

- **Added:** 2026-10-28 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: Desk tabs pack left unless you moved them`
- **Why:** With [tab-lanes](#tab-lanes-desk-tabs-sit-in-free-rows-drop-a-tab-anywhere) every tab
  kept its spot, so closing a tab the user never touched left a hole. They want tabs tidy by
  default, with only the ones they placed by hand staying put.
- **What:** A tab is **sticky** once you drag it to a spot (or pin it); only sticky tabs have a
  stored position. Every other tab packs to the left, row after row, in the pane's list order,
  flowing around the sticky ones, so closing or opening an untouched tab never leaves a gap. A
  dropped tab that lands less than 48 px from the tab on its left snaps against it, so a drag that
  reorders leaves no sliver. **Tidy tabs** makes every tab of the pane loose again. Moving to this
  version clears the stored positions once (store `custom-tab-lanes` version 2), since version 1
  stored a spot for every tab.
- **Files:** `packages/app/src/tab-lanes/model.ts` (`flow`, `firstFit`, the snap in
  `dropOnLanes`, `sticky` in `LaneLayout`), `store.ts` (stores only sticky spots, per pane; the
  version 2 migration), `lanes.tsx` (no longer stores a spot for new tabs; the drop preview starts
  from the sticky spots). Marked `CUSTOM(tab-lanes-sticky)`. No core files.
- **Re-apply:** Keep positions only for dropped or pinned tabs. When laying out, settle those, then
  place the rest in list order at the first spot from a running cursor that fits between them.
- **Verify:** `tab-lanes/model.test.ts` (already in the update script) covers packing around
  sticky tabs, a closed untouched tab and drops. In the app, Tasks mode with Flexible tab movement
  on: close a tab you never moved; the tabs to its right slide left. Drag one tab to the middle;
  close another; the dragged one stays.

## task-double-click: double-clicking a task opens it in a new tab

- **Added:** 2026-10-28 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: double-clicking a task opens it in a new tab`
- **Why:** A click on a task in the Tasks sidebar swaps the Desk's preview tab to it. The user
  wants that, but also a quick way to open a task beside the current one without losing it.
- **What:** Double-clicking a task row (web and desktop) opens it in a new kept tab and leaves
  the preview tab showing what it showed before. The double click's first click already swapped
  the preview tab, so the row saves the Desks before each click and the double click restores
  them, then opens the task pinned. The snapshot only counts for 1 s.
- **Files:** `packages/app/src/task-navigation/sidebar.tsx` (`TaskRow`: `beforeClick`,
  `openInNewTab`, `DOUBLE_CLICK_MS`), `use-middle-click.ts` (optional `onDoubleClick`, a
  `dblclick` listener). Marked `CUSTOM(task-double-click)`. No core files.
- **Re-apply:** In the task row, before opening on a click, keep `desks` and `activeDeskId` from
  `useDesksStore` unless a snapshot from the last second exists. On the row's DOM `dblclick`, put
  them back with `useDesksStore.setState` and open the task with `pin = true`.
- **Verify:** `e2e/task-navigation.spec.ts` (already in the update script), "Desks preview and
  pin": double-clicking a task leaves the preview on the other task and adds one kept tab. In the
  app, Tasks mode: click task A (preview), double-click task B; A stays in the italic tab and B
  opens in a new upright tab.

## desk-preview-tabs: the "Preview tabs" setting, off by default

- **Added:** 2026-10-31
- **Commit:** `custom: Preview tabs setting; off, a task click opens its own tab`
- **Why:** The user prefers every task click in Tasks mode to open a tab of its own, with no
  shared preview tab that the next click replaces.
- **What:** Settings > Bruno's Customizations > Tabs > **Preview tabs**, off by default. Off, every Desk open keeps its
  tab (a task already open just gets focus), no tab reads as a preview (italic label, Keep tab
  button) and a preview left from before the setting changed becomes a kept tab on the next open.
  On restores the earlier behavior: a click replaces the preview tab and a double click
  ([task-double-click](#task-double-click-double-clicking-a-task-opens-it-in-a-new-tab)) or
  middle click keeps it. Saved with the app settings, so each launcher profile has its own.
- **Files:** `packages/app/src/task-navigation/preview-tabs.ts` reads the setting inside and
  outside React.
- **Core files touched** (marked `CUSTOM(desk-preview-tabs)`):
  `hooks/use-settings/storage.ts` (`deskPreviewTabs` field, default, schema),
  `task-navigation/desks-store.ts` (`openTab`), `task-navigation/desk-screen.tsx` (preview id
  and empty-Desk hint), `screens/settings/editor-section.tsx` (the switch row),
  `packages/desktop/e2e/task-navigation.spec.ts` (seeds the setting on, since it tests previews).
- **Re-apply:** Add `deskPreviewTabs: boolean` to `AppSettings` with default and schema fallback
  `false`. In the Desks store's `openTab`, when the setting is off, clear the Desk's
  `previewTabId` and open with `pin = true`. In `DeskScreen`, treat `previewTabId` as null while
  it is off. Keep `DeskScreen` under the lint complexity limit (helpers live outside it). Any
  spec or unit test that checks preview tabs turns the setting on first.
- **Verify:** `task-navigation/store.test.ts` ("opens every task in its own tab while preview tabs
  are off") and `e2e/task-navigation.spec.ts`, both in the update script. In the app, Tasks mode:
  click task A, then task B; both stay open as upright tabs. Turn Preview tabs on in Settings > Bruno's Customizations >
  Tabs and B replaces A in an italic tab.

## lazy-model-switch: switching a Claude agent's model answers at once

- **Added:** 2026-10-29 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: switching a Claude agent's model no longer relaunches Claude Code`
- **Why:** Clicking the model chip ([chip-cycle](#chip-cycle-clicking-the-model-or-effort-chip-cycles-favorites-its-chevron-opens-the-menu))
  in a long chat with images took a second or more, while the effort chip was instant. Changing
  the effort only records it for the next launch. Changing the model called `ensureQuery()`,
  which, when no Claude Code process was live or the live one was due a restart (any effort
  change marks it so), killed the old process and spawned a new one that resumes the whole
  transcript, all before the switch answered.
- **What:** `ClaudeAgentSession.setModel` sends `setModel` to the Claude Code process only when a
  live, current query exists. Otherwise it records the model in `config.model`, which
  `buildOptions()` passes on the next launch, and turns off fast mode in config when the new model
  lacks it.
- **Core files touched:** `packages/server/src/server/agent/providers/claude/agent.ts`
  (`setModel`), marked `CUSTOM(lazy-model-switch)`.
- **Re-apply:** In the Claude session's `setModel`, replace `await this.ensureQuery()` with
  `this.query && !this.queryRestartNeeded ? this.query : null`; call the query's `setModel` and
  `applyFastModeFeature` only when that is non-null, else set `featureValues.fast_mode = false`
  directly. Drop this if upstream stops launching a query in `setModel`.
- **Verify:** `providers/claude/agent.test.ts -t "switches the model"` (in the update script). In
  the app, in a long Claude chat with images, click the effort chip and then the model chip: the
  model changes at once, and the next message runs on it. Daemon-side, so it needs a daemon
  restart.

## backspace-image: Backspace in an empty composer removes the last image

- **Added:** 2026-10-29 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: Backspace in an empty composer removes the last attached image`
- **Why:** After pasting a picture by mistake the user had to reach for the thumbnail's X. Tag
  inputs let Backspace delete the last chip; the composer should too.
- **What:** On web and desktop, Backspace with no modifier and nothing typed in the composer
  removes the last image attachment (other attachments are skipped). With any text, even a space,
  Backspace edits the text as usual.
- **Files:** `packages/app/src/composer/backspace-attachment.ts` (`imageIndexToRemoveOnBackspace`)
  and its test.
- **Core files touched:** `composer/index.tsx`: `handleCommandKeyPress` calls
  `imageIndexToRemoveOnBackspace` right after the parent's `onKeyPress`, and on a hit calls
  `handleRemoveAttachment(index)` (marked `CUSTOM(backspace-image)`).
- **Re-apply:** In the composer's key handler that gets `ComposerKeyPressEvent` (the one that
  runs autocomplete and the empty-composer shortcuts), when the key is `Backspace`, there is no
  modifier and `event.input.text` is empty, find the last `kind: "image"` in the selected
  attachments, `preventDefault()`, remove it through the same function as the thumbnail's X, and
  return true.
- **Verify:** `composer/backspace-attachment.test.ts` is in the update script. By hand: paste two
  images into an empty composer and press Backspace twice; each press removes the last one. Type
  a letter with an image attached; Backspace deletes the letter and keeps the image.

## shortcut-additional-bindings: up to five shortcuts per command

- **Added:** 2026-10-29 (based on upstream v0.13.0, `7f9b65d46`)
- **Commit:** `custom: a command takes up to five shortcuts`
- **Why:** The user wants more than one key combination for the same command, without giving up
  the default.
- **What:** Settings → Shortcuts: the row menu gains **Bind additional** (once the command has a
  shortcut and fewer than five) and one **Remove <keys>** item per extra shortcut. The row lists
  every shortcut, primary first. **Clear** removes all of them; **Reset to default** drops the
  extras and restores the default. Extras fire exactly like the primary binding (same `when`,
  payload and focus rules, minus the default-combo `editable` guard, like any override). The
  cheat sheet lists them and its search finds a row by them. Badges, tooltips and the command
  center keep showing only the primary shortcut.
- **Storage:** extras are ordinary entries in the existing override map, keyed
  `<binding id>#2` .. `#5`. No new storage key or schema; Reset all clears them too. Removing a
  middle extra leaves a gap that the next Bind additional fills.
- **Core files touched (app):** `keyboard/keyboard-shortcuts.ts` (`MAX_SHORTCUTS_PER_ACTION`,
  `additionalBindingIds`, `resolveAdditionalShortcutsForAction`, `buildEffectiveBindings` appends
  extras after every primary binding, help rows get `additionalChords`),
  `keyboard/shortcut-override-store.ts` (`apply` for multi-key changes in one write),
  `hooks/use-keyboard-shortcut-overrides.ts` (`applyOverrides`),
  `screens/settings/keyboard-shortcuts-section.tsx`, `components/keyboard-shortcuts-dialog.tsx`,
  `keyboard/shortcut-help-search.ts`, and `settings.shortcuts.actions.bindAdditional` /
  `removeKeys` in all nine `i18n/resources/*.ts`. Marked `CUSTOM(shortcut-additional-bindings)`.
- **Re-apply:** In `buildEffectiveBindings`, after mapping the defaults, append for each default
  binding and each id in `additionalBindingIds(binding.id)` a copy of the binding with the
  override's combo (same parsing/guard stripping as a primary override) and `id` set to the slot
  id, skipping empty or unparseable values. Appending keeps primary bindings first in matching.
  In `buildKeyboardShortcutHelpSections`, when a later binding hits an already-seen row and its id
  ends in `#<n>`, push its display chord to `row.additionalChords`. In the settings section,
  capture into a target id (the row's binding id or the first free slot) instead of the row's
  binding id, and route Clear/Reset through one `applyOverrides` call that also deletes the
  extras.
- **Verify:** `keyboard-shortcuts.test.ts` ("additional shortcuts"), `shortcut-override-store.test.ts`
  and `shortcut-help-search.test.ts` plus the desktop e2e
  `keyboard-shortcut-unassign.spec.ts --grep 'additional shortcuts'` (all in the update script).
  By hand: Settings → Shortcuts → Toggle command center → ⋯ → Bind additional, press a combo,
  Done; both combos open the command center.
- **Known:** the older e2e "unassigning a shortcut leaves it inert until it is reset" already
  fails on `custom` before this change (two rows show "Not set"), which is why the update script
  greps around it.

## waiting-turn-judge: a turn that ends "I'll wait for the build" is not finished

- **Added:** 2026-10-29 (based on upstream v0.14.0)
- **Commit:** `custom: a turn that ends waiting on a build no longer marks the agent finished`
- **Why:** Agents end turns with "the build is running, I'll wait for the notification" or "te aviso
  assim que terminar". Paseo marked those agents "ready to review" and notified, with nothing to
  review.
- **What:** When a turn goes from running to idle, the daemon scores the last 500 characters of the
  agent's last message (Portuguese and English). Strong waiting phrases ("vou esperar", "te aviso
  assim que", "I'll wait", "I'll let you know once") count 2, weak ones ("ainda está rodando",
  "once it finishes", "still running") count 1; done words ("pronto", "done") and a closing question
  count against. Waiting score 0 is finished as before; 2 or more with no done words is waiting and
  the agent is not marked finished. Anything between asks the metadata model (Haiku by default, set
  in `agents.metadataGeneration`) whether the agent is still waiting. A model that errors counts as
  not waiting, so the user is notified. Waiting on the user ("vou esperar sua resposta") scores
  nothing. The next turn that ends clear of waiting words marks it finished.
- **Files:** `packages/server/src/server/agent/waiting-turn.ts` (score, judge prompt and schema),
  its test; tests at the end of the monitor/keep-alive tests in `agent/agent-manager.test.ts`.
- **Core files touched:** `agent/agent-manager.ts` (`checkAndSetAttention`, `setWaitingTurnJudge`,
  `raiseFinishedAttention`, `judgeThenRaiseFinished`); `bootstrap.ts` wires the judge with
  `createAgentStructuredTextGeneration` before `setAgentArchivedCallback` (all marked
  `CUSTOM(waiting-turn-judge)`).
- **Re-apply:** In `checkAndSetAttention`, after the cache-warmup check, read
  `timelineStore.getLastAssistantMessage`, return on `waiting`, and on `unsure` run the judge in a
  tracked background task that raises attention when it says "not waiting" (and the agent is still
  idle with the same last message). Set the judge in bootstrap from the metadata generation.
- **Verify:** `npx vitest run src/server/agent/waiting-turn.test.ts` and the `a turn that ends
waiting` tests in `agent-manager.test.ts`.

## task-navigation-compact: Tasks list in the phone sidebar

- **Added:** 2026-10-29 (upstream 0.11.2)
- **Commit:** `custom: phone sidebar shows the Tasks list and opens a task in its workspace`
- **Why:** The Tasks switch is desktop only (the header has no room on a phone, and Desks are a
  desktop layout), so the phone had no cross-project list to follow running and recent sessions.
- **What:** On a compact layout with Tasks mode off, the sidebar gets a **Tasks | Workspaces**
  switch above its list. Tasks (the default) shows the same Tasks & crews list as the desktop;
  tapping a task opens it as the agent tab of its own workspace, like tapping a workspace row, and
  the open agent's row is highlighted. Workspaces shows the original list. The choice is saved per
  installation (`compactTasks` in `custom-task-navigation`). Wide layouts are unchanged, and a
  compact window with the desktop Tasks switch on keeps Desks as before.
- **Files:** `packages/app/src/task-navigation/store.ts` (`compactTasks`, optional in the schema so
  older saved state still loads) and `task-navigation/sidebar.tsx` (`SidebarNavigationMode`,
  `CompactSidebarModeSwitch`, `useWorkspaceFocusedAgentKey`, the non-Desk branch of `openTask`).
- **Core files touched:** none.
- **Re-apply:** In the mode boundary, keep the desktop rule (`enabled` → Tasks sidebar, wide →
  children) and add the compact branch with the switch. In `openTask`, when `enabled` is off, call
  `navigateToWorkspace` with the agent target and `pin: true` instead of opening a Desk tab. Without
  Desks, take the highlighted row from the active workspace's focused agent tab.
- **Verify:** `store.test.ts` and the "Phone sidebar" case in `e2e/task-navigation.spec.ts`
  (390×844), both already in the update script. On the phone itself this needs an app build from
  this branch; the store app is upstream and has none of these customizations.

## task-filters-toggle: the arrow beside "Tasks & crews" hides the filters

- **Added:** 2026-10-30 (upstream 0.14.0)
- **Commit:** `custom: the arrow beside Tasks & crews hides search, sort and filters`
- **Why:** In the phone sidebar the search, project picker, sort and status chips took so much
  height that little room was left for the tasks themselves.
- **What:** The "Tasks & crews" header is a button with an arrow (⌄ open, › closed). Pressing it
  hides or shows the search, project picker, sort and status filters, on desktop and phone. The
  choice is saved per installation (`filtersCollapsed` in `custom-task-navigation`). The search,
  projects and filter still apply while hidden.
- **Files:** `packages/app/src/task-navigation/store.ts` (`filtersCollapsed`, optional in the
  schema so older saved state still loads), `task-navigation/sidebar.tsx` (`TaskFiltersToggle`).
  Marked `CUSTOM(task-filters-toggle)`. The same commit swaps the file's raw `Pressable`s (task
  row, crew expand arrow) for `PressHighlight`: upstream 0.14's `no-raw-pressable` lint blocked
  committing the file. Without `highlightStyle` it renders the same `Pressable`.
- **Core files touched:** none.
- **Re-apply:** Replace the sidebar's static "Tasks & crews" title with a pressable row holding
  the title and a `ChevronDown`/`ChevronRight`, and render the controls block only when
  `filtersCollapsed` is false.
- **Verify:** `store.test.ts` and the "Phone sidebar" case in `e2e/task-navigation.spec.ts`, both
  already in the update script. In the app, press the arrow: the controls disappear, the list
  moves up, and they stay hidden after reopening the app.

## chat-links: a list of the links the agent sent, beside the chat

- **Added:** 2026-10-30 (upstream 0.14.0)
- **Commit:** `custom: link list beside the chat`
- **Why:** Agents scatter URLs and file paths across a long chat. Opening one again meant
  scrolling back to the message that had it.
- **What:**
  - A box at the bottom of the right gutter, under the
    [image strip](#chat-images-an-image-strip-beside-the-chat), listing every distinct URL and
    HTML or Markdown file (`.html`, `.htm`, `.md`, `.markdown`) the agent's messages link:
    Markdown links, linked code spans (`` `/tmp/x.md` ``), and bare URLs and paths in text. Source
    files and folders are left out on purpose: the list is for reports and notes to reopen.
  - Mentions that only look like links are dropped (`model.ts`, tested in `model.test.ts`): an
    extension on its own (`.md`), globs and templates (`*.md`, `<name>.md`, `${id}.html`, `...`),
    any URL that is not http(s) with a dotted host, `localhost` or an IP (the resolver calls
    `custom: some text` a URL), example hosts (`example.com`, `.invalid`), and a bare `notes.md`
    when the same name is listed with its folder. Oldest
    at the top; a link sent again moves to the bottom. Ten rows show at once and the rest scroll;
    the list follows new links unless you scrolled up.
  - Settings > Bruno's Customizations > Chat > **Link list** turns it off (`chatLinksEnabled` in the app settings, on by
    default). Off, the image strip goes back to its usual height.
  - Each row shows the file name (with `:line`) or the URL without its scheme. Hovering a row opens
    the same card as hovering the link in the message
    ([chat-file-actions](#chat-file-actions-file-links-in-the-chat-resolve-to-full-paths-and-get-a-hover-card-of-actions):
    full path or URL, copy, open in a tab, open in the browser), through `useFileLink` and
    `wrapWithFileLinkHover`. Click opens it the same way clicking it in the message does, through
    the same `AssistantFileLinkResolverProvider`.
  - It sits above the composer pills (the scroll-to-bottom button's offset), and the image strip
    ends above it instead of at 20% from the bottom when the box is taller.
  - Width up to 280 px when the gutter fits at least 168 px. A narrower gutter shows a link
    button that opens the list over the transcript; one too narrow for the button hides it.
    Desktop and web only.
  - It lists the loaded part of the history. Links in your own messages and in tool calls are not
    listed.
- **Files:** `packages/app/src/agent-stream/chat-links/` (`model.ts` parses and dedupes the links,
  `box.web.tsx` is the box, `box.tsx` the native no-op, `model.test.ts`). New files; no conflict
  risk. The same commit swaps the image strip's raw `Pressable` for `PressHighlight`, which
  upstream 0.14's `no-raw-pressable` lint requires to commit the file.
- **Core files touched** (each marked `CUSTOM(chat-links)`):
  - `packages/app/src/agent-stream/view.tsx`: `chatLinks` and `chatLinksReservedHeight` next to
    the chat-images state, and `<ChatLinksBox>` right after `<ChatImagesRail>`, which gets
    `bottomReserve`.
  - `packages/app/src/hooks/use-settings/storage.ts`: `chatLinksEnabled` in the type, the
    defaults and the schema, next to `chatOutlineEnabled`; a test in `storage.test.ts`.
  - `packages/app/src/screens/settings/chat/chat-section.tsx`: the **Link list** switch after
    the chat outline switch.
  - `packages/app/src/components/markdown/source.ts`: exports the renderer's bare URL and path
    regex as `PROSE_LINK_PATTERN`, so the list finds exactly the text links the chat draws.
- **Re-apply:** In the agent stream view, collect links with
  `collectChatLinks([...tail items, ...head items], workspaceRoot)` and render `ChatLinksBox` beside
  the image strip, passing the same client, server, workspace root, session paths, inline path
  handler and toast the assistant message's `AssistantFileLinkResolverProvider` gets, the
  scroll-to-bottom button's bottom offset, and a setter whose value goes to the strip's
  `bottomReserve`. Pass an empty list when `chatLinksEnabled` is off. If upstream renames the renderer's text link regex, re-export the new one.
- **Verify:** `(cd packages/app && npx vitest run src/agent-stream/chat-links/model.test.ts)` (the
  update script runs it). In the app, ask an agent to reply with a URL, a file path in backticks
  and a folder path, then hover and click the rows at the bottom right.

## tldr-prompt: the TLDR pill's chevron edits its message; `/tldr` sends it

- **Added:** 2026-10-30 (upstream 0.14.0)
- **Commit:** `custom: the TLDR pill's chevron edits the message it sends; /tldr sends it too`
- **Why:** `TLDR` alone gets a different shape of answer each time. A saved message ("TLDR in 3
  bullets, in Portuguese") gets the same one, and `/tldr` sends it without leaving the keyboard.
- **What:**
  - The TLDR pill is split: the left half sends, a chevron on the right opens the **TLDR message**
    modal (multi-line text, **Use default**, Cancel, Save).
  - The message lives in the plugin's host settings (`tldrSettings` in
    `custom/plugins/tldr/shared/tldr.ts`, id `prompt`), so each daemon keeps its own and it
    survives reopening the app and restarting the daemon. Empty is rejected; nothing saved means
    `TLDR`.
  - `/tldr` in an agent's composer sends the same saved message, through the same `sendTldr`.
  - The split is a generic plugin button option: `chevron: { title, Content }` on a composer pill.
    The host draws the chevron inside the pill's border and mounts `Content` until it calls
    `close()`; `Content` renders its own `Modal`. Header buttons ignore it.
- **Files:** `custom/plugins/tldr/` (`index.server.ts` registers the settings, `client/prompt.ts`
  sends, `client/prompt-modal.tsx` is the modal, `index.client.tsx` adds `/tldr`).
- **Core files touched** (each marked `CUSTOM(pill-chevron)`):
  - `packages/plugin/src/client/buttons.ts`: the optional `chevron` field on `PluginButton`.
  - `packages/app/src/plugins/buttons/validation.ts`: `validateChevron`, which resolves the title
    and checks `Content`; `chevron` in `ResolvedPluginButton`. Test in `model.test.ts`.
  - `packages/app/src/plugins/buttons/view.tsx`: in `ButtonControl`, a composer pill with a
    chevron wraps the usual control and `ButtonChevron` in a `splitPill` view that owns the
    border, and the action half takes `splitAction` instead of `composerPillStyles.body`.
- **Re-apply:** Add `chevron?: { title; Content: ComponentType<PluginButtonContentProps> }` to the
  plugin button type and resolve it next to `behavior` in the app's button validation. Where the
  app renders a composer pill, when `chevron` is set, put the pill's control and a chevron
  `Pressable` side by side in one bordered row, and mount `Content` (inside the button's
  `ButtonEnvironment` and error boundary) while the chevron is open. Rebuild `@getpaseo/plugin`
  (`npm run build --workspace=@getpaseo/plugin`) so the app sees the new type.
- **Setup:** The plugin now has a server entry: after updating, run
  `npx tsx packages/cli/src/index.js plugin reload tldr --home ~/.paseo` (and `~/.paseo-telus`).
  The chevron needs the rebuilt app; an older app shows the plain pill.
- **Verify:** `npx vitest run custom/plugins/tldr packages/app/src/plugins/buttons/model.test.ts`
  (the update script runs both). In the app, click the chevron on **TLDR**, save "TLDR em 3
  linhas", reopen the app, click the chevron again: the text is still there. Click **TLDR** and
  type `/tldr`: both send it.

## recent-tabs: Ctrl+Tab walks the tabs in the order you visited them

- **Added:** 2026-10-31 (based on upstream v0.14.0)
- **Commit:** `custom: Ctrl+Tab walks the tabs in the order you visited them`
- **Why:** The user switches back and forth between a few tabs and wants Ctrl+Tab to work like
  Alt+Tab, not to step to the tab beside. The tab beside moves to Ctrl+PageUp/PageDown, which the
  user binds in Settings (their Silakka54 sends those from Space+D / Space+F).
- **What:** Two new commands in Settings → Shortcuts → Tabs & panes, both rebindable:
  **Last visited tab (hold to go further back)** (default Ctrl+Tab) and **Visited tabs in
  reverse** (default Ctrl+Shift+Tab). On web (desktop and browser), a press opens a switcher in
  the middle of the screen listing the tabs in visit order, like Alt+Tab, with the tab the walk
  is on highlighted; holding the modifier and pressing again moves the highlight further back.
  The tab only changes when the walk ends: releasing Ctrl, Alt or Meta, a mouse move or click
  without them, the window losing focus, or 10 s without a press. Escape closes the switcher
  without switching, and a click on a row (modifier still held) switches to it. The 10 s cover a
  modifier released inside a browser tab or HTML preview, whose key events never reach the app
  window. The tab you land on becomes the most recent. On native there is no switcher: each
  press switches right away, so it toggles between the last two tabs. **Settings > Bruno's Customizations > Tabs >
  Skip pinned tabs** (off by default; the user has it on) leaves the
  [pinned tabs](#tab-pins-pin-tab-keeps-a-tab-at-the-left-of-its-row) out of the walk; from a pinned tab,
  the first press goes to the most recent unpinned one. Each workspace and each Desk keeps its own
  visit order, in memory (gone after a reload); open tabs never visited come last. In a
  workspace or a Desk only the main content's tabs count: tabs in the bottom panel and the Explorer pane
  are never visits nor stops, so the walk never reopens a panel you closed with Ctrl+J. From a
  focused bottom-panel tab, the first press goes to the most recent main tab. "Previous
  tab" / "Next tab" keep their upstream defaults (Alt+Shift+[ / ]).
- **Files:** `packages/app/src/workspace-tabs/recent-tabs-model.ts` (order, walk and
  `walkableTabIds`, pure, tested in `recent-tabs-model.test.ts`),
  `packages/app/src/workspace-tabs/recent-tabs.ts` (visit record, the walk as a small external
  store read by `useRecentTabWalk`, release/Escape listeners, the pinned-tab filter,
  `mainContentTabIds` / `mainContentTabId`, which leave the bottom panel and Explorer pane out,
  and `useWorkspaceRecentTabs`, which records the visit; tested in `bottom-panel.test.ts`),
  `packages/app/src/workspace-tabs/recent-tab-switcher.tsx` (the switcher, rows from
  `WorkspaceTabPresentationResolver` + `WorkspaceTabOptionRow`).
- **Core files touched (app):** each marked `CUSTOM(recent-tabs)`:
  `keyboard/actions.ts` (`workspace.tab.navigate.recent`),
  `keyboard/keyboard-action-dispatcher.ts` (`workspace.tab.navigate-recent` with `delta`),
  `keyboard/route-shortcut.ts` (`TAB_DELTA_DISPATCH` routes it and the relative tab action
  before the switch, which sits at the lint complexity limit),
  `keyboard/keyboard-shortcuts.ts` (the two bindings after "Next tab", their rows in
  `SHORTCUT_HELP_ROW_ORDER`), `screens/workspace/workspace-screen.tsx` and
  `task-navigation/desk-screen.tsx` (an effect records the focused tab as a visit; a separate
  `useKeyboardActionHandler` with the same priority as the screen's tab actions handles the
  command; `<RecentTabSwitcher>` is rendered over the content, inside `DeskProviders` in a Desk),
  `hooks/use-settings/storage.ts` (`recentTabsSkipPinned`, default `false`),
  `screens/settings/editor-section.tsx` (the Skip pinned tabs row).
- **Re-apply:** Add the action id, the dispatcher definition and its route (any way that keeps
  `routeKeyboardShortcut` under the complexity limit). Add the two bindings with
  `payload: { type: "delta", delta: ±1 }` and help rows in the tabs section. In each screen that
  owns tab navigation, call `recordTabVisit(scope, focusedTabId)` when the focused tab changes and
  handle the action with `stepRecentTab({ scope, openTabIds, currentTabId, delta, navigate })`,
  where `navigate` focuses a tab the same way "Next tab" does. `openTabIds` and `currentTabId` are
  main content only: `useWorkspaceRecentTabs` in a workspace, `mainContentTabIds` /
  `mainContentTabId` in a Desk, whose bottom panel uses the same pane id. The scope must be the
  same key the tab pins use (the workspace key, `desk:<id>`). Render
  `<RecentTabSwitcher scope tabs ownerOf>` as the last child of the screen's content column, under
  the providers the tab descriptors read. Add the boolean app setting and its row.
- **Verify:** `recent-tabs-model.test.ts`, plus the Ctrl+Tab cases in `keyboard-shortcuts.test.ts`
  and `route-shortcut.test.ts` (all in the update script). By hand: open tabs A, B, C, visit A
  then C; Ctrl+Tab shows the switcher with A highlighted and goes to A on release, Ctrl+Tab again
  to C; holding Ctrl and pressing Tab twice from C moves the highlight to B without switching, and
  releasing Ctrl switches to B. Escape while holding closes the switcher and stays on C. Pin A and
  turn on Skip pinned tabs: A drops out of the switcher. Open the bottom panel on a terminal, close it with Ctrl+J, then Ctrl+Tab: the panel
  stays closed, in a workspace and in Tasks mode. If an old override still puts "Next tab" on Ctrl+Tab, that row wins: rebind it in
  Settings.

## chat-options: choose the pills above the chat composer

- **Added:** 2026-11-09
- **Commit:** `custom: add chat option toggles`
- **Why:** Let Bruno hide individual chat pills without disabling their features or plugins.
- **What:** Settings > Bruno's Customizations > Chat Options controls built-in and plugin pills.
  Missing preferences default to visible. Registered plugin pills also get a toggle, keyed by
  plugin and pill rather than session, so the choice applies across agents and hosts.
  The page also controls the composer's toolbar and shows an icon for each choice; Critic and Jev
  retain their existing preferences. Hiding a control does not disable its keyboard shortcuts.
  The page has three blocks, each just a label ("Above chat", "Inside left", "Inside right").
  Inside a block the movable rows have a grip handle and can be dragged; the composer renders
  the items in that order (app setting `chatOptionOrder`, `{above?, left?, right?}` lists of keys;
  `orderChatOptions` puts keys missing from the saved list after their default predecessor, so new
  items and plugin pills appear in place, and an order saved before the attachments, model, effort,
  mode and feature keys existed gets them at the start). In "Inside left" every control moves:
  the attachment "+", Model (provider chip and model selector together), Effort, Agent
  permissions, the features (several `feature:other` features share one slot; the aggregated
  features button sits at the earliest feature key present) and the trailing chips. "+", Model and
  Effort have no switch. Only the right block has fixed rows: Git branch (drawn inside the project
  icon), Send and Stop last. A done Worktree pill still leads the row.
  Plugin pills are individually orderable and default to right after TokenLedger.
- **Core files touched:** `composer/chat-options.ts` (groups, `orderChatOptions`),
  `hooks/use-settings/storage.ts` (`chatOptions`, `chatOptionOrder`),
  `screens/settings/bruno-customizations/chat-options-page.tsx` (the page, `DraggableList`),
  `panels/agent-tracks.tsx` (keyed pills sorted by `above`), `panels/agent-panel.tsx`,
  `plugins/buttons/view.tsx` (`usePluginComposerPillEntries` and `PluginComposerPill` replace
  `PluginComposerPills`), `composer/agent-controls/index.tsx` (the whole left row sorted by `left`; desktop only, compact
  keeps its internals and sorts the trailing chips),
  `composer/attachment-slot.tsx` (context carrying the "+" from the input to the agent controls),
  `composer/index.tsx` (project icon and context meter as separate nodes),
  `composer/input/input.tsx` (provides the "+" through the slot on desktop; `projectContent` prop; project, meter, dictation and voice sorted by
  `right`, then Send), and `composer/project-icon.tsx`.
- **Re-apply:** Store the visibility map and the order lists in app settings; apply them to each
  built-in pill and plugin composer contribution, build each group as keyed nodes sorted with
  `orderChatOptions`, and list the controls in the Chat Options page. Normalize agent-specific
  plugin pill IDs before looking them up.
- **Verify:** Run `storage.test.ts` and `plugins/buttons/model.test.ts`; toggle pills in a chat;
  drag a row in each block (also Model, Effort, Mode and the "+" on the left) and check the composer
  follows, also after a reload; compact layout keeps the "+" first.

## mouse-tab-nav: the mouse's back/forward buttons switch tabs

- **Added:** 2026-11-09
- **Why:** The mouse's back button made Chromium run `history.back()`, which moved between routes
  (often into Settings) instead of tabs.
- **What:** Back (button 3) and forward (button 4) walk the chronological tab history of the
  workspace or Desk. Selecting another tab after going back clears the forward branch. Closed
  and skipped pinned tabs are passed over. The guest preload forwards clicks from browser tabs.
  Ctrl+Tab keeps its separate recent-tab order.
- **Files:** `packages/app/src/hooks/use-mouse-tab-navigation.web.ts` (listeners) and
  `use-mouse-tab-navigation.ts` (native no-op).
- **Core files touched (app):** each marked `CUSTOM(mouse-tab-nav)`: `app/_layout.tsx` (calls
  the hook), `keyboard/keyboard-action-dispatcher.ts` (optional `immediate` on
  `workspace.tab.navigate-recent`), `workspace-tabs/recent-tabs.ts` (`immediate` skips the
  switcher); `workspace-screen.tsx` and `desk-screen.tsx` pass `immediate` through.
- **Re-apply:** Record tab visits in a per-scope history, route immediate mouse actions through it,
  and forward guest button events from the sandboxed preload through the resident webview.
- **Verify:** Run `recent-tabs-model.test.ts`, then test back and forward over a browser tab.

## clear-keeps-agent: `/clear` starts a fresh draft and keeps the old agent

- **Added:** 2026-11-01 (based on upstream v0.14.0)
- **Commit:** `custom: /clear keeps the old agent as an idle task`
- **Why:** The user wants `/clear` to give a clean conversation in the same tab, with the same
  setup, without losing the old one. Upstream archives the old agent.
- **What:** `/clear` (and `/new`) still turns the current tab into a draft with the agent's
  provider, folder, mode, model, effort and features, and still hides the old agent from the
  workspace tabs. It no longer archives it: the old agent shows in the Tasks sidebar and Sessions
  as a normal task (idle once it finishes; a running turn keeps running). `/exit` still archives.
- **Files:** `packages/app/src/client-slash-commands/clear-keeps-agent.ts`
  (`clientSlashCommandArchivesAgent`, tested in `clear-keeps-agent.test.ts`).
- **Core files touched (app):** `panels/agent-panel.tsx` (`handleClientSlashCommand` returns
  before `archiveAgent` when the command does not archive), marked `CUSTOM(clear-keeps-agent)`;
  the `/clear` description in `client-slash-commands/index.ts` and `freshDraft` in
  `i18n/resources/en.ts` and `pt-BR.ts`; the slash clear case in
  `e2e/browser/client-slash-commands.spec.ts` expects the old session not archived.
- **Re-apply:** In the composer's client slash command handler, keep the tab retarget to a draft
  built by `buildDraftAgentSetup`, and skip `archiveAgent` unless the command kind is
  `archive-agent`. Reword the `/clear` description.
- **Verify:** `clear-keeps-agent.test.ts` and `index.test.ts` (in the update script). By hand:
  in an agent tab, send `/clear`: the tab becomes a draft with the same model and mode, and the
  old agent stays in the Tasks sidebar, not archived; clicking it opens it in a tab again.

## worktree-pill-own-project: a worktree opened as its own project gets the Worktree pill

- **Added:** 2026-11-01 (based on upstream v0.14.0)
- **Commit:** `custom: the Worktree pill shows for a worktree opened as its own project`
- **Why:** `~/uprojects/DreamMMO-wt1` is a git worktree of DreamMMO, but it was added as its own
  project, so its folder is the project root. The
  [Worktree pill](#worktree-pill-done-a-done-worktree-session-gets-a-green-worktree-pill-at-the-front)
  hid it, because "folder equals project root" was how it told the main checkout apart (the main
  checkout can also report kind `worktree`).
- **What:** The pill shows when the workspace kind is `worktree` and the checkout's
  `mainRepoRoot` differs from both the workspace folder and its `worktreeRoot`. The checkout
  comes from the workspace's `project.checkout`, or the agent's `projectPlacement.checkout` when
  the workspace came from the app's cache (which drops `project`). Without either, the old
  project-root rule applies.
- **Files:** `isLinkedWorktreeWorkspace` in `packages/app/src/composer/worktree-pill-model.ts`
  (tested in `worktree-pill-model.test.ts`, already in the update script).
- **Core files touched:** `packages/app/src/composer/worktree-pill.tsx` (custom file), marked
  `CUSTOM(worktree-pill-own-project)`.
- **Re-apply:** In the pill's workspace selector, replace the "directory equals project root"
  test with `isLinkedWorktreeWorkspace`, passing the workspace's checkout or the agent's.
- **Verify:** `worktree-pill-model.test.ts`. By hand: open a session in DreamMMO-wt1; the pill
  reads **Worktree: <branch>**. A session in the main DreamMMO or Paseo checkout has no pill.

## git-sync: "Trazer do <worktree>" and "Resolver conflitos" chips above the composer

- **Added:** 2026-11-01 (based on upstream v0.14.0)
- **Commit:** `custom: "Trazer do <worktree>" and "Resolver conflitos" chips`
- **Why:** The user works in worktrees (DreamMMO-wt1) branched off the branch the main checkout
  has checked out, and wants to pull that work in from the main project's sessions, and to hand
  merge conflicts to an agent with a good prompt.
- **What:**
  - **Trazer do <worktree folder>**, last in the main checkout's chip row: one per linked
    worktree whose branch was created from the main checkout's current branch (the branch's
    oldest reflog entry, `branch: Created from <branch>` or `<remote>/<branch>`) and that has
    commits HEAD lacks or uncommitted changes. Its menu item **Fazer merge de <branch> aqui**
    runs, as a `!<command>`, a "wip" commit of the worktree's changes (like the Worktree chip's
    Merge) and `git merge --no-edit <branch>`.
  - **Resolver conflitos** (warning colors): when a checkout has unmerged files. In a linked
    worktree the Worktree chip turns into it in place, also when the main checkout is stuck in a
    conflicting merge of this worktree's branch (its `MERGE_HEAD` is in the worktree's HEAD).
    Elsewhere it is last in the row and replaces the Trazer chips. Pressing it opens a new tab
    with the agent's provider, model, mode and features, in the conflicted checkout (its open
    workspace when there is one), whose draft holds a resolve prompt in Portuguese: operation,
    branches, files, how to read both sides, finish command per operation (`git commit
--no-edit`, `git rebase --continue`, ...), ask before `--abort`/`reset`/whole-file
    ours/theirs. Not sent; the caret is at the end.
  - The Worktree chip's menu gains, in this order: **Sync projects (merge into main, then back
    into the worktree)** first (commits "wip", merges the worktree's branch into the main
    checkout's branch, then merges that back here; stops at the first failure or conflict), then
    the existing Copy path and Merge back, then **Pull changes from main project (merge)** (merges
    the main checkout's branch here; commits nothing, so git refuses when a local change is in the
    way) and **Check sync status between projects**. The last posts a SYNC card in the chat, like
    the BTW card: verdict in the header (In sync / N commits to bring to main · M to pull from
    main · uncommitted files / files in conflict), both checkouts with branch, path, uncommitted
    and conflicted counts, up to 8 commits each side lacks, a `git merge-tree` preview of
    whether merging the two HEADs conflicts, and what to do next.
  - The app polls every 5 s while the composer is mounted (paused in a hidden browser tab), and
    1 s and 2.5 s after a chip runs a merge. Read-only git with `GIT_OPTIONAL_LOCKS=0`; about
    0.25 s on DreamMMO.
- **Files:** `custom/plugins/shell-command/server/git-sync.ts` (`git-sync` RPC, `gitSyncRpc` in
  `shared/shell-command.ts`, tested on real repos in `git-sync.test.ts`);
  `server/sync-report.ts` (`sync-report` RPC, appends the card; `summarizeSync` in
  `shared/shell-command.ts`; tested in `sync-report.test.ts`), `client/sync-report-card.tsx`
  (renderer registered in `index.client.tsx`); `PULL_FROM_MAIN_COMMAND` and
  `SYNC_PROJECTS_COMMAND` in `packages/app/src/composer/worktree-pill-model.ts` (run on real
  repos in its test);
  `packages/app/src/git-sync/` (`model.ts` + test, `use-git-sync.ts`, `pills.tsx`,
  `open-resolve-tab.ts`).
- **Core files touched (app):** `panels/agent-tracks.tsx` (calls `useGitSync`, passes it to both
  Worktree chips, renders `GitSyncTrailingPills` after the Worktree chip), marked
  `CUSTOM(git-sync)`; `composer/worktree-pill.tsx` (custom file: `gitSync` prop, renders
  `ResolveConflictsPill` in place, refreshes after Merge, the three new menu items).
- **Re-apply:** In the composer chip row, call `useGitSync` once and render
  `GitSyncTrailingPills` at the end, before `ReadingModePill`; give `WorktreePill` the result.
- **Setup:** `plugin reload shell-command` on each daemon. No daemon restart. A host whose
  shell-command plugin lacks the RPC shows no chips.
- **Verify:** `npx vitest run custom/plugins/shell-command` and `src/git-sync/model.test.ts` (in
  the update script). By hand: in a DreamMMO main checkout session with wt1 ahead, **Trazer do
  DreamMMO-wt1** is last in the row; merge it; on a conflict the chip turns into **Resolver
  conflitos** within seconds, and pressing it opens a tab with the prompt, unsent.

## critic: a second model reviews each answer before the user reads it

- **Added:** 2026-11-03 (based on upstream v0.14.0)
- **Commit:** `custom: a critic model reviews each answer before the user reads it`
- **Why:** The user wants a critic LLM in the loop of any conversation, not only the Power
  Workboard's review step in Tasks mode: a prompt (with reference images) and a model of their
  choice judge each answer, and a rejected answer goes back to the agent with the critique.
- **What:** A toggle after the flame in a running agent's composer (any provider), off by default.
  It opens a sheet: on/off, model, critic prompt, reference images, **Per request** (a fresh critic
  for each user message, kept across its rounds) or **Persistent** (one critic for the whole chat),
  tools **Off** or **Read only**, include the workspace diff, max rounds (a number field, 1 to 50,
  default 10), save as default.
  - Turning it on or off puts a `<critic-notice>` in front of the user's next message (the chat
    strips it): the agent is told every answer goes through a reviewer and to end each turn with a
    full report.
  - When a turn of a reviewed agent completes, the `critic` plugin reads the user's request, the
    agent's answer since the last user message and `git status` + `git diff HEAD`, and asks the
    critic, a Paseo subagent of the reviewed agent (label `custom.critic.role=critic`, in its
    subagents track), for a `<verdict>` JSON block: approved, rejected, question, waiting, unverified.
  - Rejected: the critique goes back to the agent as a `<critic-feedback round="N">` message and the
    loop runs again. On the last round the answer is shown as it is (status `limit`).
  - The chat hides the answer while the critic reads it and after it rejects it, and hides the
    feedback messages; a **critic-review** card per round shows the verdict, opening to the
    critique and the rejected answer. The toggle shows ✓ / warning / busy for the last review.
  - The daemon holds the "finished" notification of a reviewed agent (label
    `custom.critic.enabled=true`) and raises it when the plugin appends a review row that ends the
    loop (approved, limit, question, unverified, failed). Critic agents never notify.
  - Read only is enforced for Claude critics (`disallowedTools`, default mode); for other providers
    the critic is told not to change anything and the plugin denies every permission it asks for.
    Off also takes Claude's read tools away.
  - The critic is sent the images the answer links to (`server/evidence.ts`). Claude's read tools
    stop at the workspace (default mode asks permission outside it, and the plugin denies every
    permission), and agents keep screenshots in `/tmp`: on 2026-11-03 a critic rejected 11 rounds of
    a visual task without seeing one capture. Linked pages are opened for their `<img>` files. At
    most 6 images, the latest citations first; what is left out is listed in the prompt.
  - Verdict **unverified**: the critic could not see what the verdict depends on. The answer goes to
    the user with a warning card and the note, and nothing goes back to the agent.
  - On web and desktop, pasting an image anywhere in the sheet adds a reference image
    (`packages/app/src/critic/image-paste.ts`); a capture listener keeps it from the composer behind
    the sheet. A text paste still reaches the prompt.
- **Files:** `packages/protocol/src/critic.ts` (labels, markers, config and row schemas, RPC
  names); `custom/plugins/critic/` (`server/loop.ts` the loop, `server/store.ts` the config file
  `$PASEO_HOME/custom-critic.json`, `server/diff.ts`, `server/evidence.ts`, `shared/review.ts` prompt/verdict/turn reading
  - test, `client/review-card.tsx`); `packages/app/src/critic/` (`model.ts` the chat filter and
    last status, `store.ts` pending notices, `rpc.ts`, `form-model.ts`, `toggle.tsx`, `sheet.tsx`, with
    tests); `packages/server/src/server/plugins/custom-critic-plugin.e2e.test.ts`.
- **Core files touched:** server `agent/agent-manager.ts` (`checkAndSetAttention` returns early for
  critic agents and, on running → idle, for reviewed agents; `appendTimelineItem` calls
  `raiseFinishedWhenCriticSettles`); app `agent-stream/view.tsx` (`hideCriticRounds` after
  `hideCacheWarmupTurns`), `composer/actions.ts` (`dispatchComposerAgentMessage` prepends a
  pending notice), `composer/agent-controls/index.tsx` (`<CriticToggle>` after
  `<CacheWarmupToggle>`). All marked `CUSTOM(critic)`.
- **Re-apply:** In the daemon's attention check, skip agents labeled as critics, and skip
  "finished" for agents labeled critic-enabled; when a `critic`/`critic-review` plugin row whose
  status notifies is appended to an idle agent without attention, raise "finished". In the app,
  filter the stream through `hideCriticRounds`, render `CriticToggle` at the end of the composer's
  agent control row, and prefix the next sent message with `buildCriticNotice` while a notice is
  pending.
- **Setup:** `paseo plugin install "$PWD/custom/plugins/critic" --home <home>` once per daemon, a
  desktop build for the app, and a daemon restart for the notification hold.
- **Verify:** `npx vitest run custom/plugins/critic`, `packages/app/src/critic`, the e2e
  `custom-critic-plugin.e2e.test.ts` and `agent-manager.test.ts -t "the critic holds the finished
notification"` (all in the update script). By hand: turn the critic on with a strict prompt; send
  a task; the answer stays hidden while a "Critic is reviewing" card shows, a rejection sends the
  critique back, and only the approved answer shows with a ✓ card; one notification at the end.

## jev-router: a new Claude session starts on Sonnet or Haiku when its first prompt is small

- **Added:** 2026-11-03 (based on upstream v0.14.0). Changed the same day: no shadow mode (just
  on/off, on by default), a card in the chat when the model changed, and a button on it to undo.
- **Commit:** `custom: Jev router picks a cheaper model for a new session's small first prompt`,
  then `custom: Jev router is on or off, and a routed session gets a card to undo it`
- **Why:** Most first prompts need the user's usual Opus/high, but some are a rename or a quick
  question. gnome-custom's `jev-router/route.py` asks TypeSafe Jev (~200 ms, ~US$ 0.00005) and,
  under the `downgrade_only` policy measured on the user's own prompts, drops to Sonnet or Haiku
  only when Jev is sure the task is small and plain. Handoff:
  https://app.notion.com/p/40d0cc33bd4781ddbf4af8d1b08092c0
- **What:** The `jev-router` plugin (Settings > Plugins > jev-router > Jev router):
  - **Route new sessions**, on by default. A route icon in the composer, after the critic's (in
    drafts too, where the critic doesn't show), is tinted while it is on. A press on the icon
    skips Jev for the next new agent on that host only (untinted until then; a second press undoes
    it; in memory, `jev-router/skip-next.ts` + test, consumed in `route.ts`); the router comes back
    by itself. Only the sheet turns it off for good; with it off, the icon opens the sheet. The
    caret opens the router sheet (since 2026-11-11, `showCaret` + `onChevronPress`; `AgentControlTrigger` drops the 28 px
    icon-only width when it has a caret) ([jev-router-modes](#jev-router-modes-model-focused-or-effort-focused-and-a-locked--)); its
    tooltip also says what Jev did for that session.
  - **TypeSafe provider** per host: API key, endpoint and Jev model (since 2026-11-11, so
    paseo-telus can call Jev on another TypeSafe account or gateway than the personal host). The
    plugin hands them to route.py as `TYPESAFE_API_KEY`, `TYPESAFE_API_URL` and `JEV_MODEL`
    (`buildRouterEnv` in `shared/decision.ts`); an empty field keeps the daemon's environment, so
    the key falls back to `~/.config/typesafe/env` and the rest to jev.py's defaults (gnome-custom
    jev.py reads `TYPESAFE_API_URL` since the same day). Edited in Settings > Bruno's
    Customizations > Composer > **TypeSafe provider** (`jev-router/provider-sheet.tsx`, with a
    **Test** that routes a sample prompt on the saved provider) and in the plugin screen. Also
    router script path (default `~/projetos/gnome-custom/jev-router/route.py`), Python, Jev
    timeout (default 2 s), **Log decisions** (`~/.local/state/jev-router/decisions.jsonl`, read
    with `route.py review`), and a **Test** button that routes a sample prompt without applying.
  - When the user sends a draft's first message, the app calls the plugin's `route` RPC before
    creating the agent, with the prompt, cwd, image count and the selected model/effort. Only
    Claude sessions above Haiku are routed; auto-submitted setups, follow-ups and other providers
    are not. Only a strictly cheaper family is applied, never a stronger one.
  - Threads are never routed (since 2026-11-13): a draft whose attachments carry a previous
    conversation (`contextKind: "chat_history"`, from a fork or a /btw thread) keeps the source
    agent's model, because switching it would invalidate the prompt cache the thread warmed.
    `isThreadDraft` in `jev-router/model.ts` + test; `route.ts` checks it, and `workspace-tab.tsx`
    passes the create request's `attachments` to `routeDraftAgent`. Re-apply: skip routing in
    `route.ts` when any wire attachment has `contextKind === "chat_history"`.
  - Fail-open: a missing plugin, an error, a script failure or no answer in 15 s creates the
    session as selected.
  - Every routed session gets `custom.jev.pick`, `.home`, `.why` and `.applied` labels.
  - When the model changed, the RPC also stashes a card (by `custom.jev.route-id`, in memory for
    10 min) and the plugin's `agent.created` hook appends it to the new agent: one line, "Jev
    começou em Haiku 5.5 · low (você escolheu Opus 5.5 · high)", and **Ignorar recomendação e
    reiniciar com modelo selecionado**. That button turns Jev off, creates a session like the
    agent's (provider, folder, mode, features) on the selected model and effort with the same
    first prompt (text only; attached images are not resent), puts it in the routed agent's own
    tab (since 2026-11-13: the tab showing that agent is retargeted, so it keeps its id, pane and
    focus: with Desks on, `useDesksStore.updateTab` on the desk tab, in any Desk, plus the
    sidebar's `openedAt` entry moved to the new agent; with Desks off, the workspace layout's
    `replaceTab`; a new tab only when the agent was open in neither) and archives the routed
    one (workspace tabs close by agent id and that tab already shows the new agent; the desks store never closes tabs on archive). Same for
    the composer chip and Esc 3×. `jev-router/replace-agent-tab.ts` + test, called from
    `use-restart-agent.ts` before `archiveAgent`; it falls back to `navigateToWorkspace`. A first prompt over 30k characters is not kept, and its card has no button.
  - Esc 3× (since 2026-11-13): one more plain Esc within `CHORD_TIMEOUT_MS` (1.5 s) after the
    keyboard `agent.interrupt` does what the card's button does (Jev off, restart on the selected
    model/effort with the first prompt), whether interrupt is bound to `Escape` or `Escape Escape`.
    Only when the agent has a card with a prompt; otherwise the Esc does what it always did, and
    nothing is delayed or swallowed.
    Esc storm: once the restart fires, every Escape keydown (modifiers and repeats included) is
    swallowed (preventDefault + stopImmediatePropagation: no chord progress, no interrupt, no
    composer focus) until 2 s (`ESC_STORM_QUIET_MS`) pass since the last Escape; each Escape
    extends the window, other keys neither extend nor end it, and the Escape that triggers the
    restart is swallowed too. The swallow only starts when a restart actually began. The card shows a muted "· 3× Esc" after its button on web.
    `jev-router/triple-esc.ts` + test (pure `shouldRestartOnEscape`, last-interrupt memory, a
    listener), `turn-off.ts` (saves `enabled: false` from the app), `use-esc-restart.ts`
    (`useJevEscRestart`, mounted in `AgentPanel`, interactive panel only, a ref guards double
    triggers). The interrupt is recorded in `composer/index.tsx` (`dispatchComposerKeyboardAction`,
    after `handleCancelAgent()`, via `onKeyboardInterrupt`); the next Esc is seen by a
    window capture keydown listener that `triple-esc.ts` adds when it loads (before any component
    effect, so it runs ahead of the shortcut handler, overlays, browser pane, recent tabs and the
    chat-esc-focus bubble listener). `hooks/use-keyboard-shortcuts.ts` only subscribes
    (`subscribeEscapeSwallowed`) to reset a half-typed chord, like `handlePointerDown`. Re-apply:
    call `recordKeyboardInterrupt(serverId, agentId)` where the composer handles
    `agent.interrupt`, keep the listener at the bottom of `triple-esc.ts`, subscribe the shortcut
    hook's chord reset to `subscribeEscapeSwallowed`, and mount `useJevEscRestart` in `AgentPanel`.
  - Installed on both daemons. It was personal-only at first, to keep work prompts away from
    TypeSafe; on 2026-11-09 the user had it installed on paseo-telus too, still on TypeSafe. Each
    host keeps its own settings, TypeSafe provider included; the sessions it routes use that
    host's Claude provider.
- **Files:** `packages/protocol/src/jev-router.ts` (ids, settings schema, RPC schemas, labels,
  card schema, `formatClaudeModel`); `custom/plugins/jev-router/` (`shared/decision.ts`
  home/args/output/plan/card + test, `shared/settings.ts`, `server/run.ts` spawns route.py,
  `server/stash.ts`, `client/settings-screen.tsx`, `client/route-card.tsx`);
  `packages/app/src/jev-router/` (`model.ts` + test, `route.ts`, `toggle.tsx`, `provider-sheet.tsx`);
  `packages/app/src/plugins/react-native/restart-agent-button.impl.tsx`;
  `packages/server/src/server/plugins/custom-jev-router-plugin.e2e.test.ts` (fake route.py).
- **Core files touched:** app `composer/agent-controls/index.tsx` (`<JevRouterToggle>` after
  `<CriticToggle>`), `composer/draft/workspace-tab.tsx` (`submitDraftCreateRequest` passes the
  config through `routeDraftAgent` and spreads its `labels` into the create request),
  `plugins/react-native/host-components.tsx` and `plugins/evaluate.ts` (lend
  `RestartAgentButton` to plugins, next to btw-actions' `AgentForkMenu`); plugin SDK
  `packages/plugin/src/client/react-native.ts` (`RestartAgentButton` declaration). All marked
  `CUSTOM(jev-router)`.
- **Re-apply:** Render `JevRouterToggle` at the end of the composer's agent control row. Where the
  draft tab builds the create-agent config from the composer selection, await `routeDraftAgent`
  on it (skipping auto-submitted drafts) and add its `createOptions` to the request. Declare
  `RestartAgentButton` in the plugin react-native entry and add it to the app's
  `pluginReactNativeCompatRuntime`, lazily required like `AgentForkMenu`.
- **Setup:** `paseo plugin install "$PWD/custom/plugins/jev-router" --home ~/.paseo` and again
  with `--home ~/.paseo-telus`, a desktop build for the app.
- **Verify:** `npx vitest run custom/plugins/jev-router packages/app/src/jev-router` and the e2e
  `custom-jev-router-plugin.e2e.test.ts` (in the update script; it checks the provider env reaches
  route.py). On a host, Bruno's Customizations > Composer > TypeSafe provider > **Test** answers
  "Jev answered: …" with the saved key and endpoint. By hand: on the personal Paseo,
  send "rename count to total in utils.ts" from Opus/high in a draft; the session starts on
  Haiku/low with the Jev card; its button turns the icon off and reopens the prompt on Opus/high
  in the same tab, the routed one archived. Esc 3×: after the restart, keep pressing Esc; nothing
  interrupts the new session until 2 s after the last press.

## bruno-customizations: one Settings section for the fork's own settings

- **Added:** 2026-11-09
- **Commit:** `custom: Bruno's Customizations settings section, critic and Jev icons can be hidden`
- **Why:** The fork's settings were spread over Chat, Editor and the host's Voice page, and the
  composer's critic and Jev icons could not be hidden. The user wants one organized place.
- **What:** A sidebar group **Bruno's Customizations** (between App and Host), with one page per
  former tab (slugs `customizations-composer`, `-chat`, `-chat-options`, `-tabs`, `-voice`; the old
  `customizations` slug redirects to Composer, `COMPAT(customizationsSlug)`):
  - **Composer**: **Toolbar icons** with **Critic** and **Jev router** switches (on by default,
    app settings `showCriticToggle` / `showJevRouterToggle`), and \*\*Jev router > Router settings
    > Open\*\*, the router sheet for the selected host when it has the plugin. A hidden Jev icon
    > hides only the icon: the router runs, the ←/→ lock keeps its settings and a moved session
    > still gets its green chip. Below it, **TypeSafe provider > Edit / Test** for that host
    > ([jev-router](#jev-router-a-new-claude-session-starts-on-sonnet-or-haiku-when-its-first-prompt-is-small)).
  - **Chat**: **Link list** ([chat-links](#chat-links-a-list-of-the-links-the-agent-sent-beside-the-chat)).
  - **Tabs**: **Flexible tab movement**, **Preview tabs**, **Skip pinned tabs** (from Editor).
  - **Voice**: the host's Voice and dictation page
    ([voice-settings](#voice-settings-settings--voice-and-dictation)) for the host the settings
    screen points at. The host sidebar no longer lists Voice; its slug still opens the page.
  - Keyboard shortcut customizations stay in Shortcuts, plugin settings in each host's Plugins.
- **Files:** `packages/app/src/screens/settings/bruno-customizations/section.tsx` (Composer, Chat,
  Tabs, Voice pages) and `chat-options-page.tsx` ([chat-options](#chat-options-choose-the-pills-above-the-chat-composer)).
- **Core files touched** (marked `CUSTOM(bruno-customizations)`): `screens/settings-screen.tsx`
  (the `BRUNO_SECTION_ITEMS` sidebar group, title and content cases, Voice out of the host
  items), `utils/host-routes.ts` (the five slugs), `app/settings/[section].tsx` (legacy slug
  redirect), `i18n/resources/*.ts` (`settings.sections.customizations` is now unused), `hooks/use-settings/storage.ts` (the two switches),
  `composer/agent-controls/index.tsx` (gates the two icons), `jev-router/toggle.tsx`
  (`showIcon`); the moved rows left `screens/settings/editor-section.tsx` and
  `screens/settings/chat/chat-section.tsx`, which are upstream again.
- **Re-apply:** Add the five slugs and a sidebar group between App and Host rendering the pages
  (`BrunoComposerPage`, `BrunoVoicePage` get the active host id); drop Voice from the host items but keep
  its route case; add the two app settings and wrap the critic toggle and the Jev icon in them.
  Any new fork setting goes into a page of this group.
- **Verify:** typecheck. In the app, Settings > Bruno's Customizations: each page shows its
  rows; turning Composer > Critic off removes the critic icon from the composer; Jev router off
  removes its icon but the green chip still appears on a routed session.

## jev-router-modes: Model focused or Effort focused, and a locked ←/→

- **Added:** 2026-11-09
- **Commit:** `custom: Jev router sheet with Model focused and Effort focused modes, locked ←/→`
- **Why:** The user moved to two models: Opus for every non-trivial task, on low effort to start
  and explore (as fast as Sonnet high, about the same price) and high for hard questions, and
  Haiku for operational sessions (search code, an easy merge, an HTML page). On 5.5 models an
  effort change keeps the prompt cache, so stepping from Opus low to high mid-session costs
  nothing, and starting every session on the same model removes the model choice and the
  session migrations.
- **What:**
  - The composer's route icon caret opens a sheet (like the critic's): **Route new sessions**, the mode,
    the selected mode's settings, **Restore this mode's defaults**, Save. All of it lives in the
    plugin's host settings (`mode`, `modelFocused`, `effortFocused`), so the Settings > Plugins
    screen and the icon see the same document; documents saved before this get the defaults.
  - **Model focused** is the old behavior (route.py `downgrade_only`), with its two thresholds
    editable (small task 0.7, hard signal limit 0.3) and **Use Sonnet for small tasks**, off by
    default: off, route.py's Sonnet pick keeps the selection, so only chat and tiny tasks move
    (to Haiku). The user wants Sonnet out in practice but kept as a choice.
  - **Effort focused** (route.py `--policy effort_focused`): chat and tiny tasks go to the
    **Operational** model (Haiku) on Jev's effort moved to the nearest checked one (low, medium,
    high; chat on the lowest); hard reasoning or a hard signal ≥ 0.5 to **Hard** (Opus high);
    everything else to **Default** (Opus low). It ignores the selection, so it may move up, and
    it routes Haiku selections too. Models, efforts and the three thresholds are editable.
    **Operational** also has **Off** before its models (`operationalEnabled`): chat and tiny tasks
    then start on Default, and ←/→ leave its model out (added 2026-11-10, so a Sonnet or Haiku
    pick can be dropped without unchecking every effort, which blocks Save). On the
    78 labeled real prompts (cached Jev answers) it picked ~47% Opus low, ~41% Opus high, ~12%
    Haiku.
  - **Lock models/effort fast cycling**, on by default, in Effort focused (it follows the mode,
    not the router's on/off): in a Claude composer, ← moves between the picks' models (keeping
    the effort when the new model allows it, else the nearest allowed one) and → between the
    current model's allowed efforts. Defaults: Haiku low/medium/high, Opus low/high. A model
    outside the lock leaves → to the regular cycling.
  - With the router on in Effort focused, a new agent tab (no inherited setup: not a fork, /clear
    or resolve-conflicts tab) starts on **Default** (Opus low) instead of the last session's
    model and effort, and the chips that differ from the session you came from flash green (the
    route chip's green): the effort, the model, or both. "Came from" is the agent panel last
    interactive on that host (`jev-router/last-viewed-agent.ts`, recorded in `AgentPanel`); the
    draft's own start can't tell, because it comes from the saved preferences, which a routed
    session doesn't update (after a first send they say Opus low, so nothing would change and
    nothing flash). A chip also flashes whenever it changes in front of you. The session is read
    when the tab opens, and a focused draft clears it, so a tab opened from a draft never compares
    against an older session. Model and effort
    change in one render (`setModelAndThinkingFromUser`) and the effort is remembered for the new
    model. The flash request waits by draft key in `jev-router/flash-signal.ts` until the chip
    shows it (the chips can mount after the change, and a chip's first value never flashes). A
    draft that loads with no model is left alone, so Jev never replaces your first pick. Each
    draft is handled once per app run. Added 2026-11-10 (`new-draft-default.ts` + test).
  - In every mode, → with text in the composer changes the effort too when the caret is at the
    end with nothing selected (web and desktop).
  - The model and effort chips flash briefly when their value changes, however it changed
    (`composer/agent-controls/change-flash.tsx`); a chip's first value never flashes.
  - A session Jev moved gets a soft green chip (the selected Desk's green, lighter text) after the
    route icon: "Model: Haiku 5.5 Effort: low", or "Effort: high" when only the effort changed. It
    flashes when it appears and stays while the agent is still on Jev's pick. Its menu offers
    **Run with Opus 5.5 · high** (what was selected): the first prompt again in a new session,
    this one archived, Jev left as it is. It reads the router card the plugin appends, so it
    needs no new labels; the card's button and the chip share `useRestartAgent`.
- **Files:** `packages/protocol/src/jev-router.ts` (modes, `effortFocusedPick`,
  `effortFocusedCycle`, `nearestEffort`); `custom/plugins/jev-router/shared/decision.ts`
  (`resolveHome`/`planRoute` by mode, `applyEffortFocused`, the policy and threshold args) +
  test; `packages/app/src/jev-router/` (`sheet.tsx`, `form-model.ts` + test, `cycle.ts` + test
  with the settings store the icon fills, `use-locked-cycle-keys.ts`, `toggle.tsx` opens the
  sheet, `route-chip.tsx`, `use-restart-agent.ts`); gnome-custom `jev-router/route.py` (`--policy`, `--t-small`, `--t-hard`, `--t-deep`,
  `jev_effort` in the output) and `strategies.py` (`effort_focused_decide`).
- **Core files touched** (marked `CUSTOM(jev-router)`): app `composer/agent-controls/index.tsx`
  (`useLockedCycleKeys` in `AgentControlCommandCenterRegistration` and `DraftAgentControls`; the
  agent ←/→ handler lets → through with the caret at the end), `composer/draft/workspace-tab.tsx`
  (same for the draft handler; also `useJevDefaultPickForNewDraft` after the composer state),
  `panels/agent-panel.tsx` (`useRecordViewedAgent` in `AgentPanel`),
  `hooks/use-agent-form-state.ts` (`setModelAndThinkingFromUser`: SET_MODEL_FROM_USER then
  SET_THINKING_OPTION_FROM_USER, and the preference for the new model),
  `keyboard/keyboard-shortcuts.ts` (the → help label); the model
  and effort chips in `composer/agent-controls/index.tsx` are wrapped in `<ChangeFlash>`, and `DesktopAgentControlsContent` gets `draftKey` to read
  the green flash (`useJevChipSignal`).
- **Re-apply:** Register `useLockedCycleKeys` (priority above the regular ←/→ handlers) wherever
  a composer registers its model-picker source, with the same source id and controls. In the
  handlers that cycle model and effort only in an empty composer, also let `task.draft.effort`
  through when `isFocusedComposerCaretAtEnd()`. In `useAgentFormState`, add
  `setModelAndThinkingFromUser` (both reducer actions back to back, then persist the model and
  `thinkingByModel` for it) and return it; in the draft tab, call `useJevDefaultPickForNewDraft`
  with the composer state once it exists, `isFreshDraft` true only without an `initialSetup`; in
  `AgentPanel`, call `useRecordViewedAgent(serverId, agentId, isInteractive)`.
- **Verify:** `npx vitest run custom/plugins/jev-router packages/app/src/jev-router` and the e2e
  `custom-jev-router-plugin.e2e.test.ts` (in the update script). By hand, on the personal Paseo:
  click the route icon, pick Effort focused, Save; Operational > Off hides its efforts and
  still saves, ← no longer lands on its model; in a draft on Opus high, ← goes to Haiku high
  and → walks Haiku's efforts, ← again Opus high, → Opus low; type text and press → at its end:
  the effort changes; each change flashes its chip. With the router on, from an Opus high
  session open a new agent tab: it shows Opus low and only the effort chip flashes green. Send "rename count to total in utils.ts": the
  session starts on Haiku with the Jev card and the green chip, whose menu runs it again on the
  selection.

## draft-composer-ready: a New Agent tab has its commands and composer controls from the start

- **Added:** 2026-11-03 (based on upstream v0.14.0)
- **Commit:** `custom: a New Agent tab has its commands, ! and composer toggles before the first message`
- **Why:** In a new agent tab, `/` commands and skills, `!` and part of the composer bar only
  worked after the first message. The commands were there but loaded on the first `/`, and each
  load starts a provider session (1-2 s, measured on the personal daemon), so the list stayed
  hidden while it loaded. `!` and the other plugin commands that need an agent were left out
  because the agent didn't exist yet. The flame, the critic and the context meter rendered only
  for a running agent.
- **What:**
  - A draft loads its `/` list as soon as its config is complete, not on the first `/`. A model
    or effort change keeps the old list on screen while the new one loads.
  - Plugin commands with `context: "agent"` (`!`/`/sh`, `/btw`, the shell shortcuts...) show in a
    draft. Running one creates the session with no first message, as the voice button does, then
    runs the command on it; a `!` line's output lands in the new agent's chat. `!` history and Tab
    path completion use the draft's directory.
  - The flame and the critic show in a draft. The flame's choice is stored under the draft's key
    and moves to the new agent. The critic sheet saves to the draft; the create request carries
    `custom.critic.enabled` and the critic notice in front of the first message, and the plugin
    gets the config right after creation (an empty first message queues the notice instead).
  - The context meter shows in a draft, empty, without the usage cards (they need an agent).
  - The Jev router skips an empty first message (voice, `!`): it has nothing to judge.
- **Files:** `packages/app/src/composer/draft/composer-extras.ts` + test (create-request extras
  and the post-create hand-off), `packages/app/src/critic/draft.ts`,
  `packages/app/src/cache-warmup/draft.ts`.
- **Core files touched (all marked `CUSTOM(draft-composer-ready)`):** app
  `hooks/use-agent-commands-query.ts` (`placeholderData` for drafts),
  `hooks/use-agent-autocomplete.ts` (`shouldLoadCommands`, `draftCwd` for the shell completion),
  `shell-command-composer/use-shell-command-completion.ts` (`draftCwd` fallback),
  `plugins/client-slash-commands/index.ts` (`createAgent` option), `composer/index.tsx`
  (`onCreateAgentForCommand` prop, meter for drafts), `usage/agent-usage.tsx` (nothing for an
  unknown agent), `composer/agent-controls/index.tsx` (`draftKey` to the flame and critic),
  `composer/draft/workspace-tab.tsx` (`draftKey`, `handleCreateAgentForCommand`, extras in
  `submitDraftCreateRequest`); `critic/store.ts`, `critic/sheet.tsx`, `critic/toggle.tsx`,
  `cache-warmup/toggle.tsx` (draft mode); `jev-router/route.ts` (empty prompt).
- **Re-apply:** In the draft's command query, enable it for drafts without waiting for `/` and
  keep previous data. Give `usePluginClientSlashCommands` a `createAgent` that the draft tab
  implements like `voice-new-agent` (empty first message, resolve with the new id after
  `onCreated`), and build the agent context from the new agent's workspace. Pass the draft id as
  `draftKey` from the draft tab's agent controls to `CacheWarmupToggle` and `CriticToggle`; in
  `submitDraftCreateRequest`, merge `draftComposerCreateExtras` into the request and call
  `applyDraftComposerExtras` after `createAgent`.
- **Verify:** `npx vitest run src/composer/draft/composer-extras.test.ts` (in the update script).
  By hand: open a New Agent tab and type `/` right away: the list shows at once; `!ls` creates
  the agent and shows the output in its chat; turn the critic on and the flame off in the draft,
  send a message: the new agent shows the critic on and the flame off.

## shortcut-file: save and load the keyboard shortcuts as a JSON file

- **Added:** 2026-11-03
- **Commit:** `custom: Export and Import buttons save the keyboard shortcuts to a JSON file`
- **Why:** The shortcuts live in the browser storage of one install (`@paseo:keyboard-shortcut-overrides`).
  A fresh install, another machine or a cleared profile starts from the defaults. A file moves the
  setup between them and can sit in a dotfiles repo.
- **What:** Settings > Shortcuts has **Export** and **Import** beside the search field (desktop and
  web; mobile has no shortcuts).
  - Export downloads `paseo-shortcuts.json`: `{ "format": "paseo-shortcuts", "version": 1,
"shortcuts": { "<binding id>": "Mod+K" | null } }`. Only the changed shortcuts are in it. `null`
    is an unassigned shortcut, and extra shortcuts are `<binding id>#2` .. `#5`.
  - Import replaces the current setup with the file (one write through `applyOverrides`), so ids the
    file lacks go back to their default. Entries with an unknown binding id, a slot above 5 or a
    combo that does not parse are skipped and counted in the toast. A file that isn't JSON, isn't
    this format, or has a newer `version` is refused and nothing changes.
- **Files:** `packages/app/src/keyboard/shortcut-file.ts` (+ test), `shortcut-file-io.ts` (download
  and file picker), `i18n/resources/custom-shortcut-file.ts` (strings for the 9 locales).
- **Core files touched:** `screens/settings/keyboard-shortcuts-section.tsx` (two buttons and their
  handlers) and the 9 locale files (`shortcutFile: SHORTCUT_FILE_<LOCALE>` under `settings`). All
  marked `CUSTOM(shortcut-file)`.
- **Re-apply:** Add the two buttons next to `resetAllButton` in `KeyboardShortcutsSection` and call
  `serializeShortcutFile(overrides)` / `diffShortcutOverrides(overrides, parsed.overrides)` through
  `applyOverrides`. Add the `shortcutFile` strings to each locale.
- **Verify:** `npx vitest run src/keyboard/shortcut-file.test.ts src/i18n/resources.test.ts`. By hand:
  rebind a shortcut, Export, Reset all, Import: the rebind comes back.

## token-ledger: our fork of the TokenLedger plugin, with turn jumps and MLflow trace links

- **Added:** 2026-11-03 (based on upstream v0.14.0)
- **Commit:** `custom: vendor token-ledger 0.7.0 into custom/plugins` (unchanged baseline, diff
  against it), then `custom: token ledger rows jump to their turn and link to the MLflow trace`
- **Why:** The third-party TokenLedger plugin (`stv1024/token-ledger`, MIT) has the right numbers
  but its turn rows were dead ends. MLflow's tracing hooks (`mlflow-tracing` for Claude in
  `~/.claude-personal`, `mlflow-codex` for Codex) record every tool call of a turn, but they are
  not a usable data source: a Claude trace keeps only some of the model requests (one 16-request
  turn was logged as 3, 213k cache reads instead of 1.04M), and a Codex trace has no cache split
  or cost. So Paseo keeps the numbers and MLflow serves the per-tool detail.
- **What:** `custom/plugins/token-ledger/`, plugin id still `token-ledger` so the history in
  `<PASEO_HOME>/plugins/token-ledger/` and the turn-usage rows already in agent timelines keep
  working (see turn-usage-inline).
  - Clicking a turn row in the session ledger opens the agent at that turn's prompt
    (`navigation.openAgent({ agentId, turnStartedAt })`, see turn-jump). Old rows work too.
  - Each row with a session id gets **trace ↗**: the `ledger.trace` RPC searches every MLflow
    experiment for the session's trace that started within 2 minutes of the turn, closest first,
    and the row opens it in a Paseo browser tab (system browser where there is none). "no trace"
    when nothing matches (other providers, the work `~/.claude`, MLflow down).
  - Settings > TokenLedger > MLflow traces: the server address (default
    `http://localhost:5000`); empty hides the links.
- **Files:** plugin-only: `shared/trace.ts`, `server/mlflow.ts` (+ `mlflow.test.ts`),
  `shared/preferences.ts` (`mlflowUrl`), `index.server.ts`, `client/settings.tsx`,
  `client/panel.tsx`. Marked `CUSTOM(token-ledger-trace)` / `CUSTOM(turn-jump)`. Excluded from
  the root oxlint/oxfmt like power-workboard; it has its own `tsc` and `node --test` suite.
- **Gotcha:** `paseo plugin remove token-ledger` deletes `<PASEO_HOME>/plugins/token-ledger/`
  with the ledger in it (`managed-source.ts` removes the managed install root, which is also the
  plugin's data folder). The switch from the npm plugin on 2026-11-03 was: `plugin disable`, copy
  `ledger.jsonl`, `pricing.json`, `openrouter-pricing.json` and `tracker-state.json` out
  (`~/.paseo-backups/token-ledger-*`), `plugin remove`, copy them back, `plugin install` the
  folder. Back up before any future remove.
- **Re-apply:** Plugin-only; an upstream merge can't conflict. To take a new upstream
  token-ledger, diff it against the baseline commit and replay the changes listed above.
- **Setup:** `paseo plugin install "$PWD/custom/plugins/token-ledger" --home <home>` (both
  daemons), after the backup dance above if the npm version is installed.
- **Verify:** `(cd custom/plugins/token-ledger && npx tsc --noEmit && npm test)`. In the app,
  open the TokenLedger panel of a Claude agent: **trace ↗** opens the turn in MLflow, and a row
  click scrolls the chat to that turn's prompt.

## usage-cache-writes: agent usage carries Claude's cache write tokens

- **Added:** 2026-11-03 (based on upstream v0.14.0)
- **Commit:** `custom: agent usage carries Claude's cache write tokens`
- **Why:** Cache creation is billed at 1.25× input, apart from reads. Paseo dropped it, so the
  token ledger's estimate for a tool-heavy Claude turn missed a large part of the cost (55k
  cache-write tokens in one turn).
- **What:** `AgentUsage` gets an optional `cacheWriteInputTokens`, set from the Claude result's
  `cache_creation_input_tokens` when present. The token ledger already reads that name.
- **Core files touched** (marked `CUSTOM(usage-cache-writes)`): `packages/protocol/src/agent-types.ts`
  and `messages.ts` (`AgentUsageSchema`), `packages/server/src/server/agent/agent-sdk-types.ts`,
  `agent-projections.ts` (`sanitizeUsage` field list), `providers/claude/agent.ts`
  (`buildResultUsage`).
- **Re-apply:** Add the optional field to both `AgentUsage` interfaces and the zod schema, to the
  field list in `sanitizeUsage`, and set it in `buildResultUsage` from
  `message.usage.cache_creation_input_tokens`.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent/agent-projections.test.ts
src/server/agent/providers/claude/agent.test.ts)`. Daemon-side: needs the daemons restarted.

## turn-jump: plugins can open an agent at one of its turns

- **Added:** 2026-11-03 (based on upstream v0.14.0)
- **Commit:** `custom: plugins can open an agent at one of its turns`
- **Why:** The token ledger lists turns; a row should take you to that turn in the chat.
- **What:** Plugin `navigation.openAgent` takes an optional `turnStartedAt` (ISO). The app stores
  the request (`turn-jump/store.ts`), opens the agent, and the chat view finds the turn's prompt
  in the chat outline's prompt index by time: the last prompt at or before the turn start, with 5 s
  of slack. `jumpToPrompt` then scrolls there, loading older history when needed. Matching by time
  needs no timeline seq in the ledger, so rows recorded before this change jump too. A request
  waits until the chat is active and the index has loaded, and is dropped after 15 s. The prompt
  index loads even with the outline turned off while a jump is pending. Web and desktop only
  (the outline's index is web-only); elsewhere the agent just opens.
- **Files:** `packages/app/src/turn-jump/` (`model.ts` + test, `store.ts`, `use-turn-jump.ts`).
- **Core files touched** (marked `CUSTOM(turn-jump)`): plugin SDK
  `packages/plugin/src/client/contracts.ts` (`openAgent` input), app
  `plugins/host-navigation-model.ts` (+ test) and `host-navigation.ts` (`requestTurnJump`),
  `agent-stream/view.tsx` (`useTurnJumpRequest` before `useChatOutline`, `shouldLoadChatOutline`
  as its `enabled`, `useTurnJump` after it).
- **Re-apply:** Give `openAgent` the optional field and make the host navigation call
  `requestTurnJump` before `openAgent`. In the agent stream view, read the pending request for
  the agent, keep the chat outline enabled while one is pending, and feed `chatOutline.prompts`,
  `isActive` and `chatOutline.jumpToPrompt` to `useTurnJump`.
- **Verify:** `(cd packages/app && npx vitest run src/turn-jump/model.test.ts
src/plugins/host-navigation.test.ts)`. In the desktop app, click an old row in an agent's
  TokenLedger panel: the chat scrolls to that turn's message.

## dictation-live-text: dictation types into the text box as you speak

- **Added:** 2026-11-04 (based on upstream v0.14.0)
- **Commit:** `custom: dictation shows live text in the composer and survives a dead stream`
- **Why:** A long dictation gave no feedback beyond the volume meter, and you only learned it had
  failed after pressing stop. The daemon already sent `dictation_stream_partial`, but the composer
  dropped it. `dictation_stream_error` also went unheard while recording, because only
  `startDictationStream` and `finishDictationStream` wait for it.
- **What:**
  - Each partial writes `base + partial` to the composer (`handleDictationPartial`), where `base` is
    the text from before the first partial. The final transcript replaces the partial. Partials
    also reach the draft, so a failure or leaving the screen keeps what was transcribed.
  - Cancel (Esc, Esc Esc, the X) and discarding a failed dictation keep the transcribed text and
    drop the audio. On web and desktop the focus returns to the box and Ctrl+Z removes that text:
    setting a textarea's value leaves nothing to undo, so `insertDictationTextWithUndo` puts it back
    with `document.execCommand("insertText")`. It runs after the overlay closes, because the box is
    read-only until then.
  - The dictation controls take the toolbar's row below the text box instead of covering the
    composer. The box takes no input until dictation ends. Realtime voice still covers it.
  - When the daemon loses the stream mid-recording, the bar says so and the sender replays every
    segment on a new stream (at most 3 times per dictation, because each replays the whole
    recording). After a permanent error or the last restart it only buffers, and stop tries again
    on a new stream; if that fails, the existing failed state offers retry.
  - The daemon logs failed streams to `daemon.log` ("Dictation stream failed").
- **Core files touched** (marked `CUSTOM(dictation-live-text)`): app `composer/input/input.tsx`,
  `composer/input/state.ts` (`composeDictationText`), `components/dictation-controls.tsx`,
  `dictation/dictation-stream-sender.ts`, `hooks/use-dictation.ts`,
  `hooks/use-dictation.shared.ts` (`onCancelled`), `i18n/resources/custom-voice-settings.ts`; server
  `dictation/dictation-stream-manager.ts`.
- **Re-apply:** Pass `onPartialTranscript` to `useDictation` in the composer and write
  `base + partial` with `replaceText`; use `base` for `applyDictationTranscript`'s `value`. On
  cancel keep the text and re-insert the part after `base` as an undoable edit once the box is
  editable. Render the `DictationOverlay` in the `toolbar` slot of
  `ComposerInputPresentation`, and call `resolveComposerSurfacePresentation` with the realtime flag
  only. Keep the box non-editable and without pointer events while the bar shows; otherwise a
  double-click on an empty box starts voice mode (`empty-composer-voice`). In the sender, handle
  `dictation_stream_error` for the active id when the stream is ready and not finishing: restart
  while retryable and under the limit, otherwise hold.
- **Verify:** `(cd packages/app && npx vitest run src/dictation/dictation-stream-sender.test.ts
src/composer/input/state.test.ts)`. In the desktop app, type something and dictate: the words appear
  after it within a few seconds. Press Esc: the text stays and the caret is in the box; Ctrl+Z
  leaves only what you typed. To test recovery, kill the
  `Paseo Voice` child of your daemon during a long dictation (`kill -9`): the bar shows the error
  for a few seconds, the text comes back, and stop inserts everything. The app part needs a new app
  build; the daemon log line needs the daemons restarted. `dictation-stream-manager.test.ts` needs
  `PASEO_DICTATION_DEBUG` unset: with it set, final messages wait on a disk write and 3 tests fail.

## desk-file-search: Ctrl+P opens files in Tasks mode

- **Added:** 2026-11-04
- **Commit:** `custom: Ctrl+P opens files as Desk tabs in the focused task's project`
- **Why:** In Tasks mode Ctrl+P seemed to do nothing. The file opened in the workspace layout, which
  the Desk doesn't show, and the search ran in the route's project, which a Desk doesn't follow.
- **What:** In Tasks mode the Search files palette searches the project the Explorer shows (the
  context task's). The picked file opens as a kept Desk tab in the main content, never in the bottom
  panel. The workspace view is unchanged.
- **Core files touched** (marked `CUSTOM(desk-file-search)`):
  `command-center/workspace-file-search.ts`, `task-navigation/open-desk-target.ts`
  (`openDeskTargetInMainContent`, `placement` on `openDeskTarget`).
- **Re-apply:** In `useWorkspaceFileSearch`, read `deskContextTab` when `useTaskNavigationStore` is
  enabled and prefer its `serverId`/`workspaceId` over the route's selection. Call
  `openDeskTargetInMainContent` first in `openWorkspaceTabInFocusedPane`, and fall back to the
  workspace layout's `openTab` when it returns null.
- **Verify:** The "opens files from Ctrl+P and the Explorer" test in desktop
  `e2e/task-navigation.spec.ts` (already in the update script). In the app: in Tasks mode, focus a
  task of a project other than the route's, press Ctrl+P and open a file: a Desk tab shows it. Needs
  a new app build; no daemon restart.

## workspace-content-search: Ctrl+Shift+F searches inside the project's files

- **Added:** 2026-11-04
- **Commit:** `custom: Ctrl+Shift+F searches the text of the project's files`
- **Why:** Ctrl+P only matches file names, and the daemon had no way to search file contents.
- **What:**
  - Ctrl/Cmd+Shift+F opens the command center in an "In files" scope. It finds literal text, ignoring
    case unless the query has a capital, in tracked and untracked files; ignored and binary files are
    skipped. It shows at most 200 results and says so when it stops there.
  - Each result shows `file:line`, its folder and the matching line. Opening one opens the file at
    that line, in the project the Explorer shows (see `desk-file-search`).
  - In Tasks mode another line of an open file moves that file's tab instead of opening a second tab.
  - Focus mode moved to Ctrl/Cmd+Alt+F. A chord the user customized keeps working, because the binding
    ids did not change.
  - Focus that a scoped palette's chip gets from outside goes to the input, for Ctrl+P too. A composer
    mounting late could leave focus on the chip, and what you typed was lost.
  - Hosts without `features.workspaceContentSearch` show a message asking to restart or update the
    daemon.
- **Files:** server `utils/workspace-content-search.ts`; app
  `command-center/workspace-content-search.ts`, `i18n/resources/custom-content-search.ts` (strings for
  the 9 locales).
- **Core files touched** (marked `CUSTOM(workspace-content-search)`): protocol `messages.ts`
  (`workspace.files.search_content.request` / `.response`, `features.workspaceContentSearch`); client
  `daemon-client.ts` (`searchWorkspaceContent`); server `session.ts`, `websocket-server.ts`,
  `authorization/operation-permissions.ts`; app `command-center/command-center.tsx`, `interaction.ts`,
  `results.ts` (`match` on file results), `workspace-file-search.ts`,
  `keyboard/keyboard-shortcuts.ts`, `keyboard/actions.ts`, `keyboard/route-shortcut.ts`,
  `stores/keyboard-shortcuts-store.ts`, `screens/workspace/workspace-file-open-command.ts`
  (`lineStart`), `task-navigation/desks-store.ts` (`retargetOpenFile`), and each locale file
  (`contentSearch` under `shell.commandCenter`).
- **Re-apply:** Add the RPC and feature flag, with both message types in the permission map. The search
  runs `git grep -n -z -I -F`, with `--untracked --exclude-standard` in a repo and `--no-index` outside
  one, and `-c grep.fullName=false` so paths stay relative to the workspace. Don't move it to ripgrep:
  it isn't guaranteed on the host. Add scope `"content"` to `CommandCenterScope`; `interaction.ts`
  treats every scope as daemon-served. Rebind `view.toggle.focus` under its existing binding ids. In
  `openInDeskWithoutParent`, retarget a tab with the same owner and path before looking for an equal
  target, because `sameDeskTarget` compares lines too. `routeKeyboardShortcut` is at the complexity
  limit, so scoped routing lives in `routeScopedCommandCenter`.
- **Verify:** `(cd packages/server && npx vitest run src/utils/workspace-content-search.test.ts)`,
  `(cd packages/app && npx vitest run src/keyboard/route-shortcut.test.ts
src/keyboard/keyboard-shortcuts.test.ts src/task-navigation/store.test.ts)`, and the "searches inside
  files" tests in desktop `e2e/task-navigation.spec.ts`. Needs a new app build and the daemons
  restarted; before the restart the search shows the message about the daemon.

## desk-docs: a Docs tab in the Explorer sidebar

- **Added:** 2026-11-04; moved from a Desk header chip to the sidebar on 2026-11-05
- **Commit:** `custom: Docs tab in the Explorer sidebar with the HTML and Markdown files each project mentions`
- **Why:** The link list beside a chat dies with the chat tab, and reports an agent wrote last week
  are hard to find again. The Docs tab keeps them per project, opens them in the browsing Desk, and
  also shows any folder you add. It lives in the sidebar next to Files and Changes.
- **What:**
  - **Docs** is a singleton panel of the Explorer sidebar (target kind `docs`). Open it from the
    sidebar's **+** menu; its tab has a close button and stays where you put it, in the workspace
    layout and in Tasks mode alike.
  - The page has one collapsible section per project (icon, name, count, folded state remembered).
    Projects with content come first.
  - Documents: every `.html`, `.htm`, `.md` and `.markdown` file an agent's chat links, the same
    rule as [chat-links](#chat-links-a-list-of-the-links-the-agent-sent-beside-the-chat). They are
    copied into the tab with their full path when the chat shows them, so closing the agent tab
    keeps them. A file that doesn't exist on the host is ignored. The same file again changes
    nothing. The same file name at another path moves the entry when the old path is gone, and is
    a second entry when the old one still exists. Right-click: Open, Copy full path, Remove from
    Docs.
  - A **+** with a discreet border on each project picks a folder with the desktop folder dialog
    (projects on the local daemon only; other hosts get a toast) and adds it as a collapsible tree
    like the Files sidebar, listed by the project's daemon. Right-click removes it from Docs.
  - Sorting, top right: **Most recent** (default; the file's modification time) or **A to Z**.
    Folders come before files: added folders above the documents, and inside a tree folders above
    files, each group sorted.
  - In Tasks mode the sidebar's **+** launches into the Desk, so `launchDeskTarget` sends a `docs`
    launch to the workspace's Explorer pane instead (Docs has no place in a Desk).
  - Clicking a document or a tree file opens it as a file tab. In Tasks mode it goes to the Desk
    named **Navegadores** (any case or accents, also "Navegador") and shows that Desk; with no such
    Desk, it opens in the Desk that is showing. In the workspace layout it opens in the project's
    workspace.
- **Files:** `packages/app/src/desk-docs/` (`model.ts` pure capture and sort rules with
  `model.test.ts`, `store.ts` persisted as `custom-desk-docs`, `capture.ts` the hook the agent view
  calls, `projects.ts`, `open.ts`, `panel.tsx`, `view.tsx`). New files; no conflict risk.
- **Core files touched** (marked `CUSTOM(desk-docs)`): the new `docs` tab target in
  `workspace-tabs/model.ts`, `workspace-tabs/identity.ts` (normalize, equality, deterministic id)
  and `stores/workspace-layout-storage.ts` (schema); `panels/panel-manifest.ts` and
  `panels/register-panels.ts`; the launcher (`workspace-tabs/launcher/index.tsx` and
  `internal/catalog.ts`, supporting order only, with its test); the label and close-button id of a
  docs tab in `screens/workspace/workspace-desktop-tabs-row.tsx`,
  `compact-workspace-header/tab-switcher.tsx` and `workspace-tab-menu.ts`;
  `task-navigation/new-tab-menu.tsx` (`launchDeskTarget` sends `docs` to the Explorer); and
  `agent-stream/view.tsx` (`useDeskDocsCapture` after the chat-links memo).
- **Re-apply:** Model `docs` on `files`: a singleton Explorer-host panel with no fields, added
  wherever `files` is listed as a target kind (type, schema, normalize, equality, id, manifest,
  registration, launcher, tab labels). Its component is `DeskDocsView`. In the agent view, call
  `useDeskDocsCapture` with the chat links, the client, the workspace root and the session's file
  paths.
- **Verify:** `(cd packages/app && npx vitest run src/desk-docs/model.test.ts
src/workspace-tabs/launcher/internal/catalog.test.ts src/desk-docs/launch.test.ts)` (the update script runs
  the Docs ones). In
  the app: in the Explorer sidebar, + > Docs. Ask an agent to write and link a Markdown file: the
  project lists it. Move the file and have the agent link the new path: still one entry. With a
  Desk named Navegadores, click the entry: that Desk shows with the file open. Use + to add a
  folder, expand it, switch sorting. Needs a new app build; no daemon restart.

## task-idle-divider: Expand / Collapse on the line under the pinned tasks

- **Added:** 2026-11-09
- **Commit:** `custom: Tasks sidebar Expand/Collapse on the divider, Ctrl+Z reopens a closed tab, right-click opens a link in a background tab`
- **Why:** Once the idle tasks were expanded, the only way to fold them back was the **Show less**
  row at the very end of a long list, and under **Last activity** nothing was held back at all.
- **What:** The line under the pinned tasks reads **⌄ Expand N ———** while idle tasks are hidden
  and **⌃ Collapse ———** once they are all shown. Expand shows every idle task; Collapse goes
  back to the opening limit. The idle limit of
  [task-sidebar-actions](#task-sidebar-actions-idle-limit-row-menu-and-archived-sessions-in-the-tasks-sidebar)
  now applies to every sort: under **Last activity** and the others, idle crews past the limit are
  dropped from the list in place and the **Show next 5** row sits at the end. With no pinned tasks
  the line still shows when there is something to expand or collapse.
- **Core files touched:** `packages/app/src/task-navigation/sidebar.tsx` (`CUSTOM(task-idle-divider)`:
  the non-attention branch of `rows`, `TaskListDivider`, the pinned section lost its bottom border).
- **Re-apply:** In `TaskNavigationSidebar`'s `rows`, run `limitIdleTasks` on the idle/closed roots of
  every sort and push `idleToggleRow` at the end. Render `TaskListDivider` after the pinned header
  in `ListHeaderComponent`; it reads the idle-toggle row (`mode === "less"` means expanded) and
  sets `idleShown` to `Infinity` or `null`.
- **Verify:** Tasks sidebar under **Last activity** with more than 5 idle tasks: the line under the
  pinned tasks says Expand N; clicking it shows all and the line says Collapse. Needs a new app
  build; no daemon restart.

## link-context-tab: right-clicking a web link in the chat opens it in a background tab

- **Added:** 2026-11-09
- **Commit:** same as task-idle-divider.
- **Why:** Opening several links from an answer meant leaving the chat for each one.
- **What:** On desktop (Electron), right-clicking or middle-clicking a web link in the chat opens it in a Paseo browser
  tab of the chat's workspace, like the hover card's **Abrir em aba**, but the focus stays on the
  tab you were in. A toast says "Link aberto em aba". When the right-click lands on selected
  response text, the chat-comments menu wins (it runs first and calls `preventDefault`). Plain web
  keeps the browser's menu.
- **Core files touched:** `assistant-file-links/hover-actions.tsx` (`openUrlInWorkspaceTab`, the
  trigger's `onContextMenu`), `components/ui/hover-card.tsx` (`HoverCardTrigger` passes
  `onContextMenu` and `onAuxClick` to the View; react-native-web forwards them), and
  `task-navigation/desks-store.ts` (`openTabInBackground`). All marked `CUSTOM(link-context-tab)`.
  The workspace layout uses its existing `intent: "background"`.
- **Re-apply:** Give `HoverCardTrigger` `onContextMenu` and `onAuxClick` props. In `UrlHoverCardBody`, pass handlers that
  opens the URL as a browser tab without focus. In the Desks store, `openTabInBackground` opens a
  kept tab with `openInDesk` and then refocuses the tab that had focus.
- **Verify:** `(cd packages/app && npx vitest run src/task-navigation/store.test.ts -t "background")`.
  In the desktop app, right-click and middle-click a link in a chat: a browser tab appears for each and the chat keeps focus.

## link-new-agent: a web link's hover card starts a new agent with the link as its prompt

- **Added:** 2026-11-13
- **Commit:** `custom: a web link's hover card opens a new agent tab with the link in its composer`
- **Why:** Handing a link to a fresh agent meant opening a new tab and pasting it by hand.
- **What:** The web link hover card gets a last icon (BotMessageSquare, **Novo agente com este
  link**) between **Abrir no navegador** and the URL. It opens a new agent tab (a draft, no
  parent, no setup copied from the current agent) in the chat's workspace, with the URL as the
  composer text, unsent: the user picks the model and presses Enter. Tasks mode opens it in the
  Desk; otherwise in the workspace layout. Shows wherever the chat has a workspace, web included.
- **Core files touched:** `assistant-file-links/hover-actions.tsx` only (`CUSTOM(link-new-agent)`:
  `openNewAgentWithUrl`, and `openWorkspaceTab` shared with `openUrlInWorkspaceTab`).
- **Re-apply:** Save the draft text with `useDraftStore.getState().saveDraftInput` under
  `buildDraftStoreKey({ serverId, agentId: "", draftId })` for a fresh `generateDraftId()`, then
  open the target `{ kind: "draft", draftId }` the same way the card opens a browser tab (Desks
  store `openTab`, or the workspace layout store with `intent: "reveal"`). Same pattern as
  `git-sync/open-resolve-tab.ts`.
- **Verify:** Hover a web link in a chat, click the robot icon: a "New Agent" tab opens with the
  link in the composer and nothing sent. Needs a new app build; no daemon restart.

## reopen-closed-tab: Ctrl+Z right after closing a Desk tab reopens it

- **Added:** 2026-11-09
- **Commit:** same as task-idle-divider.
- **Why:** A tab closed by mistake (Ctrl+W, middle click) had to be found again in the sidebar.
- **What:** In Tasks mode, closing Desk tabs remembers them (up to 20, empty launchers skipped).
  The next Ctrl+Z (Cmd+Z) reopens the newest one in the Desk it was closed from, and pressing it
  again reopens the one before. Any other key disarms it, so Ctrl+Z goes back to undoing text as
  soon as you type. The tab comes back as a kept tab at the focused pane, not in its old position.
  The workspace layout (Tasks mode off) is not covered.
- **Files:** `packages/app/src/task-navigation/reopen-closed-tab.ts` (+ `.test.ts`), new. Core:
  `task-navigation/desk-screen.tsx` (`CUSTOM(reopen-closed-tab)`: `closeTabs` remembers the tabs,
  and the screen mounts `useReopenClosedTabShortcut`). It listens on `window` in the capture phase
  instead of a keyboard action so the composer's own undo never sees that Ctrl+Z.
- **Re-apply:** In the Desk screen's `closeTabs`, call `rememberClosedDeskTabs` with the active Desk
  id and the closing tabs (without `id`) before closing them, and call
  `useReopenClosedTabShortcut(isFocused)`.
- **Verify:** `(cd packages/app && npx vitest run src/task-navigation/reopen-closed-tab.test.ts)`
  (the update script runs it). In the app, close a tab with Ctrl+W, press Ctrl+Z: it is back.
  Needs a new app build; no daemon restart.

## skills-loaded: our fork of the Skills plugin, with a tab for what the session has loaded

- **Added:** 2026-11-09
- **Commit:** `custom: vendor paseo-skills 0.4.0 into custom/plugins` (unchanged baseline, diff
  against it), then `custom: Skills/MCPs popover shows the skills and MCPs the session loaded`
- **Why:** The third-party Skills plugin (`@gpambrozio/paseo-skills`, MIT) lists the skills on
  disk, which is not what the agent has in its context: Claude Code drops descriptions past its
  budget, adds plugin and bundled skills, and loads MCP tools by name only until they are
  searched. The session file records all of that, so no model call is needed.
- **What:** `custom/plugins/skills/`, plugin id still `skills`. The composer pill reads
  **Skills/MCPs** (with the count). Its popover has two tabs: **Search Skill** (the original
  browser) and **Skills and MCPs Loaded**, backed by the `skills.loaded` RPC.
  - Claude: replays the transcript's `attachment` lines (`skill_listing`, `deferred_tools_delta`,
    `mcp_instructions_delta`); a `compact_boundary` resets them. ToolSearch's `tool_reference`
    results count as full schemas. The transcript is
    `<config>/projects/<encoded cwd>/<sessionId>.jsonl`, looked up in `CLAUDE_CONFIG_DIR`, then
    `~/.claude-personal`, then `~/.claude`, then in any project folder of those.
  - Codex: the last `<skills_instructions>` in the rollout (`$CODEX_HOME/sessions/.../rollout-*-<threadId>.jsonl`).
    Rollouts record no MCP state, so the servers come from `config.toml` as configured/disabled.
  - An agent without a session file shows the newest session of the same project (Claude: the
    project folder of the daemon's config dir; Codex: the newest rollouts whose cwd matches),
    without that session's ToolSearch loads, and says so with its date.
  - Skills are grouped your own (in `<config>/skills`, `~/.agents/skills`, or `.claude/skills` /
    `.agents/skills` up to the repo root; for Codex, any root that is not `.system` or the plugin
    cache), then the rest with a description, then name-only. Each row shows its badge and
    category. MCP servers show status, tool count, full schema vs name only, and whether their
    instructions are in context.
- **Files:** plugin-only. New: `server/loaded/` (`claude.ts`, `codex.ts`, `report.ts`,
  `sources.ts`, `handler.ts`, tests and trimmed fixtures), `client/loaded.tsx`, `tsconfig.json`,
  `.gitignore`, `package-lock.json`. Changed: `shared/skills.ts` (RPC), `index.server.ts`,
  `client/popover.tsx` (tabs), `client/pill.tsx` (label), `package.json` (devDependencies and a
  `node --test` script, like token-ledger). Marked `CUSTOM(skills-loaded)`. Excluded from the root
  oxlint/oxfmt like token-ledger.
- **Gotcha:** the npm plugin keeps no data: its install folder only holds `node_modules`, so
  `paseo plugin remove skills` loses nothing. Session files can be large (a Codex rollout passed
  200 MB); the server streams them and caches each parse until the file's size or mtime changes.
- **Re-apply:** Plugin-only; an upstream merge can't conflict. To take a new upstream
  paseo-skills, diff it against the baseline commit and replay the changes listed above.
- **Setup:** `paseo plugin remove skills --home <home>`, then
  `paseo plugin install "$PWD/custom/plugins/skills" --home <home>` (both daemons).
- **Verify:** `(cd custom/plugins/skills && npx tsc --noEmit && npm test)` (the update script runs
  it). In the app, open the Skills/MCPs pill of a Claude agent and pick **Skills and MCPs Loaded**:
  your skills come first, and the MCP servers match `/mcp`. A new agent shows "From your last
  session in this project".

## no-git-hooks: run checks manually

- **Added:** 2026-11-09
- **Commit:** pending
- **Why:** Commits should not run formatting, lint, or typecheck automatically.
- **What:** Remove Lefthook, its configuration and its npm prepare script. Run the checks manually.
- **Core files touched:** `lefthook.yml` (removed), `package.json` and `package-lock.json`.
- **Re-apply:** Remove the Lefthook dependency, configuration and `prepare` script if upstream restores them.
- **Verify:** `npm exec -- lefthook uninstall` removes installed hooks; `npm run typecheck` and `npm run lint` remain available.

## delegation: Opus sessions plan and review, a cheaper subagent writes the code

- **Added:** 2026-11-11 (based on upstream v0.14.0)
- **Commit:** `custom: delegation icon and plugin, Opus sessions hand implementation to a Sonnet subagent`
- **Why:** In 30 days only 34 of 825 Claude sessions used a subagent, and the Opus main sessions
  re-read ~215k tokens of context per turn (52% of their cost is cache reads). Claude Code's own
  Agent tool description pushes against delegating ("When in doubt, don't spawn"), and a
  general-purpose subagent inherits Opus. Measured elsewhere, an Opus session that delegates to a
  Sonnet implementer cost ~40% less per PR, mostly because the main session stays smaller.
  Analysis script: `~/uprojects/tmp/subagent-usage-cost.py`.
- **What:** The `delegation` plugin and a composer icon (Split), after Jev's.
  - The icon turns delegation on or off for the host's **new** sessions (tinted while on); the
    caret opens the sheet: **Delegate in new sessions**, implementer model (Sonnet/Opus/Haiku,
    default Sonnet) and effort (default medium), **When to delegate** (Conservative, Balanced,
    Aggressive), **Review in the session**, **Broad searches** (Off/Haiku/Sonnet, an Explore
    subagent), **Extra instructions**, Restore defaults. Off by default. The same sheet opens from
    Settings > Bruno's Customizations > Composer > Delegation; Chat options > Delegation hides
    the icon.
  - The plugin's `agent.create` hook appends the rule (`shared/policy.ts`) to the saved
    `systemPrompt` of a new Claude session on Opus, Fable or the provider default. It tells the
    session to call the Agent tool with `model`/`effort` per call, so no agent file is needed and
    the terminal CLI is untouched. Written once at creation: changing a running session's system
    prompt would throw its prompt cache away, so open sessions keep what they started with.
    Sonnet/Haiku sessions, other providers and daemon-internal agents are skipped; a prompt that
    already has the rule (a restart copying the config) doesn't get it twice.
  - **Sheet tabs** (2026-11-13): Delegation (switch, **Implementer**, **Policy**), Subagents,
    Advanced (Extra instructions, Restore defaults), Reports. One Save (footer on the first
    three tabs) writes everything.
  - **Additional instructions** (setting `subagentInstructions`, Subagents tab, empty by default):
    text added to every subagent's instructions, in two places. (a) Paseo subagents (label
    `paseo.parent-agent-id`, any provider): the `agent.session_open` hook sets
    `PASEO_SUBAGENT_APPEND_PROMPT`, and the daemon folds it into the launch config's
    `daemonAppendSystemPrompt` after any daemon append (`withSubagentAppendPrompt`, called from
    `resolveProviderLaunchConfig`, so create, resume, refresh and import all get it). It is not
    saved in the stored config. Providers that read `daemonAppendSystemPrompt` (Claude, Codex,
    OpenCode, Pi, OMP, plugin providers) use it; the ACP ones (Copilot, Cursor, Kimi, Kiro,
    generic ACP) ignore it. (b) A delegating session (Agent tool): `buildDelegationPolicy` adds a
    line telling it to end every subagent prompt with the text, verbatim.
  - **Subagent context** (setting `subagentContext`, Subagents tab, default `full`): trims the
    memory files a subagent created through Paseo (label `paseo.parent-agent-id`) loads. The
    plugin's `agent.session_open` hook sets an env var on every launch (create and resume),
    whether or not delegation is on. Claude: `none` sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`;
    `project` sets `PASEO_CLAUDE_MD_EXCLUDES` (JSON list from `server/claude-md-excludes.ts`:
    the config dir's `CLAUDE.md` and `rules/**`, and `CLAUDE.md`, `CLAUDE.local.md`,
    `.claude/CLAUDE.md`, `.claude/rules/**` of every folder above the git root), which the Claude
    provider passes to the SDK as the `claudeMdExcludes` setting. Codex: only `none` does
    anything, `PASEO_CODEX_AGENTS_MD=none` becomes `project_doc_max_bytes=0` in the thread config
    (drops the repo's AGENTS.md). Codex 0.163 has no setting for `$CODEX_HOME/AGENTS.md`
    (checked with `codex exec -c ...` and the rollout file), so the global file is always read and
    `project` is a no-op for Codex. Claude Code's own Agent-tool subagents are not affected.
  - Pairing: `agent.create` puts `PASEO_DELEGATION_ID` in the first launch's env,
    `agent.session_open` (reason create) ties it to the agent id, and `agent.created` appends a
    card ("Delegação ligada: implementação vai para Sonnet · medium, …") and a line to
    `~/.local/state/paseo-delegation/sessions.jsonl` (`PASEO_DELEGATION_LOG` moves it).
  - The sheet's **Reports** tab (`reports`, added 2026-11-11, plugin RPC `report`,
    `server/report.ts` + test, app `reports.tsx` + `report-model.ts` + test): 7 or 30 days of this
    host's Claude sessions on Opus/Fable, split by whether the saved system prompt in
    `PASEO_HOME/agents` has the rule (so it doesn't need the session log), each priced at API
    rates from its transcript found by `persistence.sessionId` under
    `CLAUDE_CONFIG_DIR/projects` (main and `subagents/`, one count per request id). Shows a
    verdict on cost per session with a small-sample warning, a table (sessions, cost per session,
    subagent share, context per turn, turns, cheap delegations per session) and the 50 newest
    sessions (● delegated). The first read of 30 days took ~12 s on 636 sessions; each transcript
    is cached by size and mtime in the plugin process (~0.4 s after).
- **Files:** `packages/protocol/src/delegation.ts` (ids, settings schema, card schema);
  `custom/plugins/delegation/` (`shared/policy.ts` + test, `shared/settings.ts`,
  `server/tracker.ts` + test, `server/session-log.ts`, `server/report.ts` + test, `client/card.tsx` + test);
  `packages/app/src/delegation/` (`form-model.ts` + test, `report-model.ts` + test, `sheet.tsx`,
  `reports.tsx`, `toggle.tsx`);
  `packages/server/src/server/plugins/custom-delegation-plugin.e2e.test.ts`.
- **Core files touched:** server `agent/providers/claude/agent.ts` (`buildSettingsOptions` adds
  `claudeMdExcludes`, new `claude-md-excludes.ts` + test) and `agent/providers/codex-app-server-agent.ts`
  (`launchEnv` in the session deps, `buildCodexInnerConfig` merges `codex-agents-md.ts` + test),
  marked `CUSTOM(delegation-subagent-context)`; server `agent/agent-manager.ts`
  (`resolveProviderLaunchConfig` calls `withSubagentAppendPrompt`) and new
  `agent/subagent-append-prompt.ts` + test, marked `CUSTOM(delegation-subagent-instructions)`; app `composer/agent-controls/index.tsx` (`<DelegationToggle>` after
  `<JevRouterToggle>`), `composer/chat-options.ts` (`delegation` key),
  `screens/settings/bruno-customizations/section.tsx` (icon and the Composer card). Marked
  `CUSTOM(delegation)`.
- **Re-apply:** In `resolveProviderLaunchConfig` (agent-manager), run the merged config through
  `withSubagentAppendPrompt(merged, launchContext.env)` before the `paseoTools` strip. In the Claude provider's `buildSettingsOptions`, merge
  `claudeMdExcludes` from `parseClaudeMdExcludes(this.launchEnv)` into the settings (and don't
  return `{}` early). In the Codex provider, pass the launch env into the session deps and
  `Object.assign(innerConfig, codexAgentsMdConfig(deps.launchEnv))`. Render `DelegationToggle` at the end of the composer's agent control row when the
  `delegation` chat option is on; add the key to `CHAT_OPTIONS`. Everything else is plugin code.
- **Setup:** `paseo plugin install "$PWD/custom/plugins/delegation" --home ~/.paseo` and again
  with `--home ~/.paseo-telus`, a desktop build for the app.
- **Verify:** `npx vitest run custom/plugins/delegation packages/app/src/delegation` and the e2e
  `custom-delegation-plugin.e2e.test.ts` (both in the update script), plus
  `claude-md-excludes.test.ts` and `codex-agents-md.test.ts` in `packages/server`. By hand: turn the icon on,
  start an Opus session; the card shows at the top, and a multi-file change goes to a Sonnet
  subagent pane. Set Subagent context to Project only, have a session create a Claude subagent
  and ask it which CLAUDE.md files it sees (or run `getContextUsage` on it): only the repo's.
  `subagent-append-prompt.test.ts` in `packages/server/src/server/agent`. For Additional
  instructions, the daemon part needs a daemon restart (`kill-paseos-and-daemons.sh`) to load;
  then create a subagent through Paseo and check that it follows the text.

## later: `/later <duration> <message>` sends a message to this agent once, later

- **Added:** 2026-11-11 (based on upstream v0.14.0)
- **Commit:** pending
- **Why:** To say "run the tests again in 5 minutes" or "ping me in 1h30m" from the composer and
  have it survive a daemon restart, without leaving a recurring schedule behind.
- **What:** The `later` plugin adds the client slash command `/later 5m run the tests again`
  (units `s`, `m`, `h`, `d`, combinable like `1h30m`; at most 365d). A missing, zero or invalid
  duration, or an empty message, shows a toast error and sends nothing. There is no success toast
  (the plugin API has none).
  - The command calls the plugin RPC `send-later`; the daemon creates a schedule named
    `later: <first 40 chars>` with target `{type:"agent", agentId}`, `maxRuns: 1`,
    `runOnCreate: false` and `expiresAt` 10 minutes after the run.
  - Cadence: a one-shot **cron** for the minute at or after now + duration, in the daemon's time
    zone (`0 10 11 11 *`). Minute granularity: `5m` fires at the next whole minute at or after 5
    minutes, so `90s` fires at most 30 s late and anything under a minute fires at the next
    minute. `every` was not used: it is marked COMPAT in `schedule/cron.ts` (to be removed after
    2027-01-17), defaults to running at create, and the client type only allows cron.
  - After the single run the schedule is `completed` (`nextRunAt: null`) and stays in the list as
    history. If the daemon is down at the due minute, restart skips the missed run (the cursor
    moves to next year) and `expiresAt` completes the schedule: the message is lost, not delayed.
  - Feedback (added 2026-11-11): one **composer pill** per pending `/later` message of any agent:
    clock icon, label `HH:MM · preview` (local time, `DD/MM HH:MM` when not today, `paused` for a
    paused schedule). Tapping the pill opens a menu with one item, X **Cancel this message**, which
    deletes the schedule. The pill API has no inline button, so the X lives in that menu. The
    pills come from `client/pending-pills.ts` (plain entry code, no React): it calls the RPC
    `list-later` on load, right after `/later` succeeds, after a cancel, every 30 s, and 2 s after
    the earliest send time so a fired message's pill goes away. `cancel-later` refuses any schedule
    whose name does not start with `later:`. The slash-command context has no toast, so there is
    no "Scheduled for HH:MM" notice; the pill is the confirmation.
  - Pure logic (filtering, time label, refresh delay) and the parser in `shared/later.ts` with
    `shared/later.test.ts`.
- **Core files touched:** `packages/client/src/index.ts`: `PaseoScheduleActions` and the
  `schedules` member of `PaseoApi` with `create`, `list` and `delete` (marked `CUSTOM(later)`),
  because plugins had no way to manage schedules. They wrap `DaemonClient.scheduleCreate`,
  `scheduleList` and `scheduleDelete`.
- **Re-apply:** Add `schedules: { create, list, delete }` to `PaseoApi` and `createPaseoApi` again, calling
  the matching `daemonClient.schedule*` method and throwing on `payload.error`. If upstream adds a
  schedules surface to the plugin API, drop the patch and call that from `server/schedule.ts`.
- **Verify:** `npx vitest run custom/plugins/later --bail=1`. Then `npm run build:client`, and
  `npx tsx packages/cli/src/index.js plugin install "$PWD/custom/plugins/later" --home ~/.paseo`
  (or `plugin reload later` after edits). In an agent composer, `/later 1m hello`: the agent gets
  "hello" at the next minute and `paseo schedule ls` shows it `completed`. Right after typing `/later 5m hi`
  the pill `HH:MM · hi` appears above the composer; its menu's Cancel removes it and the schedule.

## confirmed-barge-in: noise no longer cuts a spoken reply off

- **Added:** 2026-11-11
- **Commit:** `custom: voice mode interrupts on words or a second of speech, not on any sound`
- **Why:** The voice detector's speech start interrupted the reply and the agent right away. A
  short noise, or the reply's own echo through a speaker, cut replies off mid-sentence, and both
  cut-offs seen on 2026-11-11 transcribed to an empty string. The faster barge-in in
  [voice-settings](#voice-settings-settings--voice-and-dictation) (300 ms and 4x gain while a
  reply plays) made false starts more likely.
- **What:** Speech interrupts once it transcribes to words, or, while no reply plays, once it
  lasts 1 s (`BARGE_IN_CONFIRM_MS`). An empty transcript interrupts nothing. While a reply plays
  only words count: on the first build the reply's own echo held the detector open for 1.4 s,
  transcribed to nothing, and still cut the reply off. `voice_input_state isSpeaking=true` waits for the same
  confirmation, because the app stops playback when it sees it. A short "stop" now cuts the reply
  after transcription, about half a second later than before.
- **Core files touched:** `packages/server/src/server/session/voice/voice-session.ts`
  (`onSpeechStarted`, `onSpeechStopped`, `onFinalTranscript`, `cancel`, new `armBargeIn` /
  `confirmBargeIn`), its test.
- **Re-apply:** In the voice turn controller callbacks, replace the immediate
  `handleVoiceSpeechStart()` on speech start with a timer, and call the same confirmation before
  handling a non-empty final transcript.

## voice-live-transcript: voice mode shows your words while you talk

- **Added:** 2026-11-11
- **Commit:** `custom: voice mode shows your words live and stops a reply at the first one`
- **Why:** Voice mode only showed text after you stopped talking, and a barge-in during a spoken
  reply waited for the final transcript. Dictation already shows live partials.
- **What:** The voice STT session (`SherpaOnnxParakeetSTT.createSession`) takes `partialIntervalMs`
  and re-decodes the open segment on that cadence (one decode in flight, only changed text,
  dropped if the segment was committed or cleared meanwhile, skipped when low-confidence, since
  a partial with words interrupts a reply and echo must not); the final path and its confidence
  filtering are unchanged. The worker passes `decodeIntervalMs ?? 500`. The turn controller now
  forwards every changed non-filler partial, not just the first. `VoiceSession` turns each
  non-empty partial into a barge-in confirmation (reason `partial`) and a `voice_input_state`
  `{ isSpeaking: true, transcript }`. The app keeps `liveTranscript` in the voice telemetry,
  shows it as one muted line (head-truncated) above the volume meter, clears it on the
  transcription result, on stop, and when a new utterance starts. A repeated `isSpeaking: true`
  no longer re-stops playback; only the false to true transition does.
- **Core files touched:** `packages/protocol/src/messages.ts` (optional `transcript` on
  `voice_input_state`), `packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-stt.ts`,
  `.../local/worker-process.ts`, `packages/server/src/server/session/voice/voice-turn-controller.ts`,
  `.../voice-session.ts`, `packages/app/src/voice/voice-runtime.ts`,
  `packages/app/src/contexts/session-context.tsx`, `packages/app/src/contexts/voice-context.tsx`,
  `packages/app/src/components/realtime-voice-overlay.tsx`, and their tests.
- **Re-apply:** Re-add the optional `transcript` field, the interim decode in the voice STT
  session, `partialIntervalMs` in the worker, drop the once-per-turn limit in
  `firePartialTranscript`, and the `onPartialTranscript` body in `voice-session.ts`; then the
  `liveTranscript` plumbing in the app.
- **Verify:** `cd packages/server && npx vitest run src/server/session/voice/ src/server/speech/providers/local/sherpa/sherpa-parakeet-stt.test.ts --bail=1`
  and `cd packages/app && npx vitest run src/voice/voice-runtime.test.ts --bail=1`. In voice mode,
  talk: words appear above the meter; speak words while a reply plays: it stops at once.

## voice-ack-silences-reply: "okay" only silences the reply

- **Added:** 2026-11-11
- **Commit:** (uncommitted when written)
- **Why:** Saying "okay" while the agent spoke aborted its run and sent "okay" as a new prompt.
  An acknowledgement should only make it stop talking.
- **What:** `ACKNOWLEDGEMENT_WORDS` (`ok`, `okay`, `tá`, `ta`, `beleza`; case and punctuation
  ignored, repeats allowed) in `voice-session.ts`. A partial or final transcript made only of
  those words calls `silenceReplyOnly()`: it emits `voice_input_state isSpeaking=true` (the app
  stops playback), replaces the abort controller (stops TTS generation, later replies still
  speak) and cancels pending playbacks. It does not call `handleAbort`, does not interrupt the
  agent, and the final goes through the empty-transcript path, so nothing reaches the agent. The
  1 s sustained-speech timer also skips a partial that is ack-only. A partial that grows into
  other words takes the normal barge-in. Only the reply playing at that moment is silenced; the
  agent's next speak call plays normally.
- **Core files touched:** `packages/server/src/server/session/voice/voice-session.ts`, its test.
- **Re-apply:** Re-add the constant and `isAcknowledgementOnly`, `silenceReplyOnly`, and the
  three branches in `onPartialTranscript`, `onFinalTranscript` and the `armBargeIn` timer.
- **Verify:** `cd packages/server && npx vitest run src/server/session/voice/voice-session.test.ts --bail=1`.
  In voice mode, say "okay" while a reply plays: it stops, the agent keeps working, no prompt.

## voice-hold-to-talk: hold Enter to talk, release to send

- **Added:** 2026-11-11
- **Commit:** (uncommitted when written)
- **Why:** Silence detection cuts long or hesitant utterances short. Holding a key keeps the turn
  open until you let go.
- **What:** New optional inbound message `voice.set_hold.request { held }` (fire-and-forget, no
  response) gated by `server_info.features.voiceHold`; the client sends it only when the flag is
  present. Host: `held=true` is a full barge-in (stops playback, interrupts the agent) and opens a
  capture turn through `VoiceTurnController.beginHold()`; while held the detector's `speech_stopped`
  is ignored; `held=false` (`endHold()`) ends the turn like `handleSpeechStopped`. App: Enter
  (web/desktop, not repeating, not in a text field, released on blur) and a new hand button in
  the voice overlay (press and hold, works on native) call `runtime.setHold`; release is sent
  200 ms late so the capture buffer's last words arrive first. The overlay shows "Release to
  send" while held. Settings > Voice > Microphone gets "Hold to talk" (per device,
  `voice/hold-to-talk-settings.ts`): when on, the app streams audio only while held (client-side
  gate, so the host needs no setting). Muting releases the hold.
- **Core files touched:** `packages/protocol/src/messages.ts` (`VoiceSetHoldRequestSchema`,
  `features.voiceHold`), `packages/server/src/server/websocket-server.ts`, `session.ts`,
  `authorization/operation-permissions.ts`, `session/voice/index.ts`, `voice-session.ts`
  (`handleHold`), `voice-turn-controller.ts`, `packages/client/src/daemon-client.ts`
  (`setVoiceHold`), app `voice-runtime.ts`, `contexts/voice-context.tsx`,
  `contexts/session-context.tsx`, `components/realtime-voice-overlay.tsx`,
  `composer/input/input.tsx`, `screens/settings/voice/voice-settings-page.tsx`,
  `i18n/resources/custom-voice-settings.ts`; new `voice/hold-to-talk-settings.ts`,
  `voice/use-voice-hold-key.ts`.
- **Re-apply:** Re-add the schema, flag and dispatch; `beginHold`/`endHold` plus the `held` guard
  on `speech_stopped`; `VoiceSession.handleHold`; then the runtime `setHold`, upload gate, key
  hook, overlay button and settings switch.
- **Verify:** `cd packages/server && npx vitest run src/server/session/voice/ --bail=1` and
  `cd packages/app && npx vitest run src/voice/voice-runtime.test.ts --bail=1`. Restart the
  daemon, then in voice mode hold Enter, talk with pauses, release: one utterance is sent.

## claude-stt: Claude as the speech-to-text provider for dictation and voice mode

- **Added:** 2026-11-13
- **Commit:** `custom: Claude speech-to-text provider (Claude Code's /voice service)`
- **Why:** Claude Code's `/voice` transcribes through Anthropic with the Claude.ai login, streams
  partial text, and ends utterances on the server. The local Parakeet model re-transcribes the
  whole open segment every 350 ms and costs GPU/CPU; Claude costs nothing extra on a
  subscription.
- **What:** A third STT provider, `claude`, next to `local` (labeled "Local STT") and `openai`.
  The Settings page (Bruno's Customizations > "Voice and Dictation") has tabs, remembered per
  device (`voice/voice-settings-tab.ts`): Dictation (on/off, provider, local model only for Local
  STT, tuning), Voice mode (on/off, listening provider and model, speaking model and voice,
  instructions, thinking tone, microphone), Claude (which features use it, login state, language,
  key terms, config folder), Local engine (GPU, model folders), Status (status and logs). A
  feature on Claude hides its local model picker; the model stays saved for switching back.
  Language is one of the 20 codes Claude Code accepts, plus `pt-BR` (Claude Code only sends `pt`; the service accepts both) (default `en`); the service has no mixed or
  auto mode (`multi` and `auto` are refused), but its final pass handles other-language words.
  - Protocol, read from claude-cli 2.1.322 (`/api/ws/speech_to_text/voice_stream`):
    `speech/providers/claude/stt.ts` has it in its header comment. It is undocumented; a Claude
    Code update can change it. To re-read it, search the binary
    (`~/.local/share/claude/versions/<v>`) for `[voice_stream] Connecting to`.
  - One Paseo segment (between `commit()`s) is one WebSocket; the server splits it into
    utterances, so the segment's text is its ended utterances plus the open one. `commit()`
    sends CloseStream and the final text comes on the next endpoint or close (1.5 s with no data,
    5 s at most). The next audio opens a new socket, buffering while it connects.
  - Login: `<config dir>/.credentials.json` (`claudeAiOauth`); config dir is the setting, then
    `CLAUDE_CONFIG_DIR` of the daemon (`~/.claude-personal` on the personal daemon), then
    `~/.claude`. Claude Code keeps the token fresh while it runs; when it expired, the provider
    refreshes it with Claude Code's OAuth client and writes the file back atomically, keeping the
    other keys, and takes another process's token if that one won the race.
  - Persisted as `features.{dictation,voiceMode}.stt.provider: "claude"` (its `model` is the
    remembered local model) and `providers.claude.{configDir,language,keyterms}`. Env overrides:
    `PASEO_DICTATION_STT_PROVIDER`, `PASEO_VOICE_STT_PROVIDER`, `PASEO_CLAUDE_STT_LANGUAGE`,
    `PASEO_CLAUDE_STT_CONFIG_DIR`. Turn detection stays local; speaking can use Claude too (see "Claude text-to-speech provider").
- **Core files touched:** protocol `speech-settings.ts` (five optional fields on the mutable speech
  config, optional `claudeStt` status). Server: `persisted-config.ts` (`providers.claude`, the
  `claude` STT site), `speech/speech-types.ts` (enum), `speech/speech-config-resolver.ts`,
  `speech/speech-runtime.ts` (chains `initializeClaudeSpeechServices` after OpenAI),
  `bootstrap.ts` (`PaseoSpeechConfig.claude`, `buildMutableSttProviderConfig`; the mutable config
  builders take the persisted config), `daemon-config-store.ts` (`mergeSttSite`,
  `mergeClaudeProviderPatch`, `mergeVoiceTtsPatch`, `providers.claude` reloadable),
  `speech/speech-settings-service.ts` (env names, `claudeStt` status); new
  `speech/providers/claude/{config,credentials,stt,runtime}.ts`. App:
  `voice-settings-page.tsx`, `voice-settings-model.ts`, `dictation-tuning-model.ts`,
  `i18n/resources/custom-voice-settings.ts`; new `claude-stt-section.tsx`, `claude-stt-model.ts`.
- **Re-apply:** Add `claude` to both STT provider enums and the persisted STT union, then chain
  `initializeClaudeSpeechServices` after the OpenAI services in `reconcileServices`. In the config
  store, a model edit keeps the site's provider and a provider edit keeps its model. Render
  `<SttProviderRow>` at the top of the Dictation and Voice mode sections and
  `<ClaudeSttSection>` before Local engine.
- **Verify:** `cd packages/server && npx vitest run src/server/speech/providers/claude src/server/daemon-config-store.test.ts --bail=1`
  and `cd packages/app && npx vitest run src/screens/settings/voice/claude-stt-model.test.ts --bail=1`
  (both in the update script). Needs a daemon restart. In Settings > Voice and dictation, the
  provider section shows "Signed in (max)"; pick Claude for Dictation, set Português, dictate:
  the words appear as you speak and the local model picker is locked.

## subagent-tab-status: an agent's tab keeps working while a subagent runs

- **Added:** 2026-11-13
- **Commit:** `custom: Agent tab shows working while a subagent runs`
- **Why:** When an agent hands work to a subagent and ends its turn, its tab went back to idle
  while the subagents track still said "1 working". The sidebar's workspace status already counts
  running subagents; the tab did not.
- **What:** The agent tab's status bucket becomes `running` when the agent's own bucket is `done`
  or `attention` and one of its direct subagents (Paseo or provider, the same rows and rule as the
  track pill's "N working") is working. The agent's own `needs_input` and `failed` still win.
  `subagents/running.ts` reads the session and provider-subagent stores only (no refresh RPC per
  tab); the daemon pushes provider subagent updates to every client.
- **Core files touched:** `packages/app/src/panels/agent-panel.tsx` (`useAgentPanelDescriptor`,
  already custom for `agent-tab-project-icon`); new `packages/app/src/subagents/running.ts` and
  `running.test.ts`.
- **Re-apply:** In the agent panel's `useDescriptor`, take upstream's descriptor and replace its
  `statusBucket` with `withRunningSubagents(bucket, useHasRunningSubagent(serverId, agentId))`.
  If upstream renames the subagent selectors, point `running.ts` at whatever feeds the track pill.
- **Verify:** `cd packages/app && npx vitest run src/subagents/running.test.ts --bail=1` (in the
  update script). In the app: ask an agent to start a background subagent and finish its turn;
  its tab keeps the working spinner until the subagent finishes, then turns finished.

## task-provider-subagents: Tasks sidebar lists provider subagents under their agent

- **Added:** 2026-11-13
- **Commit:** `custom: Tasks sidebar lists provider subagents under their agent`
- **Why:** The Tasks list showed only managed Paseo children. Subagents owned by Claude Code, Codex
  or OpenCode appeared only in the agent pane's subagents track, so an agent that ended its turn
  while a subagent worked looked idle in the list.
- **What:** An agent whose direct provider subagent runs counts as working (state dot, filters,
  counts). Under each task row with subagents, a collapsed row reads "3 subagents · 1 working";
  clicking it lists the subagents (oldest first, status dot, label, provider subtitle), and a
  click opens the read-only `provider_subagent` tab in the parent's workspace (Desks or plain
  workspace route, like `openTask`). Rows are hidden in the Archived filter and stay out of the
  numbered shortcuts. Each mounted task row lists its subagents once per app session
  (`refreshProviderSubagents`), skipping parents already tracked. Features follow
  `serverInfo.features.providerSubagents` per server.
- **Core files touched:** `packages/app/src/task-navigation/sidebar.tsx` (new `ListRow` kinds,
  `agents` merge, `rows` post-processing, `TaskRow` refresh hook, two row components, styles);
  new `packages/app/src/task-navigation/provider-subagent-rows.ts` and `.test.ts`.
- **Re-apply:** In `TaskNavigationSidebar`, rename upstream's `agents` selector result to
  `ownAgents` and derive `agents` by setting `running: true` for parents in `runningParentKeys`.
  Rename the `rows` memo to `taskRows` and add the `rows` memo that appends
  `buildProviderSubagentRows` after each `task` row. Add `useRefreshProviderSubagentsOnce` to
  `TaskRow` and the two row components to `renderRow`.
- **Verify:** `cd packages/app && npx vitest run src/task-navigation/provider-subagent-rows.test.ts --bail=1`
  (in the update script). In the app, Tasks mode: an agent with a running subagent shows the
  working dot and a collapsed "N subagents · 1 working" row; click expands it, click a subagent
  opens its tab.

## dictation-live-mic: dictation turns green only once the microphone delivers audio

- **Added:** 2026-11-13
- **Commit:** `custom: dictation turns green only once the microphone delivers audio`
- **Why:** The user's only microphone is a Bluetooth speakerphone (LG XG5S). Measured three
  times: every time it opens it sends ~950 ms of exact digital silence (all samples 0), then a
  click, then real audio. The composer turned green as soon as the mic opened, so words spoken
  right after Ctrl+D were lost with any speech-to-text provider.
- **What:** The web audio source feeds each input block to a detector
  (`hooks/dictation-mic-live.ts`): the first block with a sample above 1e-4 marks the mic live;
  after 2.5 s without one it is marked live anyway. `useDictation` returns `isMicWarming`
  (recording and not live yet). While warming, the dictation overlay uses `surface2`/`foreground`
  instead of the accent green, shows "Starting mic…", and the toolbar voice button skips its
  recording fill. Audio keeps flowing to the daemon while warming; only the look waits. Cancel,
  confirm and media pause behave as before. Native and the MediaRecorder fallback are live at
  once.
- **Core files touched:** app `hooks/use-dictation-audio-source.{web,native,types}.ts`
  (`isLive`), `hooks/use-dictation.ts` and `.shared.ts` (`isMicWarming`),
  `components/dictation-controls.tsx`, `composer/input/input.tsx`,
  `i18n/resources/custom-voice-settings.ts` (`claudeStt.startingMic`); new
  `hooks/dictation-mic-live.ts`.
- **Re-apply:** Add `isLive` to the dictation audio source contract, feed the detector from
  `onaudioprocess`, reset it on stop, and derive `isMicWarming` in `useDictation`. Thread it to
  the overlay and the voice button as a neutral variant of the recording look.
- **Verify:** `cd packages/app && npx vitest run src/hooks/dictation-mic-live.test.ts --bail=1`
  (in the update script). On the desktop with the LG XG5S, press Ctrl+D: the bar shows "Starting
  mic…" in neutral colors for about a second, then turns green; words said after green are kept.

## background-tools: a chip for background shells and monitors, and the tab stays working

- **Added:** 2026-11-13
- **Commit:** `custom: Background tools chip, and the tab stays working while they run`
- **Why:** A Claude agent can end its turn with a `Bash` run in the background or a `Monitor` still
  running. The tab went idle and nothing showed that work was left.
- **What:** Claude Code's `background_tasks_changed` (the full live set, per process) is mapped to
  `shell` / `monitor` / `other` tools; subagents and workflows stay in the subagents pill, ambient
  tasks are skipped. The command line comes from the starting tool call (`task_started`). The
  session emits an internal `background_tasks_changed` stream event, and an empty one when the
  process restarts. The agent manager keeps it on the agent (not on the client event stream), and
  `toAgentPayload` sends it as the optional `backgroundTasks` field. In the app, a `2 tools` chip
  (`1 tool`) sits next to the subagents pill; its panel lists kind, description and command, and a
  click copies the command (or the description). The agent tab and the Tasks sidebar count such an
  agent as working. A new chat option, "Background tools", hides or moves the chip. Wording is
  English only.
- **Core files touched:** protocol `messages.ts` (`AgentBackgroundTaskPayloadSchema`, `backgroundTasks`);
  server `agent-sdk-types.ts`, `agent-manager.ts`, `agent-projections.ts`,
  `providers/claude/agent.ts`, `providers/claude/wake-tasks.ts`; app `stores/session-store.ts`,
  `utils/agent-snapshots.ts`, `panels/agent-tracks.tsx`, `panels/agent-panel.tsx`,
  `task-navigation/sidebar.tsx`, `composer/chat-options.ts`; new `background-tools/`.
- **Re-apply:** Re-add the field to the snapshot schema, the stream event and the manager case
  (`flags.shouldDispatchEvent = false`, then `emitState`), the projection spread, and the Claude
  session hooks (`observeBackgroundToolStart`, the emit beside `wakeTaskCount`, `resetBackgroundTools`
  where `wakeTaskCount` resets). In the app, carry the field through both snapshot normalizers, add
  the chip node to `AgentTracks` and `hasAgentTracks`, and OR the tools into the tab and sidebar
  running checks.
- **Verify:** Needs a daemon restart (the server sends the new field). Tests are in the update
  script (`background-tools/presentation.test.ts`, `wake-tasks.test.ts`,
  `agent.background-subagent.test.ts`). In the app: ask an agent to start a background `sleep 600`
  and end its turn; the tab keeps the working spinner, a `1 tool` chip appears, and clicking a row
  copies the command.

## github-account: GitHub account per host in Bruno's Customizations

- **Added:** 2026-11-13
- **Commit:** `custom: GitHub account per host in Bruno's Customizations`
- **Why:** Two daemons run side by side (personal and work), each with its own `gh` config
  directory. The choice came only from the `GH_CONFIG_DIR` the launcher passed; when a launcher
  inherited the wrong env, the work daemon ran `gh` as the personal account and PR status failed
  ("GitHub batch PR status response is missing repository ...").
- **What:** Settings > Bruno's Customizations > GitHub edits `daemon.github.configDir` of the
  active host (empty = keep the launcher's `GH_CONFIG_DIR`). The daemon applies it to its own
  `process.env.GH_CONFIG_DIR` at startup and on every change (the setting wins, clearing restores
  the launch-time value) and resets the cached shell env so new agents and terminals inherit it;
  the `gh` runner reads `process.env` per call. New RPC `github.account.status.request` /
  `.response` runs `gh api user --jq .login` for the effective dir or a typed candidate (Test),
  gated on `server_info.features.githubAccount`. Running agents keep the old account until restarted.
- **Core files touched:** `packages/protocol/src/messages.ts` (config + patch fields, RPC schemas,
  feature flag), `packages/server/src/server/{persisted-config,config,bootstrap,daemon-config-store,
session,websocket-server}.ts`, `authorization/operation-permissions.ts`,
  `agent/provider-launch-config.ts` (`resetShellEnvCache`), `packages/client/src/daemon-client.ts`
  (`getGithubAccountStatus`), app `screens/settings-screen.tsx`, `utils/host-routes.ts`; new
  `server/github-account.{ts,test.ts}` and `screens/settings/bruno-customizations/github-page.tsx`.
- **Re-apply:** Add `github.configDir` through the same paths as `appendSystemPrompt`
  (`RELOADABLE_PATHS`, `PERSISTED_TO_MUTABLE_PATH`, `resolveStaticLoadConfigSettings`,
  `createInitialMutableDaemonConfig`), call `applyGithubConfigDir` at the top of `createDaemon`
  and from `onFieldChange("github.configDir")`, wire the RPC like `history.ai_search`, and add the
  `customizations-github` slug, sidebar item and page case.
- **Verify:** `cd packages/server && npx vitest run src/server/github-account.test.ts src/server/daemon-config-store.test.ts --bail=1`
  (in the update script). In the app, set the Telus host's directory to `~/.config/gh`, press
  Test, then Save: "Signed in as" shows the work login and PR status loads.

## steer-pending: a steered message shows pending until Claude takes it, with an X to cancel

- **Added:** 2026-11-13
- **Commit:** `custom: steered message shows pending until Claude takes it, with an X to cancel`
- **Why:** A message sent in steer mode while Claude Code is mid-turn (a long tool call) waits in
  the CLI's queue until the next tool boundary, but its bubble looked delivered. There was no way
  to see that Claude had not read it, or to take it back.
- **What:** Claude only. While Claude has not started the message, its bubble carries a muted
  clock and "pending" label plus an X ("Cancel message"). X asks the daemon to withdraw the
  message from the CLI queue (`query.cancelAsyncMessage(uuid)`). On success the bubble
  disappears and its text goes back into that agent's composer when the composer is empty (the
  rewind restore path). If Claude already took the message the daemon answers `cancelled: false`
  and the badge goes away: the message was delivered. Other providers send no fields, so no
  badge. How "started" is detected: the CLI's `command_lifecycle` frame (state other than
  `queued`) for the steer's uuid, the same frame that clears `unstartedMessageUuids`. Fallback
  for a CLI that never sends it: a `user` frame carrying that uuid. A finished or interrupted
  turn, a failed enqueue and closing the session also clear pending, so a steer never stays
  pending. The timeline store is append-only, so a cancelled row stays there and the app hides
  it through `cancelledSteerMessageIds` (the last 50 per agent, in daemon memory); the CLI never
  writes it to Claude's transcript, so a history reload does not show it either.
  - Wire: agent snapshots gain optional `pendingSteerMessageIds` and `cancelledSteerMessageIds`;
    new RPC `agent.cancel_steer.request` `{agentId, clientMessageId}` -> `.response`
    `{cancelled, error}` (dotted name per `docs/rpc-namespacing.md`); `server_info.features.steerPending`
    gates the X in the app.
- **Core files touched:** `packages/protocol/src/messages.ts` (snapshot fields, RPC schemas,
  feature flag); `packages/client/src/daemon-client.ts` (`cancelAgentSteer`);
  `packages/server/src/server/agent/agent-sdk-types.ts` (`getPendingSteerMessageIds`,
  `subscribePendingSteers`, `cancelSteer` on `AgentSession`), `provider-registry.ts` (forwards
  them), `providers/claude/agent.ts` (`pendingSteerClientIds`, set in `enqueueSteer`, cleared in
  `forgetStartedMessage`, `withdrawUnstartedMessages`, `notifySubscribers` on turn end, `close`),
  `agent-manager.ts` (`syncPendingSteers`, `cancelAgentSteer`, `subscribeToSession`),
  `agent-projections.ts`, `session.ts` (handler), `authorization/operation-permissions.ts`,
  `websocket-server.ts` (feature flag); app `stores/session-store.ts`, `utils/agent-snapshots.ts`,
  `agent-stream/view.tsx` (selectors, `hideCancelledSteers` next to `hideCriticRounds`,
  `cancelSteer`, `steerPending` prop), `components/message.tsx` (one prop and one element). New:
  `agent-stream/steer-pending.ts`, `components/steer-pending-row.tsx`.
- **Re-apply:** In `ClaudeSession.enqueueSteer`, record `uuid -> clientMessageId` after
  `input.push`; drop the entry wherever the uuid leaves `unstartedMessageUuids`, and clear all of
  them on turn end. Expose the three session methods, mirror them into the manager's agent
  (`pendingSteerMessageIds`, `cancelledSteerMessageIds`) and `toAgentPayload`. In the app, filter
  cancelled user rows in `visibleStream` and pass `steerPending` to `UserMessage` for ids in
  `pendingSteerMessageIds`.
- **Verify:** Needs a daemon restart (`kill-paseos-and-daemons.sh`). Tests (in the update
  script): `agent-stream/steer-pending.test.ts`, `providers/claude/agent.steer-pending.test.ts`,
  the "pending steers" test in `agent-manager.test.ts`, and the "cancel steer" tests in
  `packages/protocol/src/messages.test.ts`. In the app: start a Claude agent on a long
  tool call (`sleep 60`), send a message in steer mode: the bubble shows "pending" and an X.
  X before the tool ends: the bubble disappears and the text returns to an empty composer.
  Without pressing X, the badge goes away when Claude picks the message up.

## local-models-dir: one local speech models folder for every daemon, in `.llm/`

- **Added:** 2026-11-13
- **Commit:** `custom: ignore .llm, the local speech models folder` (plus this entry)
- **Why:** Each daemon home kept its own `models/local-speech` (4.3 GB personal, 985 MB TELUS,
  the TELUS models byte-identical copies), and the TELUS Local STT had only the English models.
- **What:** Machine setup, no code. `providers.local.modelsDir` in `~/.paseo/config.json` and
  `~/.paseo-telus/config.json` is `/home/bruno/projetos/paseo/.llm`; `.llm/` is gitignored. The
  old `~/.paseo*/models/local-speech` paths were left as symlinks to `.llm` so daemons started
  before the change kept working; they can go once every daemon restarted. The daemon reads
  `modelsDir` once at startup, so a change needs `kill-paseos-and-daemons.sh`. Both daemons
  downloading the same missing model at once could collide in `.llm/.downloads`.
- **Core files touched:** `.gitignore`; `custom/README.md` (New machine step 5).
- **Re-apply:** Keep `.llm/` in `.gitignore`.
- **Verify:** `ls ~/projetos/paseo/.llm` lists the Parakeet, Kokoro and Silero folders. After a
  daemon restart, Settings > Voice and Dictation > Status shows the models directory as `.llm`.

## claude-tts: Claude as the speaking provider for voice mode

- **Added:** 2026-11-13
- **Commit:** `custom: Claude text-to-speech provider (claude.ai read-aloud service)`
- **Why:** The local sherpa voices cost CPU/GPU and sound flat. The read-aloud service behind the
  Claude apps speaks with five natural voices, streams audio in under a second, and costs
  nothing extra on a subscription. It is the twin of the Claude speech-to-text provider.
- **What:** `claude` as a second speaking provider next to `local`. Voice mode > "Speaking
  provider" (right above "Speaking model"). With Claude picked, the local speaking model and
  speaker pickers hide (their values stay saved) and the "Speaking voice" section shows a Voice
  picker (Buttery, Airy, Mellow, Glassy, Rounded), the speed, and Preview. The Claude tab lists
  Voice mode speaking among the features that use it. Login, language and config folder are the
  Claude STT ones.
  - Protocol, undocumented, read from the Claude desktop 45.2.1 bundle (search
    `text_to_speech/text_stream` in `/usr/lib/claude-desktop/resources/ion-dist.asar`); the header
    comment of `speech/providers/claude/tts.ts` has it. `wss://api.anthropic.com/api/ws/text_to_speech/text_stream`
    with the STT headers; query `output_format=pcm_24000`, `voice`, `tts_speed` (0.7 to 1.5, two
    decimals), `client_platform=cli`, `language`. Send `text_chunk` frames (text over 800 chars
    split at sentence ends, like the web client), then `close_stream`; `keep_alive` every 4 s.
    Binary frames are raw 16-bit mono PCM at 24 kHz, then `SpeechComplete`. Errors come as
    `SpeechError` / `error` frames or an HTTP status on the handshake.
  - `ClaudeTTS.synthesizeSpeech` resolves on the first audio frame and streams the rest as it
    arrives (`tts-manager` reads the stream incrementally); a later failure errors the stream.
    Handshake timeout 8 s, 20 s without any frame.
  - Persisted as `features.voiceMode.tts = { provider: "claude", voice, speed, model, speakerId }`;
    `model` and `speakerId` are the remembered local values. Speed is the existing `speed`
    field, shared with the local voice and clamped to 0.7 to 1.5 for Claude: the service refuses
    more (`query.tts_speed: Input should be less than or equal to 1.5`, tested 2026-11-13).
    Settings offers 0.85x to 2x for the local voice and stops at 1.5x with Claude
    (`CLAUDE_SPEED_VALUES` in `voice-settings-model.ts`). The voice is only kept on the Claude site.
    Env override: `PASEO_VOICE_TTS_PROVIDER`.
  - Preview reuses `speech.local.preview_voice.request`: with Claude speaking, `model` is read as
    the Claude voice, so there is no protocol change.
- **Core files touched:** protocol `speech-settings.ts` (optional `voiceTtsProvider`,
  `claudeTtsVoice`). Server: `persisted-config.ts` (`claude` TTS branch), `bootstrap.ts`
  (`buildMutableTtsProviderConfig`), `daemon-config-store.ts` (`mergeVoiceTtsPatch`),
  `speech/speech-runtime.ts` (`resolveVoiceTtsLabel`, preview), `speech/speech-settings-service.ts`
  (env name), `speech/providers/local/config.ts` (a Claude site keeps the local speaker/speed),
  `speech/providers/claude/{config,runtime}.ts`; new `speech/providers/claude/tts.ts`. App:
  `voice-settings-page.tsx`, `voice-settings-model.ts`, `claude-stt-section.tsx`,
  `claude-stt-model.ts` (`claudeFeatures`), `i18n/resources/custom-voice-settings.ts`; new
  `claude-tts-model.ts`.
- **Re-apply:** Add `claude` to the TTS persisted union, chain TTS creation in
  `initializeClaudeSpeechServices`, make `mergeVoiceTtsPatch` keep the provider on a model/speed
  edit and the model on a provider switch, and render the `SttProviderRow` for `voiceTtsProvider`
  above the speaking model.
- **Verify:** `cd packages/server && npx vitest run src/server/speech/providers/claude src/server/daemon-config-store.test.ts --bail=1`
  and `cd packages/app && npx vitest run src/screens/settings/voice/claude-stt-model.test.ts src/screens/settings/voice/claude-tts-model.test.ts --bail=1`
  (both in the update script). Needs a daemon restart. In Voice mode pick Speaking provider
  Claude, pick a voice, press Preview, then talk in voice mode and hear the answer.

## bruno-config-file: save and load every Bruno's Customizations setting as one JSON file

- **Added:** 2026-11-13
- **Commit:** `custom: save and load Bruno's Customizations as a JSON file`
- **Why:** Moving to a new machine or launcher profile meant re-entering every Bruno's
  Customizations setting by hand.
- **What:** Settings > Bruno's Customizations > Save and Load. Save downloads
  `paseo-bruno-config.json` with the app settings (chat links, chat options and order, desk preview
  tabs, skip pinned, Critic and Jev toggles), the desktop `flexibleTabMovement`, and the active
  host's `github.configDir`, `speech`, `features`, and the jev-router and delegation plugin
  settings. A switch, "Skip providers and API keys" (on by default, not persisted), applies to both
  Save and Load: it leaves out and ignores `host.github`, the speech providers and
  `claudeSttConfigDir`, the `features` stt/tts/llm/turnDetection blocks, and the Jev router
  `apiKey`, `apiUrl` and `jevModel`, so a file moves between hosts on different accounts (Load
  reports "Providers and API keys (kept this host's)"). With it off the file includes the
  TypeSafe API key. Plugin loads merge over the host's current values (shallow), so a file
  without `apiKey` keeps the host's key. Load asks to confirm, then applies each section
  on its own and shows an applied / skipped / failed report. Missing sections and keys stay as they
  are; a file with a newer `paseoBrunoConfig` version is refused. Plugins not installed on the host
  are skipped. Web and Electron only; native shows "Only on desktop and web."
- **Files:** New: `packages/app/src/bruno-config/` (`config-file.ts`, `config-file.test.ts`,
  `use-bruno-config-file.ts`), `screens/settings/bruno-customizations/config-file-page.tsx`.
- **Core files touched:** `packages/app/src/screens/settings-screen.tsx` (import, `FileJson`,
  `BRUNO_SECTION_ITEMS` entry, switch case), `packages/app/src/utils/host-routes.ts` (slug).
- **Re-apply:** Add the `customizations-config-file` slug to `SETTINGS_SECTION_SLUGS`, a
  `BRUNO_SECTION_ITEMS` entry and a switch case rendering `BrunoConfigFilePage`.
- **Verify:** Test `bruno-config/config-file.test.ts` (in the update script). In the app, Save,
  change a toggle, Load the file: the toggle returns and the report lists what was applied. With
  the switch on, Save and check the file has no `github`, provider or `apiKey`; set a different
  TypeSafe key on the host, Load: the key stays. Test also covers `stripAccountSettings` and
  `mergePluginValues`.
