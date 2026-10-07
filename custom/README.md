# Local customizations

This checkout runs upstream Paseo (`origin` = getpaseo/paseo) plus our own changes. The changes
live as commits on the local `custom` branch, on top of upstream. Updating means rebasing that
branch onto the new upstream, which the update script does for you.

| File                                             | What it is                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `CHANGES.md`                                     | History of every customization: what, why, files touched, re-apply notes. Read this when a rebase conflicts. |
| `UPDATE-LOG.md`                                  | Written by the script on every update: upstream before/after, backup tag.                                    |
| `update-paseo-source-and-apply-customization.sh` | Fetch upstream, replay customizations, verify, build, install.                                               |
| `plugins/`                                       | Paseo plugins we maintain. Self-contained; they never conflict with upstream.                                |

## Updating

```bash
git checkout custom
custom/update-paseo-source-and-apply-customization.sh             # rebase onto origin/main, verify, build
# quit Paseo, then:
custom/update-paseo-source-and-apply-customization.sh --no-verify --install
```

Use `--ref v0.11.0` to follow a release tag instead of `main`. `--no-build` only rebases.

Before rebasing, the script tags the current state as `custom-backup/<timestamp>`. To roll back:
`git reset --hard custom-backup/<timestamp>`. The installed app's previous copy stays in
`~/Applications/Paseo.previous`; move it back to undo an install. Delete old backup tags with
`git tag -l 'custom-backup/*'` and `git tag -d`.

### When the rebase conflicts

The script stops and prints which customization failed. Look that commit up in `CHANGES.md`. Its
entry says what the change does, so you can redo it on top of the new upstream code if the code
around it moved. Then `git add` the files and run `.git/custom-update.sh --continue`.

The script runs from that copy in `.git/` because mid-rebase the working tree may not contain
`custom/` yet. For the same reason, read the history with `git show <backup-tag>:custom/CHANGES.md`.

`rerere` is enabled, so git remembers each conflict resolution and applies it on later updates.

## Adding a customization

1. Make the change on the `custom` branch. Prefer a plugin in `custom/plugins/` over editing core
   files. A plugin can't conflict with upstream.
2. When you must touch a core file, keep the edit small and mark it with a
   `CUSTOM(<name>)` comment. `rg "CUSTOM\("` then lists every patched spot.
3. Commit with a `custom: ` subject prefix, one commit per customization. Fold follow-up fixes into
   that commit (`git commit --fixup <sha>` then `git rebase --autosquash origin/main`), so each
   customization replays as a unit.
4. Add an entry to `CHANGES.md`.

## One-time setup: shell-command plugin

Each daemon must have plugins enabled and the plugin installed once. The daemon keeps the source
path in its `config.json` and recompiles the plugin from disk on every start, so updates need no
reinstall. Plugins are unsandboxed code that runs with your user's permissions.

Run this once per daemon home (`~/.paseo`, `~/.paseo-telus`) while that Paseo is running. Don't use
`npm run cli` here: it targets the checkout's dev daemon.

```bash
paseo() { npx tsx packages/cli/src/index.js "$@"; }
paseo plugin install "$PWD/custom/plugins/shell-command" --home ~/.paseo
# set "pluginsEnabled": true in ~/.paseo/config.json, then:
paseo reload --home ~/.paseo
```

After editing the plugin source: `paseo plugin reload shell-command --home ~/.paseo`.
