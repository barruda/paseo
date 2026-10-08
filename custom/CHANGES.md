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
