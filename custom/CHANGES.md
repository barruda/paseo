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
  - The plugin's server side starts the bridge with system `node` on first use (the plugin process
    runs on Electron's Node, which can't load the bridge's node-pty) and stops it with the plugin.
    It listens on 127.0.0.1 and requires a token; the port and token are kept in
    `$PASEO_HOME/plugin-data/warp/bridge.json` so restored Warp tabs keep working after a restart.
  - The build uses Warp's `skip_login` feature, so it starts signed in as Warp's offline test user
    with no login screen. A second patch (`app/src/wasm_nux_dialog.rs`) hides the "Download Warp
    Desktop?" dialog in `remote_tty` builds.
  - Limits: zsh only (Warp's remote_tty bootstrap is zsh-only), no Warp account or Warp AI
    (app.warp.dev blocks the local origin with CORS, and `skip_login` fails every authenticated
    request on purpose).
- **Files:** `custom/plugins/warp/` and
  `packages/server/src/server/plugins/custom-warp-plugin.e2e.test.ts`.
- **Core files touched:** none.
- **Re-apply:** Nothing to redo in core. If the plugin SDK changes, the plugin uses
  `addWorkspacePanel`, `addCommandCenterItem`, `navigation.openBrowser`, and one RPC.
  To rebuild Warp after pulling it:
  `cd ~/projetos/warp-web-custom && script/wasm/bundle --channel oss --features remote_tty,skip_login`
  (needs Rust from `rust-toolchain.toml`, the `wasm32-unknown-unknown` target, `wasm-bindgen-cli`
  at the version in `Cargo.lock`, and `wasm-split` on PATH). Re-apply the
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

- **Added:** 2026-10-09 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: Copy full file path in the file tab menu`
- **Why:** Upstream's "Copy file path" copies the tab's path as stored, which is relative to the
  workspace for files opened from the explorer. Pasting a path into another tool or terminal needs
  the absolute one.
- **What:** File tabs get a first menu entry, **Copy full file path**, that copies the path
  resolved against the workspace root (`/home/bruno/uprojects/teste.html`). A path that is already
  absolute is copied as is. "Copy file path" is unchanged. Same menu on desktop and mobile. The
  label is English only.
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
- **Re-apply:** In the file-tab branch of `buildWorkspaceTabMenuEntries`, push an entry before
  "Copy file path" that calls `onCopyFilePath(path, "full")`. In the workspace screen's copy
  handler, when the mode is `"full"` and the path is relative, join it to `workspaceDirectory`.
  Widen every `onCopyFilePath` prop type the handler passes through. If upstream wraps the prop in
  a lambda somewhere on the way, forward the second argument there too.
- **Verify:** `(cd packages/app && npx vitest run src/screens/workspace/workspace-tab-menu.test.ts)`
  (the update script runs it). In the app, right-click a file tab, pick **Copy full file path**,
  and paste.

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

## workspace-rename-f2: F2 renames the active workspace

- **Added:** 2026-10-11 (based on upstream `7f9b65d46`)
- **Commit:** `custom: F2 renames the active workspace from anywhere`
- **Why:** Renaming meant the sidebar kebab or the command center.
- **What:** F2 opens the rename dialog for the active workspace from anywhere: message input,
  terminal, file views. Only the command center keeps F2 to itself. Holding the key doesn't
  repeat. Listed under Workspaces in Settings → Shortcuts ("Rename workspace"), where it can be
  rebound.
- **Core files touched** (each marked `CUSTOM(workspace-rename-f2)`):
  - `packages/app/src/keyboard/actions.ts`: `workspace.rename` added to `KeyboardActionId`.
  - `packages/app/src/keyboard/route-shortcut.ts`: maps it to the dispatcher's existing
    `workspace.rename` action (scope `workspace`). Test in `route-shortcut.test.ts`.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: the `workspace-rename-f2` binding and its
    `rename-workspace` help row after `pin-workspace`. Tests in `keyboard-shortcuts.test.ts`.
- **Re-apply:** Upstream already has the dispatcher action `workspace.rename` (used by the command
  center) and `WorkspaceRenameHost`, which handles it for the active workspace. Add the action to
  the shortcut action ids, route it to the dispatcher action, and bind F2 with
  `repeat: false` and `when: { commandCenter: false }` (no `terminal: false`, so it works in a
  terminal too).
- **Verify:** `(cd packages/app && npx vitest run src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts)`
  (the update script runs it). In the app, press F2 with focus in a message input, then in a
  terminal: the rename dialog opens for the active workspace.

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
  `always-listening/{controller,sidebar-toggle}` files. The base toggle renders nothing outside
  Electron.
- **Re-apply:** Place `WakeDictationSidebarToggle` below the desktop `SidebarNavRows` and before
  the workspace list. Its Electron implementation captures PCM with the existing dictation audio
  source, sends each energy-bounded utterance through `DictationStreamSender`, detects "wake up"
  and final "done" in transcription text, and copies with `copyToClipboard`. Keep the base
  component empty for browser and native builds.
- **Verify:** `cd packages/app && npx vitest run src/always-listening/controller.test.ts --bail=1`
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
- **Commit:** `custom: add cross-project Desks to task navigation`
- **Why:** Checking an agent should not replace the surrounding tabs. Group work by personal
  purpose while preserving the original workspace model as a toggleable fallback.
- **What:** Tasks mode hosts saved **Desks**. The selector beside the project/workspace context
  switches Desks and offers New Desk and Rename Desk. Editor and Git header actions follow the
  selected tab’s source workspace. A blue-outlined first slot previews task
  selections; middle-click or Keep tab retains a tab. Each reference keeps its source host and
  workspace. The close button and middle-click on a tab close its reference without archiving a
  session; both protect tabs with unsaved changes. The + menu uses the standard workspace
  launcher, scoped to the selected tab’s project.
  Tab names stay on one line with a 15-character limit (including ellipsis), followed by the project
  icon; task rows also show project icons. Activity and recent-open ordering preserve existing
  sibling positions until timestamps differ by at least one minute; attention groups still update
  immediately. Shift+Tab cycles Desks; tab navigation and closing use Desk tabs.
  Search and checked project selection share a sidebar row, with Select all/none. Sorting offers
  attention, last activity, recently opened, and title. New workspace and Browse workspaces rows
  are removed from the Tasks sidebar. The top-bar Tasks switch restores the original layout.
- **Files:** `packages/app/src/task-navigation/` owns Desk persistence, rendering, task projection,
  and the navigation bridge. Desk state is local to this app installation, separately persisted
  from workspace layouts. Source workspaces retain their session and filesystem ownership.
- **Core files touched:** The host workspace route chooses DeskScreen in Tasks mode. The existing
  workspace target storage schema is exported for validation. The navigation store and explicit
  tab preparation bridge existing launchers into Desks. Supporting Changes/PR opens honor Desks.
  Header shortcut hints label Desk cycling and omit the unavailable bottom-panel hint.
  `workspace-new-tab-menu.tsx` accepts additional items so Desks can retain Files.
- **Re-apply:** Keep the original WorkspaceDeck branch intact. Insert DeskScreen only at the host
  workspace content boundary, after route/open-intent handling. Supply each panel its original
  server/workspace identity and unique reference tab ID. Use the shared panel, focus, retained
  content, timeline visibility, and floating-panel contracts. Never move sessions or replace
  their workspace layouts to implement a Desk. Keep panel-state updates attached to their Desk
  even while a different Desk is selected. Preserve the existing Tasks toggle storage key. Reuse
  `WorkspaceNewTabMenuContent` through the Desk launcher and resolve project icons outside the
  sidebar-only context. Keep prior sibling order across task updates; only cross a neighbor when
  its timestamp is at least 60 seconds older (or its attention priority is lower).
- **Verify:** Run the task-navigation model/store suites and the desktop task-navigation browser
  test already registered in the update script. The browser test covers previews, retained tabs,
  composer drafts, Desk creation/restoration, cycling, Files/agent/terminal creation, project icons,
  truncated labels, project filters, sort persistence, and switching back to the workspace layout. Run typecheck/lint, build desktop,
  then install into a new build folder. Do not restart the user's daemons.

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
  In an empty draft, Up cycles projects on the current host that already have a workspace, and
  Left cycles available favorite models in favorites order (no favorites means no change). Drafts show the project icon beside their controls. Settings →
  Shortcuts has a **When in tasks mode** section with all five configurable bindings, including Ctrl+N to open New Desk. Tasks mode
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
