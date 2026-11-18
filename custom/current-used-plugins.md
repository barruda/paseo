# Plugins in use

[plugins.json](plugins.json) is the list: every plugin the fork uses, with its install source and
a one-line description. The update script installs them on each daemon home (personal `~/.paseo`,
Telus `~/.paseo-telus`) through `scripts/sync-plugins.mjs`; see "One-time setup: plugins" in
[README.md](README.md).

To add a plugin for everyone, add an entry to `plugins.json` (`id`, `source`, `what`). Pin npm
sources to a version (`npm:pkg@1.2.3`) and git sources with `ref`. Plugins you want to try on one
machine only, install with `paseo plugin install <source> --home <home>`. The daemon must be
running for that.

`paseo plugin update --home <home>` reviews updates for the third-party plugins. After accepting
one, update the pin in `plugins.json` so new homes get the same version.

Our own plugins live in `custom/plugins/<id>/` and are described in [CHANGES.md](CHANGES.md). They
are installed from the directory, so edits need `paseo plugin reload <id> --home <home>`, not a
reinstall.

## Notes

`power-workboard` started as a patched copy of `fxbing/workboard` 0.2.0 (our former
`paseo-workboard`, now removed). It only tracks tasks created on it, hands them to agents and
brings their work back for review. See
[CHANGES.md](CHANGES.md#power-workboard-a-board-of-registered-tasks-with-an-agent-orchestrator).

`token-ledger` is our fork of `stv1024/token-ledger` 0.7.0 (it replaced the registry install on
2026-11-03): turn rows jump to the turn in the chat and link to the turn's MLflow trace. Never
`paseo plugin remove token-ledger` without backing up its folder first; see
[CHANGES.md](CHANGES.md#token-ledger-our-fork-of-the-tokenledger-plugin-with-turn-jumps-and-mlflow-trace-links).

`beautiful-chat` is a patched copy of `aborakati/beautiful-chat` (`42b61d8`). It restyles the chat
timeline for every agent (tool calls, thinking, todos, messages), and its cards remember open or
closed per kind. Don't install the registry version on top of it; both use the id `beautiful-chat`.

`skills` is our copy of `gpambrozio/skills`. If the npm version is installed, run
`paseo plugin remove skills` before the sync installs ours.

`warp` installs only where the Warp web checkout exists (`PASEO_WARP_WEB_DIR`, default
`~/projetos/warp-web-custom`). `jev-router` is installed on both daemons.

Registry sources (`owner/slug`) come from `paseo.sh/plugins/<owner>/<slug>`. The link
`paseo.sh/plugins/oliexe/botsj` is a 404; the plugin is `oliexe/bots`. The paseo.cafe plugins
(`tell-agent`, `agent-monitor`) install from npm; their pages list the commands.
