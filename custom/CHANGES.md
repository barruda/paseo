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
- **Files:** `packages/app/src/file-pane/html-preview-assets.ts` (path rules, loader, bridge),
  `html-preview-assets.test.ts`, `html-preview-assets.browser.test.ts`. New files; no conflict
  risk.
- **Core files touched** (each marked `CUSTOM(html-preview-assets)`):
  - `packages/app/src/file-pane/html-preview-csp.ts`: `withPreviewCsp` takes a second
    `headMarkup` argument inserted after the policy meta.
  - `packages/app/src/file-pane/html-preview.web.tsx`: iframe ref, injects the bridge, answers
    asset requests from its own frame. `html-preview.tsx` (native) accepts and ignores `loadAsset`.
  - `packages/app/src/file-pane/pane.tsx`: `FilePane` builds the loader from `client` and
    `readTarget`; `htmlAssetLoader` is threaded through `FilePanePresentation`,
    `EditableFilePane`, and `FilePreviewBody` to `FileHtmlPreview`.
  - `SECURITY.md`: the HTML preview section says which files the preview can read.
- **Re-apply:** Wherever the web preview builds its srcdoc, append `PREVIEW_ASSET_BRIDGE_SCRIPT`
  right after the CSP meta, listen for `message` events whose `source` is the frame's
  `contentWindow`, and answer `parsePreviewAssetRequest` hits with `respondToPreviewAssetRequest`
  using a loader from `createPreviewAssetLoader({ client, cwd, htmlPath })` for the previewed file.
- **Verify:** `(cd packages/app && npx vitest run src/file-pane/html-preview-assets.test.ts)` and
  `(cd packages/app && npx vitest run --project browser src/file-pane/html-preview-assets.browser.test.ts)`
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
  - `packages/app/src/components/message.tsx`: `AssistantMarkdownImage` puts `CHAT_IMAGE_DATASET`
    on the frame in all three states (failed, loading, loaded), so the strip can find the n-th
    image of a message in the DOM.
- **Re-apply:** In the agent stream view, collect images with
  `collectChatImages([...tail items, ...head items])`, keep a `createActivePromptPublisher()` fed
  with the timeline seq of the row at the top of the viewport (wherever the chat outline gets its
  reading position), and render `ChatImagesRail` next to the outline rail with the viewport ref,
  visible message ids, and the history window's reveal function. In the assistant markdown image
  component, add `dataSet={CHAT_IMAGE_DATASET}` to the outermost view of every state.
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
- **Files:** `packages/app/src/file-pane/html-preview-keys.ts` (bridge script, message parser,
  replay) and `html-preview-keys.browser.test.ts`. New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(html-preview-keys)`):
  - `packages/app/src/file-pane/html-preview.web.tsx`: prepends `PREVIEW_KEY_BRIDGE_SCRIPT` to the
    head markup passed to `withPreviewCsp`, and a `message` listener that replays parsed keys.
  - `SECURITY.md`: the HTML preview section says the page can trigger app shortcuts.
- **Re-apply:** Wherever the web preview builds its srcdoc, add `PREVIEW_KEY_BRIDGE_SCRIPT` after
  the CSP meta (it needs inline script, which the preview CSP allows). Listen for `message` events
  whose `source` is the frame's `contentWindow` and call `replayPreviewKey(frame, key)` for each
  `parsePreviewKey` hit. The replay only has to reach a window-level `keydown` capture listener.
- **Verify:** `(cd packages/app && npx vitest run --project browser src/file-pane/html-preview-keys.browser.test.ts)`
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
  `custom/plugins/beautiful-chat/**` except `client/expand-memory*.ts`, so the pre-commit hook
  passes on the vendored code and still checks ours. JSON has no comments, so no `CUSTOM(` marker.
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

## workboard: Workboard as a tab, and images in task descriptions

- **Added:** 2026-10-10 (based on upstream 0.11.2; plugin vendored from
  [fxbing/paseo-workboard](https://github.com/fxbing/paseo-workboard) `e8cba65`, release 0.2.0)
- **Commit:** `custom: Workboard opens as a tab and takes pasted images`
- **Why:** The board only opened as a full-screen sidebar screen, which hides the workspace you're
  in. Task descriptions were plain text, with no way to keep a screenshot with a task.
- **What:**
  - **Tab:** Workboard is also a workspace panel. Open it from the "+" new-tab menu or with
    "Open Workboard tab" in the Command Center. The tab shows the whole board, like the sidebar
    screen, which stays.
  - **Images:** In the task editor (new or edit), pasting an image into the description uploads it
    to the daemon, saved under `$PASEO_HOME/plugin-data/paseo-workboard/images/`. The description
    gets `![image](<absolute path>)` at the cursor, so the text stays readable and an agent given
    the description can open the file. Thumbnails show under the field: press one to enlarge it,
    × removes its reference. PNG, JPEG, GIF, and WebP up to 10 MB; the file type comes from the
    bytes. Save waits for uploads. Web and desktop only: native text fields never receive pasted
    images. Removing a reference leaves the file on disk.
  - The read RPC serves only files directly inside that image folder, so a description can't make
    it read anything else.
- **Files:** `custom/plugins/workboard/`, a copy of upstream without `docs/`, `images/`,
  `scripts/`, `.github/`, and the integration fixture. Ours, marked `CUSTOM(workboard-tab)` or
  `CUSTOM(workboard-images)`: `shared/images.ts`, `server/images.ts`, `client/image-paste.ts`,
  `client/DescriptionImages.tsx`, `tests/images.test.ts`, and additions in `index.client.tsx`
  (panel and command), `index.server.ts` (RPC handlers), `shared/rpc.ts` (two RPCs),
  `client/strings.ts` (labels), and `client/WorkboardScreen.tsx` (`TaskModal`).
- **Core files touched:** `.oxlintrc.json` and `.oxfmtrc.json` skip `custom/plugins/workboard/**`.
  The plugin keeps upstream's style (Prettier, 80 columns) and is checked with its own `tsc`,
  `vitest`, and `prettier` instead. `lefthook.yml` (marked `CUSTOM(vendored-plugins)`) passes
  `--no-error-on-unmatched-pattern` to lint and format, so a commit that stages only ignored files
  still passes the hook. JSON has no comments; on conflict, re-add the patterns and the flag.
- **Re-apply:** To take a newer upstream, copy its files over the plugin folder, keeping ours. Then
  redo the additions: register the panel and command in `index.client.tsx`; handle
  `saveImageRpc`/`readImageRpc` with an `ImageStore` in `index.server.ts`; in `TaskModal`, pass
  `useImagePaste`'s ref to the description `TextInput`, render `DescriptionImages` under it with
  the paste hint, and disable Save while uploads run. Keep the plugin id `paseo-workboard`: the
  plugin calls its own RPCs by that id.
- **Setup:** One-time plugin install per daemon. **Don't `plugin remove` the registry copy
  without saving the board first:** removing a plugin deletes `$PASEO_HOME/plugin-settings/<id>/`,
  which holds the board. Disable it, copy that folder aside, remove, copy it back, then install.
  The 2026-10-10 copies are in `$PASEO_HOME/plugin-settings.bak-workboard-20261010/`.
- **Verify:** `(cd custom/plugins/workboard && npx tsc --noEmit && npx vitest run)` (the update
  script runs it). In the app, open a workspace, pick Workboard from "+", edit a task, and paste a
  screenshot into the description.

## done-task-archive: one-click archive for done tasks in the sidebar

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: archive button under the kebab for done tasks`
- **Why:** Workspaces whose Workboard task is done pile up in the sidebar. Archiving each through
  the kebab menu takes two clicks and a precise aim.
- **What:** A sidebar workspace row with the `task:done` label shows an archive icon under its
  kebab, wherever the kebab shows (hover on desktop, always on touch). Pressing it runs the row's
  normal archive action, with the same worktree warning. A renamed Done label in Workboard isn't
  picked up; the label is a constant in `done-task-archive.ts`.
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
  chat, Up selects the latest sent message and scrolls it into view; Enter opens its existing
  rewind menu. Escape or typing clears selection. Modified keys and autocomplete retain priority.
  Web and desktop placeholders show the appropriate hints, translated in every supported locale.
- **Core files touched:** `screens/new-workspace-screen.tsx`, `composer/index.tsx`,
  `composer/input/input.tsx`, `agent-stream/view.tsx`, `components/message.tsx`,
  `components/rewind/rewind-menu.tsx`, and `i18n/resources/*.ts` under `packages/app/src/`.
- **Re-apply:** Forward an optional key callback through Composer after autocomplete. New
  Workspace uses the existing project selection callback. Running chat composers select from
  stream tail/head through `composer/empty-shortcuts.ts`; the transcript observes that selection
  to scroll, highlight the message, and open RewindMenu on Enter. Keep IME and modified keys out
  of the shortcut path. Add translated placeholder hints and the focused test to the update script.
- **Verify:** `cd packages/app && npx vitest run src/composer/empty-shortcuts.test.ts --bail=1`.
  In desktop, cycle past the first project with an empty prompt; type text and verify Left edits
  normally. In an ongoing chat, press Up then Enter and verify rewind options appear without
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
- **What:** With GPU selected (Settings > Voice and dictation, stored as
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
  Both are in the update script. In the app, open Settings > host > Voice and dictation: the
  status fills in; switch a model and the status shows the download or the new model loaded
  after the next use; Preview plays the selected voice.

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
  finished responses; **In progress** and **Idle** show the rest. Managed children stay under
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
- **What:** Tasks mode hosts saved **Desks**. The header shows the focused tab's project (icon and
  name), then one chip per Desk and a **+** for New Desk. Clicking a chip switches to it;
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
  workspace and Down to the next one (both wrap), and Left cycles available favorite models in favorites order (no favorites means no change). Drafts show the project icon beside their controls. Settings →
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
- **Core files touched:** `file-pane/html-preview-navigation.ts`, `html-preview-assets.ts`,
  `html-preview.web.tsx`, `html-preview.tsx`, `pane.tsx`, `panels/file-panel.tsx`, and `SECURITY.md`.
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
- **Why:** After selecting text in the chat with the mouse, typing again needed a click back
  into the composer.
- **What:** On web and desktop, Esc with a non-empty text selection inside an agent's chat timeline
  clears the selection and focuses that agent's composer. It does nothing when focus is in an
  input, a menu, or a dialog, when the key has a modifier, or when a shortcut already handled Esc
  with `preventDefault`. Esc's other jobs still run on the same press: if Interrupt agent is bound
  to Esc and the agent is running, that Esc also interrupts it. Native has no mouse selection and
  renders the plain surface.
- **Files:** `packages/app/src/chat-esc-focus/`: `model.ts` (pure Esc rules), `registry.ts`
  (composers register their focus function per server and agent), `surface.web.tsx` (window
  keydown listener, bubble phase), `surface.tsx` (native passthrough), `types.ts`. No conflict risk.
- **Core files touched:** `agent-stream/view.tsx` renders `ChatEscFocusSurface` in place of
  `AssistantSelectionCopySurface` (it wraps that surface, so JSX depth stays the same);
  `composer/index.tsx` calls `useRegisterChatComposerFocus(serverId, agentId,
focusMessageInputForKeyboardAction)`.
- **Re-apply:** Wrap the chat timeline's selection-copy surface in a DOM element the Esc listener
  can test the selection against, and keep `enabled={!readOnly}`. In the composer, register the
  same focus function the `message-input.focus` keyboard action uses, keyed by server and agent.
  Leave the global shortcut handler and the `agent.interrupt` binding untouched.
- **Verify:** `(cd packages/app && npx vitest run src/chat-esc-focus/model.test.ts)` (the update
  script runs it). In the app, select a word in an agent reply, press Esc: the selection clears
  and the caret is in that agent's composer.

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
  - Idle limit: under **Attention first**, the Idle group opens on the 5 newest tasks that changed
    in the last 30 minutes. The toggle row below it (the workspace sidebar's toggle, with a label
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
  must skip `git add` but stay in the commit pathspecs. In the app, gate on
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
  it sends `TLDR` to the agent as a normal message (`paseo.agents.ref(id).send`), so the agent
  answers in the chat with its full context. While a turn runs, it behaves like any message sent
  then.
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
  - The summary is in daemon memory: a daemon restart or an agent reload clears it until the next
    turn.
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
- **Commit:** `custom: Commit: wip pill beside the diff stat`
- **Why:** Saving work in progress was typing the same `!git add . && git commit -m 'wip'` again
  and again.
- **What:** Right of the composer's diff stat pill (`+255 -18`), a **Commit: wip** pill runs
  `git add . && git commit -m 'wip'` in the agent's directory, as if typed after `!`
  ([shell-command](#shell-command-run-command-from-the-chat)): the output shows in a Terminal card,
  the command enters the `!` history, and the agent never sees it. The pill always shows, with or
  without changes: gating it on the diff stat hid it at times while there were changes, and with
  nothing to commit git says so in the card. Without the shell-command plugin on the daemon, a
  press shows an error toast. Commits with no confirmation.
- **Core files touched** (marked `CUSTOM(commit-wip)`):
  - `packages/app/src/composer/commit-wip-pill.tsx`: the pill. New file.
  - `packages/app/src/panels/agent-tracks.tsx`: renders it after `WorkspaceDiffStatPill`, and
    `hasAgentTracks` returns true so the track row (and its clearance in `agent-panel.tsx`) always
    shows.
  - `packages/app/src/chat-code-run/context.tsx`: the `!<command>` runner moved out of
    `ChatCodeRunProvider` into `useRunChatCommand`, which both use.
- **Re-apply:** In the composer track bar, after the workspace diff stat pill, render a pill that
  always shows (make the track row's "has tracks" check true) and, on press, runs the command
  through the plugin client slash command `sh` (resolve `!<command>` with
  `resolvePluginClientSlashCommand`, run it with `executePluginClientSlashCommand`).
- **Verify:** Typecheck. In the app, **Commit: wip** shows under every agent's composer. Edit a
  file and press it: a Terminal card shows the commit and the diff stat pill goes away; the button
  stays.

## task-pins: pinned sessions under the Tasks filters

- **Added:** 2026-10-20
- **Commit:** `custom: pinned sessions under the Tasks filters`
- **Why:** A few sessions the user keeps going back to drift around the Tasks sidebar as their state
  changes. Pinning keeps them in one place.
- **What:** Right-clicking a task, or an agent tab, offers **Pin**; a pinned one offers **Unpin**
  (archived sessions offer neither). Pinned sessions show right under the filter buttons, in pin order, with no
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
  content a component so closed menus don't subscribe to projects or icons.
- **Verify:** `(cd packages/app && npx vitest run src/new-agent-projects/model.test.ts)` and the
  "New agent flyout" test in desktop `e2e/task-navigation.spec.ts` (both in the update script). In
  the app, open **+**, hover **Agent**, click another project: a new agent tab opens with that
  project's icon in the composer.

## session-auto-rename: the status summary names the session

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: the status summary renames the session`
- **Why:** A session's tab title is the first line of its first message, which rarely says what
  the session turned out to be about. The status summary under the composer already knows.
- **What:**
  - The [agent-status-summary](#agent-status-summary-what-each-agent-was-asked-and-where-it-stands-under-the-composer)
    call also asks Haiku for a `title` of at most 4 words (clamped in code like
    [title-max-four-words](#title-max-four-words-agent-and-workspace-titles-stay-at-four-words)).
    Same call, no extra cost beyond a few tokens.
  - From the third user message on, the daemon renames the session to that title, once. It only
    replaces a title still equal to the provisional title derived from the first message, so a
    rename by hand (or an explicit title from the CLI/MCP) is kept, and the session is not renamed
    again after the first time, daemon restarts included.
  - A **Rename session** pill right of **Commit: wip** renames the session to the current summary
    title at any time (falling back to the topic for older summaries). With no summary yet, it
    shows an error toast.
- **Core files touched** (marked `CUSTOM(session-auto-rename)`):
  - Protocol `messages.ts`: optional `title` on `AgentStatusSummaryPayloadSchema`.
  - Server `agent-status-summary.ts`: the `title` field in the prompt and reply, and
    `maybeAutoRename`; `bootstrap.ts` passes `agentStorage` to `AgentStatusSummaries`.
  - App `composer/rename-session-pill.tsx` (new) and `panels/agent-tracks.tsx` (renders it after
    `CommitWipPill`).
- **Re-apply:** Depends on agent-status-summary and commit-wip. Add `title` to the summary prompt,
  schema and payload. After storing a summary, when the timeline has 3+ user messages and the
  stored title is empty or equals `resolveCreateAgentTitles({ initialPrompt: firstUserMessage })`,
  call `agentManager.setTitle`. In the app, a pill after Commit: wip calls
  `client.updateAgent(agentId, { name: summary.title })`.
- **Verify:** `(cd packages/server && npx vitest run src/server/agent-status-summary.test.ts)`
  (already in the update script) covers the rename, the wait for the third message and the kept
  manual title. In the app, send a fresh agent three messages: a few seconds after the third its
  tab title changes to a 4-word name. Rename it by hand and press **Rename session**: it goes back
  to the summary's title.

## draft-worktree: a new session in Tasks mode can start in a new worktree

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: new sessions pick Local or a new worktree in Tasks mode`
- **Why:** Tasks mode treats a session as the unit of work, with no New workspace step, so there
  was no way to start a session isolated in its own worktree.
- **What:** In Tasks mode, an empty session in a git project shows **Local** / **New worktree**
  in the middle of the chat area, with a **Worktree name** field and a **from** branch field
  below. Local is the default. Typing in either field picks New worktree without a click; Enter
  moves to the message box. The hint line says what will happen ("Starts in a new worktree on
  teste-novo, from custom.").
  On send, a new worktree session creates the worktree, its workspace and the agent in one
  `createWorkspace` request (as New workspace does) and the Desk tab moves to the new workspace.
  - A typed name is slugged (`Login Fix` → `login-fix`) and used for both the worktree folder and
    the branch, and the daemon keeps it.
  - A blank name gets a random folder slug, and the daemon renames the branch from the first
    message, the same as upstream worktrees.
  - **from** shows the branch the draft's checkout is on (`gitRuntime.currentBranch`) and is
    sent as the worktree's `refName`, so it branches off that branch, not the repository's
    default branch. Edit it to start from another branch. When the checkout's branch is unknown
    and the field is untouched, the daemon uses the default branch.
  - Where the worktree folder goes is
    [project-worktrees-root](#project-worktrees-root-worktrees-go-in-a-worktrees-folder-beside-the-project).
  - The choice lives in app memory per draft: it survives switching tabs, not a reload.
  - Workspace mode is unchanged; it keeps the New workspace screen.
- **Files:** `packages/app/src/draft-worktree/` (`model.ts` store and naming, `picker.tsx`,
  `create.ts`), with `model.test.ts`.
- **Core files touched** (marked `CUSTOM(draft-worktree)`):
  - `packages/app/src/composer/draft/workspace-tab.tsx`: renders the picker in the empty draft
    area (the scroll content and config section grow so it can center), and
    `submitDraftCreateRequest` calls `createDraftAgentInWorktree` when a worktree is picked.
  - `packages/app/src/panels/agent-panel.tsx`: `DraftPanel`'s `handleCreated` moves the Desk tab
    to the agent's new workspace instead of retargeting it in the old one.
  - `packages/server/src/server/paseo-worktree-service.ts`: a worktree created with an explicit
    `branchName` is not marked for the first-agent branch auto-name. This also applies to other
    callers that pass a branch name (CLI `--new-branch`, MCP).
- **Re-apply:** In the draft agent tab, when Tasks mode is on, the host supports workspace
  multiplicity and the workspace's project is git, show a Local / New worktree choice. On submit
  with a worktree, call `client.createWorkspace` with a `worktree` source (`cwd` = the draft's
  workspace directory, `projectId`, `worktreeSlug`, `branchName` only when typed, and `refName`
  = the from branch, defaulting to the workspace's current branch) plus the
  agent options the draft would send to `createAgent`, then accept the workspace snapshot. When
  the created agent's `workspaceId` differs from the tab's, update the Desk tab's owner and target
  together. In the daemon, skip `writePaseoWorktreeFirstAgentBranchAutoNameMetadata` when the
  input had a `branchName`.
- **Verify:** `(cd packages/app && npx vitest run src/draft-worktree/model.test.ts)` and
  `(cd packages/server && npx vitest run src/server/paseo-worktree-service.test.ts)` (both in the
  update script). In the app, Tasks mode, open a new Agent tab in a git project: type `Login Fix`
  in the name field (from shows the checkout's branch) and send. The tab becomes the agent, its header offers **Archive workspace**,
  and `git worktree list` shows a `login-fix` worktree on branch `login-fix`. Repeat with **New
  worktree** and no name: the branch gets a name from the message.

## project-worktrees-root: worktrees go in a worktrees folder beside the project

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: worktrees go in a worktrees folder beside the project`
- **Why:** Worktrees under `~/.paseo/worktrees/<hash>/` are hard to find and open from a file
  manager or editor. One `worktrees` folder per projects folder keeps them next to the projects,
  and the project name in the folder name tells them apart.
- **What:** Paseo creates a project's new worktrees in `<parent>/worktrees/<project>-<slug>`,
  creating `<parent>/worktrees` on the first one: `~/projetos/paseo` gets
  `~/projetos/worktrees/paseo-teste-novo`, `/mnt/linux-adicional2/pipeline` gets
  `/mnt/linux-adicional2/worktrees/pipeline-<slug>`. The branch name stays the plain slug. A
  `worktrees.root` in the daemon config still wins, and a repo at the filesystem root (`/foo`)
  keeps `$PASEO_HOME/worktrees/<hash>/<slug>`. Paseo treats worktrees beside the project as its
  own: archiving removes them, and they carry the same metadata (base branch, first-message branch
  name).
  - Worktrees made earlier under `$PASEO_HOME/worktrees/<hash>/` stay where they are and stay listed.
  - A slug that already starts with `<project>-` (read back from a folder name, as workspace
    recovery does) is not prefixed again.
- **Files:** `packages/server/src/utils/project-worktrees-root.ts` (the root, the folder name and
  the ownership match), with `project-worktrees-root.test.ts`.
- **Core files touched** (marked `CUSTOM(project-worktrees-root)`):
  - `packages/server/src/utils/worktree.ts`: `getPaseoWorktreesRoot` returns `<parent>/worktrees`
    when no root is configured; `computeWorktreePath` adds the `<project>-` prefix, and
    `createWorktree` and `deletePaseoWorktree` (slug only) go through it instead of joining the root
    and the slug; `isPaseoOwnedWorktreeCwd` also owns the sibling shape; `listPaseoWorktrees` lists
    both roots.
  - `packages/server/src/server/worktree/commands.ts`: `resolveWorktreeSlugPath` uses
    `computeWorktreePath`.
  - `packages/server/src/utils/checkout-git.ts`: `isPaseoWorktreePath` also matches the sibling
    shape.
  - Upstream tests that expected the slug as the folder name or a path under `paseo-home`:
    `worktree.posix.test.ts` (3), `paseo-worktree-service.test.ts` (suffixed slug),
    `worktree-session.test.ts` (branch-name slug fallback).
- **Re-apply:** Every place that turns a slug into a path must go through `computeWorktreePath`,
  which returns `<dirname(repo)>/worktrees/<basename(repo)>-<slug>` when no worktrees root is
  configured. `getPaseoWorktreesRoot` returns `<dirname(repo)>/worktrees` in that case. In the
  ownership check, accept `<parent>/worktrees/<project>-<slug>[/...]` when `<parent>/<project>` is
  the worktree's repository (or, when git no longer knows the worktree, any git checkout at
  `<parent>/<prefix>` for a `-`-separated prefix of the folder name). `rg "join\(.*Root.*[Ss]lug"
packages/server/src` finds new upstream sites that join a root and a slug.
- **Verify:** `(cd packages/server && npx vitest run src/utils/project-worktrees-root.test.ts
src/server/paseo-worktree-service.test.ts src/utils/worktree.posix.test.ts)` (the first two are in
  the update script). In the app, start a new worktree session in any project: `git worktree list`
  shows it as `<parent>/worktrees/<project>-<slug>`. Archive its workspace: the folder goes away.

## worktree-pill: a "Worktree: <branch>" pill that copies the path or merges back

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: Worktree pill copies the path or merges back`
- **Why:** With sessions starting in worktrees ([draft-worktree](#draft-worktree-a-new-session-in-tasks-mode-can-start-in-a-new-worktree)),
  nothing under the composer said the agent was in one, and bringing the work home meant
  committing in the worktree, `cd` to the main checkout and `git merge <branch>` by hand.
- **What:** When the agent's workspace is a worktree (`workspaceKind === "worktree"`), a
  **Worktree: &lt;branch&gt;** pill shows right of **Commit: wip**. The branch comes from
  `gitRuntime.currentBranch`, falling back to the workspace name. Pressing it opens a menu:
  - **Copy worktree full path** copies the workspace directory.
  - **Merge back to main project** runs, as a `!<command>`
    ([shell-command](#shell-command-run-command-from-the-chat)), `git add -A`, a `wip` commit when
    something is staged, then `cd` to the main checkout and `git merge --no-edit <branch>`. The main
    checkout is the parent of `git rev-parse --git-common-dir`, so it also works for worktrees
    Paseo did not create. A conflict or a dirty main checkout stops the merge, and git says so in
    the Terminal card. No confirmation.
- **Files:** `packages/app/src/composer/worktree-pill.tsx` (the pill and menu),
  `packages/app/src/composer/worktree-pill-model.ts` (the command and label), with
  `worktree-pill-model.test.ts` (runs the command against a real repo and worktree).
- **Core files touched** (marked `CUSTOM(worktree-pill)`):
  - `packages/app/src/panels/agent-tracks.tsx`: renders `WorktreePill` after `CommitWipPill`.
- **Re-apply:** In the composer track bar, after the Commit: wip pill, render a dropdown menu pill
  that shows only for `workspaceKind === "worktree"` workspaces. One item copies
  `workspace.workspaceDirectory` with `expo-clipboard`; the other runs `MERGE_WORKTREE_COMMAND`
  through `useRunChatCommand`.
- **Verify:** `(cd packages/app && npx vitest run src/composer/worktree-pill-model.test.ts)` (in
  the update script). In the app, open an agent in a worktree workspace: the pill reads
  `Worktree: <branch>`; an agent in a normal checkout has no pill. Copy the path and paste it. Edit
  a file and pick **Merge back to main project**: the Terminal card shows the `wip` commit and the
  merge, and `git log` in the main checkout has it.

## project-settings-remove: Remove project from the project settings page

- **Added:** 2026-10-21 (based on upstream 0.11.2, `0d61cca50`)
- **Commit:** `custom: Remove project from the project settings page`
- **Why:** Upstream only offers **Remove project** from the project row's menu in the Projects
  sidebar. Tasks mode lists sessions, not projects, so there was no way to remove one from the UI.
- **What:** Settings → Projects → (a project) ends with a **Danger zone** section holding a
  **Remove** button. It asks for confirmation, then runs the same removal as the sidebar menu:
  archives the project's workspaces and drops the project on each host it lives on. Files on disk
  are not touched. When it succeeds the page goes back to the project list. A host without the
  `projectRemove` feature gets the upstream "Update the host to remove projects." toast.
- **Files:** `packages/app/src/projects/remove-project-section.tsx`, with
  `remove-project-section.test.tsx`.
- **Core files touched** (marked `CUSTOM(project-settings-remove)`):
  - `packages/app/src/screens/project-settings-screen.tsx`: renders `RemoveProjectSection` after
    the config form in `ProjectSettingsBody`, with `onRemoved={onBackToProjects}`.
- **Re-apply:** At the bottom of the project settings body (outside the config form, so it still
  shows when `paseo.json` fails to load or the folder is gone), render `RemoveProjectSection` with
  the project summary and its name. It reuses `getCurrentProjectRemoveReadiness` and
  `removeProjectFromHosts` from `packages/app/src/projects/project-remove.ts` and the
  `sidebar.project.*` strings, the same pieces the sidebar's `handleRemoveProject` uses.
- **Verify:** `(cd packages/app && npx vitest run src/projects/remove-project-section.test.tsx)`
  (in the update script). In the app, open Settings → Projects → a throwaway project, press
  **Remove** and confirm: the page goes back to the list, the project is gone from it and from the
  - menu's project list, and its folder is still on disk.
