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
- One commit per customization, subject `custom: <what>`. Fold fixes into it with
  `git commit --fixup <sha>` and `git rebase --autosquash "$(git merge-base HEAD origin/main)"`.
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

## Shipping a change to the user's running Paseo

- Plugin-only change: no rebuild. Reload it on each daemon:
  `npx tsx packages/cli/src/index.js plugin reload <id> --home ~/.paseo` (and `~/.paseo-telus`).
- New plugin: it must be installed on each daemon once. See "One-time setup: plugins" in
  `custom/README.md`. Plugins run unsandboxed, so ask before enabling `pluginsEnabled` on a daemon.
- Core change: `npm run build:desktop`, then
  `custom/update-paseo-source-and-apply-customization.sh --install-only`. The user then reopens the
  Paseo window.
- Pulling upstream: `custom/update-paseo-source-and-apply-customization.sh --install`. Warn the user
  first when the upstream version changed: reopening the app restarts the daemon, which stops its
  running agents.
- Never stop or restart a running Paseo daemon yourself (ports 6767 and 6768 belong to the user's
  daemons). Never replace files under a folder a running Paseo uses; the install step already
  avoids this.

## Update conflicts

The script stops mid-rebase and prints the failing commit. Find its entry with
`git show <backup-tag>:custom/CHANGES.md` (the working tree may lack `custom/` mid-rebase), redo the
change on the new upstream code following **Re-apply**, `git add` the files, and run
`.git/custom-update.sh --continue`. If the change no longer makes sense upstream (for example,
upstream shipped the same feature), tell the user before dropping it.
