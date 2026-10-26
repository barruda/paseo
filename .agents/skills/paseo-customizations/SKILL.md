---
name: paseo-customizations
description: Maintain the user's customized Paseo build — the `custom` branch rebased on upstream getpaseo/paseo. Use when asked to add a feature or change to their Paseo, update/pull upstream Paseo, rebuild or install the desktop app, resolve a conflict after an update, or set Paseo up on a new machine.
user-invocable: true
---

# Paseo customizations

This checkout is upstream Paseo plus the user's own changes, kept as `custom:` commits on the
`custom` branch. Read `custom/README.md` for the workflow, then `custom/CHANGES.md` for what each
existing customization does. Those two files are the source of truth; this skill only lists the
rules agents get wrong.

## Rules

- Work on `custom`. Never commit customizations to `main`.
- Remotes: `origin` is upstream (fetch only), `fork` is the user's backup (barruda/paseo). Both use
  the `github.com-personal` SSH alias; never switch them to plain `github.com`, which authenticates
  as the work account.
- Prefer a plugin in `custom/plugins/<id>/` over editing core files (`docs/plugins.md`). A core edit
  stays small and carries a `// CUSTOM(<name>): <why>` comment.
- Commit with a `custom: <what>` subject. A follow-up change to a customization is its own commit;
  never use `git commit --fixup` or `git rebase --autosquash` unless the user asks.
- Stage files by name. Never `git commit -a` or `git add -A`: `package-lock.json` carries npm noise
  that must not be committed.
- Every customization gets a `custom/CHANGES.md` entry with: Added, Commit, Why, What, Core files
  touched, Re-apply, Verify. Write **Re-apply** so someone can redo the change by hand when upstream
  moves the surrounding code.
- Add tests, and add them to the "Running customization tests" step of
  `custom/update-paseo-source-and-apply-customization.sh`.
- Run `npm run typecheck`, `npm run lint -- <files>`, and `npm run format:files -- <files>` before
  committing, per the repo's `CLAUDE.md`.
- After committing, back up with `git push --force-with-lease fork custom`.
- Any Warp change (`custom/plugins/warp/`, the Warp browser tab options or keyboard routing, or
  `~/projetos/warp-web-custom`) updates `docs/custom-warp-web-embedded.md` in the same task.

## Shipping a change to the user's running Paseo

- Plugin-only change: no rebuild. Reload it on each daemon:
  `npx tsx packages/cli/src/index.js plugin reload <id> --home ~/.paseo` (and `~/.paseo-telus`).
- New plugin: it must be installed on each daemon once. See "One-time setup: plugins" in
  `custom/README.md`. Plugins run unsandboxed, so ask before enabling `pluginsEnabled` on a daemon.
- Build from this checkout as it is, including other agents' uncommitted work in the tree; the
  user prefers that over a clean worktree or waiting. Mention in your report which uncommitted
  files went into the build.
- Core change: `npm run build:desktop -- --linux dir` (only the folder the install copies; the
  full build fails at rpm on Ubuntu), then
  `custom/update-paseo-source-and-apply-customization.sh --install-only`. Then run
  `custom/reopen-paseo-clients.sh` yourself, without asking: it closes each Paseo window and
  reopens it from its launcher (so it keeps its dock slot), `paseo-telus` included. `paseo-personal`
  keeps its daemon and agents running; `paseo-telus` has `keepRunningAfterQuit` off, so its daemon
  restarts with the window and its running agents stop. The user asked for that; say in your
  report that the telus daemon restarted. For daemon-side changes that is not enough: with an unchanged version the
  `Paseo Supervisor` keeps respawning the daemon from the old build, even after Settings >
  Restart daemon. Don't run the restart script yourself: it stops the daemon your own session
  runs under (see "Updating" in `custom/README.md`).
- Whenever the user's daemons need a restart (a daemon-side change, a protocol or server change, a
  customization whose **Verify** says so), end your final report with the command, in its own code
  block, so the user can copy it:
  ```bash
  kill-paseos-and-daemons.sh
  ```
  It stops both daemons, closes both Paseo windows and reopens them; their running agents stop.
  From a Paseo chat or terminal, run it as `!kill-paseos-and-daemons.sh`.
- Pulling upstream: `custom/update-paseo-source-and-apply-customization.sh --install`. Warn the user
  first when the upstream version changed: reopening the app restarts the daemon, which stops its
  running agents. Only run `custom/reopen-paseo-clients.sh` after an upstream pull when the
  version did not change, or once the user agrees.
- Never stop or restart a running Paseo daemon yourself (ports 6767 and 6768 belong to the user's
  daemons). Never replace files under a folder a running Paseo uses; the install step already
  avoids this.

## Update conflicts

The script stops mid-rebase and prints the failing commit. Find its entry with
`git show <backup-tag>:custom/CHANGES.md` (the working tree may lack `custom/` mid-rebase), redo the
change on the new upstream code following **Re-apply**, `git add` the files, and run
`.git/custom-update.sh --continue`. If the change no longer makes sense upstream (for example,
upstream shipped the same feature), tell the user before dropping it.
