# Local customizations

This checkout runs upstream Paseo plus our own changes. The changes are commits on the `custom`
branch, on top of upstream. Updating means merging the new upstream into that branch, which the
update script does for you. Until 2026-10-29 updates rebased the branch instead; a merge resolves
each conflicting file once, where the rebase stopped on the same files once per customization.

| Remote   | Repository     | Used for                                                         |
| -------- | -------------- | ---------------------------------------------------------------- |
| `origin` | getpaseo/paseo | Upstream. Fetch only.                                            |
| `fork`   | barruda/paseo  | Backup of `custom`. The update script pushes after every update. |

Both remotes use the `github.com-personal` SSH alias, so git authenticates with the personal
GitHub account instead of the work one.

| File                                             | What it is                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `CHANGES.md`                                     | History of every customization: what, why, files touched, re-apply notes. Read this when a merge conflicts. |
| `UPDATE-LOG.md`                                  | Written by the script on every update: upstream before/after, backup tag.                                   |
| `update-paseo-source-and-apply-customization.sh` | Fetch upstream, replay customizations, verify, build, install, back up to `fork`.                           |
| `plugins/`                                       | Paseo plugins we maintain. Self-contained; they never conflict with upstream.                               |

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
5. Point every daemon home at the shared local speech models folder, `.llm/` in this checkout
   (gitignored), so the personal and TELUS daemons keep one copy:
   ```bash
   for h in ~/.paseo ~/.paseo-telus; do
     python3 -c "import json,sys; p=sys.argv[1]+'/config.json'; d=json.load(open(p)); d.setdefault('providers',{}).setdefault('local',{})['modelsDir']='$HOME/projetos/paseo/.llm'; json.dump(d,open(p,'w'),indent=2)" "$h"
   done
   ```
   The models download there the first time dictation or voice mode needs them. Restart the
   daemons afterwards (`kill-paseos-and-daemons.sh`): the folder is read once at startup.

## Updating

```bash
git checkout custom
custom/update-paseo-source-and-apply-customization.sh --install
```

Then run `custom/reopen-paseo-clients.sh` to close and reopen the Paseo windows from their
launchers, all of them. A window whose daemon keeps running after quit (Settings >
`keepRunningAfterQuit`) leaves its daemon and agents running; for the others (`paseo-telus`) the
daemon restarts with the window and its running agents stop. Use `--ref v0.11.0` to follow a release tag instead of
`main`. `--no-build` only merges. `--install-only` installs the last build.

Each install goes to a new folder under `~/Applications/Paseo-builds/`, and the script repoints the
`paseo*.desktop` launchers at it. It never replaces files a running app or daemon uses, so you
don't have to quit anything first. When you reopen the window, the new app reuses the running
daemon if the versions match. If the update changed the daemon version, the app restarts the
daemon, which stops its running agents.

A daemon-side change with an unchanged version needs the daemon stopped by hand. The daemon runs
under a long-lived `Paseo Supervisor` that respawns it from the build the supervisor started from,
so neither reopening the window nor Settings > Restart daemon picks up new daemon code. Run
`build-paseo-if-needed-and-kill-daemons.sh` (`custom/bin/`, linked into `~/.local/bin` under that
name and as `kill-paseos-and-daemons.sh` and `restart-paseos-and-daemons.sh`). It first checks
whether the installed build is behind the committed source (`paseo-build.sh status`, below) and,
if it is, builds and installs from the working tree before stopping anything; a failed build stops
nothing and sends a desktop notification. `--no-build` skips the check, `--force-build` builds
anyway. Then it stops the daemons
(`~/.paseo` and `~/.paseo-telus`), closes the open Paseo windows, and reopens them from their
launchers, giving each step 5 s before it kills. It then waits up to 30 s for each window and
its daemon and launches a window once more if it did not come back. When neither the paseo-telus window nor its daemon
is running, it leaves paseo-telus alone. This stops the running agents, then resumes them. It first
moves itself into a transient systemd user service (`setsid` alone keeps it in the cgroup of the
Paseo that ran it, which can take it down halfway), so it also works as
`!kill-paseos-and-daemons.sh` from a Paseo chat or from a Paseo terminal, both of which the daemon
owns. Its log, build included, is `~/.local/state/kill-paseos-and-daemons.log`.

Before stopping, it records every agent whose stored status is `running` or `initializing` (normal
agents, Paseo subagents, board workers and the Projects Assistant chat) in
`~/.local/state/paseo-restart-resume.tsv`. As each daemon comes back, every recorded agent of that
home gets one message saying the restart was intentional and to continue where it stopped. An agent
that is gone, already running again, or already got a message after the restart is skipped;
failures are logged and the rest go on. The agent that ran the script is skipped through
`PASEO_AGENT_ID`, so its "continue" cannot make it restart Paseo again; `--skip-agent <id>` adds
another id to leave alone. The Power Workboard has the same rule on its side: a task whose agent is
idle and whose last activity is before the current daemon started is resumed instead of being
closed as `no-report` when the script's continue is late.

`custom/bin/paseo-build.sh build` builds the desktop app from the working tree as it is and
installs it; `if-needed` does that only when `status` says the installed build is behind. Each
build folder holds a `paseo-build-source` file naming a snapshot commit of the tree it was built
from, uncommitted and untracked files included (kept by refs under `refs/paseo-builds/`). The
installed build is behind when `HEAD` differs from that snapshot in a file that goes into the app:
changes under `custom/` (directory plugins load from source on daemon start), docs, Markdown and
tests don't count. A build made with a bare `npm run build:desktop` has no snapshot; the commit in
its install folder's name stands in, which only ever causes one extra build. One build runs at a
time: a second `paseo-build.sh` waits on a lock, since two builds clean the same `dist` folders.

Installed builds have the auto-updater off, so they never replace themselves with upstream's
release; updates only come from this script.

The script keeps the two newest builds plus any still in use. To roll back an install, restore a
launcher from its `.desktop.bak`. Before merging, the script tags the current state as
`custom-backup/<timestamp>`; roll the source back with `git reset --hard custom-backup/<timestamp>`.
Delete old backup tags with `git tag -l 'custom-backup/*'` and `git tag -d`.

### When the merge conflicts

The script stops and lists the conflicted files. In each one, `rg "CUSTOM\("` shows which
customizations live there; their `CHANGES.md` entries say what they do and how to redo them
(**Re-apply**) on top of the new upstream code. Keep upstream's change and the customization's
intent, `git add` the files, and run `.git/custom-update.sh --continue`, which commits the merge and
goes on to verify, build and install. `git merge --abort` goes back to where you were.

`rerere` is enabled, so git remembers each conflict resolution and applies it on later updates.

## Adding a customization

1. Work on the `custom` branch. Prefer a plugin in `custom/plugins/` over editing core files. A
   plugin can't conflict with upstream. See `docs/plugins.md`.
2. When you must touch a core file, keep the edit small and mark it with a `CUSTOM(<name>)`
   comment. `rg "CUSTOM\("` then lists every patched spot.
3. Add tests and list them in the script's "Running customization tests" step.
4. Commit with a `custom: ` subject prefix. A follow-up change is its own commit. Stage files by
   name: `git commit -a` would also pick up npm's `package-lock.json` noise.
5. Add an entry to `CHANGES.md`.
6. Back up: `git push --force-with-lease fork custom`.

A plugin-only change needs no app rebuild: run `paseo plugin reload <id> --home <home>` for each
daemon. A core change needs a new app build. To build without pulling upstream, run
`npm run build:desktop -- --linux dir`, then
`custom/update-paseo-source-and-apply-customization.sh --install-only`.

Build with `--linux dir`, as the script does. The install only copies
`packages/desktop/release/linux-unpacked`, so the packages upstream's `electron-builder.yml` also
makes (AppImage, deb, rpm, tar.gz) are wasted minutes. On Ubuntu, a plain `npm run build:desktop`
also ends in an error at the rpm step (`Need executable 'rpmbuild'`); `linux-unpacked` is
already complete by then, so `--install-only` still works.

## One-time setup: plugins

The update script installs every plugin in [plugins.json](plugins.json) on each daemon home
(`~/.paseo`, `~/.paseo-telus`, or `PASEO_HOMES`) and turns plugins on where they are off. The
daemon keeps the source path in its `config.json` and recompiles the plugin from disk on every
start, so updates need no reinstall. Plugins are unsandboxed code that runs with your user's
permissions. [current-used-plugins.md](current-used-plugins.md) lists what is installed and why.

To run only this step, with the daemon running (npm and git sources need it):

```bash
node custom/scripts/sync-plugins.mjs --home ~/.paseo            # add --dry-run to preview
```

The script leaves alone any plugin already in the home's `config.json`, enabled or not, so to opt
out, disable it or remove it. A removed plugin does not come back: the script records what it has
applied in `<home>/custom-plugins-applied.json`; delete the id from that file to get it again.
`warp` waits until the Warp web checkout exists.

After editing a plugin's source: `paseo plugin reload <id> --home ~/.paseo`.
