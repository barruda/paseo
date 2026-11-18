# Power Workboard

Started as a copy of our patched Workboard (`fxbing/paseo-workboard` 0.2.0, since removed from
this repo) with these differences:

- **Only registered tasks.** Nothing is imported. A workspace joins the board only when one of its
  tasks starts work on it, and only those workspaces and their agents are watched.
- **Refinement.** A draft's Refine button opens an agent chat in the project folder.
  `/write-ticket [focus]` in that chat closes it and writes the ticket into the task's title and
  description; then move it to Ready to start.
- **Orchestrators.** The Orchestrators tab lists them; each opens in its own tab with its
  settings, running tasks and log. An orchestrator takes Ready to start tasks (the ones chosen for
  it, or unassigned ones of its project), top of the column first, on a schedule: Manual (Run
  now), a time window, or daily times with a batch per run. Each task gets a workspace in its
  project (a worktree for git projects), moves to In progress, and gets an agent whose first
  message is the task's title and description. When the agent's turn ends the task moves to
  Ready to review. Cards link to the agent's chat.
- **Review.** A Ready to review card shows the agent's last reply with **Done** and **Continue
  task**. Continue takes optional feedback and sends the task back to Ready to start; the
  orchestrator's next pass gives the feedback to the same agent.
- **Done.** A Done card in a git project has **Commit**, **PR description** (written by the
  task's agent, to copy; no PR is created) and **Merge into project**. Once merged, only PR
  description is left.

- **Night tasks and start times.** A draft's **When** (task editor) puts it in Scheduled: a
  night task starts inside the night window (Orchestrators tab, Night tasks), taken by any
  enabled orchestrator whatever its schedule; a task with a start time moves to Ready to start
  at that time. The Night tasks section can also power the computer off when the night's work
  is done, after a 5-minute countdown that the board's banner can cancel.

Groups: Backlog, Scheduled, Ready to start, In progress, Ready to review, Done, on `pwb:*`
workspace labels.

Each orchestrator is stored in `orchestrators` (`shared/model.ts`, `orchestratorConfigSchema`);
schedules are in `shared/schedule.ts`. `orchestrator` holds the defaults new orchestrators start
from (`claude/claude-opus-5-5`, `bypassPermissions`, `medium`, worktree) and `refineModeId`
(`default`) for refinement chats, with no UI yet.

## Quick messages and the ack contract

You can write to the Projects Assistant without opening its chat.

- **From the app.** The sidebar footer has a row named "Projects Assistant status". Press the
  **+** on it to write a message; press the row itself to open the assistant conversation at the
  newest message. The row shows the assistant's short answer: green for ok, yellow when it needs
  something from you, red for an error, grey while it has not answered yet.
- **From any chat.** Type `/assistant <message>` in the composer of any agent. The message goes to
  the assistant and you stay where you are.

Each message reaches the assistant wrapped as `[Quick message <id> from <source>]`. The assistant
must call `board_ack` first, before any other tool: `ok` with a sentence on what it will do,
`needs-input` with its question, or `error` with the reason. It may call `board_ack` again with
the same id to update the state. If its turn ends without one, the server classifies its reply
instead (a question needs input; failure words are an error; anything else is ok).

External callers use the plugin RPC (this needs a Paseo build whose CLI has `paseo plugin rpc`,
as this fork's does):

```sh
paseo plugin rpc power-workboard workboard.assistant.ask '{"text":"...","source":"opendeck"}' --json
```

It returns `{ id, status, message, agentId, sentAt, link }`, with `status` one of `ok`,
`needs-input`, `error` or `pending`. `pending` means the assistant has not answered within
`waitMs` (default 20 s, at most 25 s). Poll with
`workboard.assistant.quick.get '{"id":"<id>","waitMs":25000}'`. `link` opens the chat:
`xdg-open <link>` or `paseo agent open <agentId>`. `workboard.assistant.quick.list` returns the
recent messages, newest first.

For scripts, `bin/ask-assistant` does the polling and only answers `ok`, `needs-input` or
`error`:

```sh
custom/plugins/power-workboard/bin/ask-assistant --source opendeck "what needs me today?"
echo "create a task to ..." | custom/plugins/power-workboard/bin/ask-assistant --open
```

It prints the JSON above and exits 0 (ok), 2 (needs-input) or 1 (error). A message still
unanswered after `--timeout` (90 s) comes out as `error`; it stays in the chat. `--open` opens the
conversation. It uses `$PASEO_CLI`, else the CLI of the build the paseo-personal launcher runs,
and talks to the daemon of `$PASEO_HOME` (default `~/.paseo`). It needs `jq`.

Messages live in memory (the last 30). A daemon restart empties the status row.

See [CHANGES.md](../../CHANGES.md#power-workboard-a-board-of-registered-tasks-with-an-agent-orchestrator)
for the full description.

```sh
npm ci
npm run check
paseo plugin install "$PWD" --home ~/.paseo
```
