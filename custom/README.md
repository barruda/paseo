# Local customizations

This checkout runs upstream Paseo plus our own changes. The changes are commits on the `custom`
branch, on top of upstream. Updating means rebasing that branch onto the new upstream, which the
update script does for you.

| Remote   | Repository     | Used for                                                         |
| -------- | -------------- | ---------------------------------------------------------------- |
| `origin` | getpaseo/paseo | Upstream. Fetch only.                                            |
| `fork`   | barruda/paseo  | Backup of `custom`. The update script pushes after every update. |

Both remotes use the `github.com-personal` SSH alias, so git authenticates with the personal
GitHub account instead of the work one.

| File                                             | What it is                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `CHANGES.md`                                     | History of every customization: what, why, files touched, re-apply notes. Read this when a rebase conflicts. |
| `UPDATE-LOG.md`                                  | Written by the script on every update: upstream before/after, backup tag.                                    |
| `update-paseo-source-and-apply-customization.sh` | Fetch upstream, replay customizations, verify, build, install, back up to `fork`.                            |
| `plugins/`                                       | Paseo plugins we maintain. Self-contained; they never conflict with upstream.                                |

Agents (Claude Code, Codex) have a skill for this workflow: `.agents/skills/paseo-customizations/`.

## New machine

1. Add the SSH alias to `~/.ssh/config`, with a key registered on the personal GitHub account:
   ```
   Host github.com-personal
       HostName github.com
       User git
       IdentityFile ~/.ssh/id_ed25519_github
   ```
2. Clone the fork on the `custom` branch and wire the remotes:
   ```bash
   git clone -b custom git@github.com-personal:barruda/paseo.git paseo && cd paseo
   git remote rename origin fork
   git remote add origin git@github.com-personal:getpaseo/paseo.git
   git fetch origin
   git branch -u fork/custom
   ```
3. Install Node 24 (see `.nvmrc`), then build and install:
   ```bash
   custom/update-paseo-source-and-apply-customization.sh --install
   ```
   This also pulls in whatever upstream released since the last update. The install step repoints
   existing `~/.local/share/applications/paseo*.desktop` launchers. On a fresh machine there are
   none, so create one whose `Exec=` runs `~/Applications/Paseo-builds/<newest>/Paseo`; later
   installs keep it current.
4. Open Paseo once so it starts its daemon, then do the plugin setup below for each daemon home.

## Updating

```bash
git checkout custom
custom/update-paseo-source-and-apply-customization.sh --install
```

Then close and reopen the Paseo window. Use `--ref v0.11.0` to follow a release tag instead of
`main`. `--no-build` only rebases. `--install-only` installs the last build.

Each install goes to a new folder under `~/Applications/Paseo-builds/`, and the script repoints the
`paseo*.desktop` launchers at it. It never replaces files a running app or daemon uses, so you
don't have to quit anything first. When you reopen the window, the new app reuses the running
daemon if the versions match. If the update changed the daemon version, the app restarts the
daemon, which stops its running agents.

The script keeps the two newest builds plus any still in use. To roll back an install, restore a
launcher from its `.desktop.bak`. Before rebasing, the script tags the current state as
`custom-backup/<timestamp>`; roll the source back with `git reset --hard custom-backup/<timestamp>`.
Delete old backup tags with `git tag -l 'custom-backup/*'` and `git tag -d`.

### When the rebase conflicts

The script stops and prints which customization failed. Look that commit up in `CHANGES.md`. Its
entry says what the change does, so you can redo it on top of the new upstream code if the code
around it moved. Then `git add` the files and run `.git/custom-update.sh --continue`.

The script runs from that copy in `.git/` because mid-rebase the working tree may not contain
`custom/` yet. For the same reason, read the history with `git show <backup-tag>:custom/CHANGES.md`.

`rerere` is enabled, so git remembers each conflict resolution and applies it on later updates.

## Adding a customization

1. Work on the `custom` branch. Prefer a plugin in `custom/plugins/` over editing core files. A
   plugin can't conflict with upstream. See `docs/plugins.md`.
2. When you must touch a core file, keep the edit small and mark it with a `CUSTOM(<name>)`
   comment. `rg "CUSTOM\("` then lists every patched spot.
3. Add tests and list them in the script's "Running customization tests" step.
4. Commit with a `custom: ` subject prefix, one commit per customization. Stage files by name:
   `git commit -a` would also pick up npm's `package-lock.json` noise. Fold follow-up fixes into
   their customization: `git commit --fixup <sha>`, then
   `git rebase --autosquash "$(git merge-base HEAD origin/main)"`.
5. Add an entry to `CHANGES.md`.
6. Back up: `git push --force-with-lease fork custom`.

A plugin-only change needs no app rebuild: run `paseo plugin reload <id> --home <home>` for each
daemon. A core change needs a new app build. To build without pulling upstream, run
`npm run build:desktop`, then `custom/update-paseo-source-and-apply-customization.sh --install-only`.

## One-time setup: plugins

Each daemon must have plugins enabled and each plugin installed once. The daemon keeps the source
path in its `config.json` and recompiles the plugin from disk on every start, so updates need no
reinstall. Plugins are unsandboxed code that runs with your user's permissions.

Run this once per daemon home (`~/.paseo`, `~/.paseo-telus`) while that Paseo is running. Don't use
`npm run cli` here: it targets the checkout's dev daemon.

```bash
paseo() { npx tsx packages/cli/src/index.js "$@"; }
# set "pluginsEnabled": true in ~/.paseo/config.json, then:
paseo reload --home ~/.paseo
paseo plugin install "$PWD/custom/plugins/shell-command" --home ~/.paseo
paseo plugin install "$PWD/custom/plugins/workspace-tasks" --home ~/.paseo
```

After editing a plugin's source: `paseo plugin reload <id> --home ~/.paseo`.
