# Plugins in use

Plugins installed on the two daemons: personal (`~/.paseo`, port 6767) and Telus
(`~/.paseo-telus`, port 6768). Each daemon keeps its own copy under `<home>/plugins/` and records
the source in `<home>/config.json`. The daemon must be running to install a plugin.

Install a plugin on both daemons:

```bash
paseo() { npx tsx packages/cli/src/index.js "$@"; }
for h in ~/.paseo ~/.paseo-telus; do paseo plugin install <source> --home $h; done
```

## Third-party plugins

All on both daemons. Versions as of 2026-10-10; `paseo plugin update --home <home>` reviews updates.

| Plugin id       | Install source                            | Version | What it does                                                                        |
| --------------- | ----------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `skills`        | `gpambrozio/skills`                       | 0.4.0   | Lists the skills an agent can use, renders each `SKILL.md`, and invokes it.         |
| `zerosub`       | `kapybara-org/zerosub`                    | 1.2.1   | Several Claude and ChatGPT (Codex) subscriptions side by side, switching on limits. |
| `paseo-bots`    | `oliexe/bots`                             | 0.2.0   | Personal bots with their own instructions, agent, memory, routines, and tools.      |
| `agent-crew`    | `npm:@omercnet/paseo-agent-crew@1.2.1`    | 1.2.1   | Explorer panel to view and control the managed agent crews in a workspace.          |
| `tell-agent`    | `npm:@omercnet/paseo-tell-agent@1.2.1`    | 1.2.1   | Send messages to agents in other workspaces on the same host.                       |
| `agent-monitor` | `npm:@omercnet/paseo-agent-monitor@1.2.2` | 1.2.2   | Host-wide agent triage roster.                                                      |
| `progress`      | `stevecastaneda/progress`                 | 0.3.4   | Live progress dashboard per worktree, fed by agents running `paseo-progress`.       |

Registry sources (`owner/slug`) come from `paseo.sh/plugins/<owner>/<slug>`. The link
`paseo.sh/plugins/oliexe/botsj` is a 404; the plugin is `oliexe/bots`. The paseo.cafe plugins
(`tell-agent`, `agent-monitor`) install from npm; their pages list the commands.

## Our own plugins

Source lives in `custom/plugins/<id>/` and is described in [CHANGES.md](CHANGES.md). Installed from
the directory, so edits need `paseo plugin reload <id> --home <home>`, not a reinstall.

`power-workboard` (folder `power-workboard`) started as a patched copy of `fxbing/workboard` 0.2.0
(our former `paseo-workboard`, now removed). It only tracks tasks created on it, hands them to
agents and brings their work back for review. It is on by default: the update script installs it
on any daemon with plugins enabled that lacks it. See [CHANGES.md](CHANGES.md#power-workboard-a-board-of-registered-tasks-with-an-agent-orchestrator).

`token-ledger` is our fork of `stv1024/token-ledger` 0.7.0 (it replaced the registry install on
2026-11-03): turn rows jump to the turn in the chat and link to the turn's MLflow trace. Never
`paseo plugin remove token-ledger` without backing up its folder first; see
[CHANGES.md](CHANGES.md#token-ledger-our-fork-of-the-tokenledger-plugin-with-turn-jumps-and-mlflow-trace-links).

`beautiful-chat` is a patched copy of `aborakati/beautiful-chat` (`42b61d8`). It restyles the chat
timeline for every agent (tool calls, thinking, todos, messages), and its cards remember open or
closed per kind. Don't install the registry version on top of it; both use the id `beautiful-chat`.

| Plugin id         | Personal | Telus |
| ----------------- | -------- | ----- |
| `shell-command`   | yes      | yes   |
| `workspace-tasks` | yes      | yes   |
| `warp`            | yes      | no    |
| `beautiful-chat`  | yes      | yes   |
| `power-workboard` | yes      | yes   |
| `critic`          | yes      | yes   |
| `jev-router`      | yes      | no    |
| `token-ledger`    | yes      | yes   |
