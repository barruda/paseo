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

## model-picker: Shift+Tab picks the model and effort from the keyboard

- **Added:** 2026-10-08 (based on upstream 0.11.0-beta.2, `b5b43edd6`)
- **Commit:** `custom: Shift+Tab model and effort picker`
- **Why:** Changing model or effort meant reaching for the composer's dropdowns, or opening the
  command center and typing "model". The model dropdown also searches one provider at a time.
- **What:**
  - Shift+Tab in an agent's message input (or a new-agent draft) opens a centered picker shaped like
    the command center.
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
  - Shift+Tab used to cycle the agent mode. That shortcut is now unbound; assign it a key in
    Settings → Shortcuts ("Cycle agent mode") to get it back.
- **Files:** `packages/app/src/model-picker/` (`model.ts` list/effort/favorite logic with
  `model.test.ts`, `store.ts`, `favorites-store.ts`, `use-model-picker-source.ts`,
  `model-picker.tsx`). New files; no conflict risk.
- **Core files touched** (each marked `CUSTOM(model-picker)`):
  - `packages/app/src/keyboard/actions.ts`, `keyboard-action-dispatcher.ts`, `route-shortcut.ts`:
    the `model-picker` message-input kind and its `message-input.model-picker` action.
  - `packages/app/src/keyboard/keyboard-shortcuts.ts`: the mode-cycle binding's combo is `""`, a new
    `message-input-model-picker-shift-tab` binding, and its help row in the agent-input order.
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
  bind Shift+Tab to it in the message-input focus scope, and set the mode-cycle binding's combo to
  `""` (keep its id so saved overrides survive). Copy each model's thinking options onto the
  provider selector rows. Call `useModelPickerSource` from the running agent's command-center
  registration (same source id, enabled flag, and controls) and from the draft agent controls (an
  `AgentControlCommandCenterSource` built from its props, enabled while it is the active composer).
  Mount `<ModelPicker />` in the root layout.
- **Verify:** `(cd packages/app && npx vitest run src/model-picker/model.test.ts src/keyboard/keyboard-shortcuts.test.ts src/keyboard/route-shortcut.test.ts)`
  (the update script runs it). In the app, focus a message input (New Workspace screen and a running
  agent), press Shift+Tab, type part of a model name, press → and Enter, and check the composer's
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
