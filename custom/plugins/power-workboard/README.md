# Workboard

Started as a copy of our patched Workboard (`fxbing/paseo-workboard` 0.2.0, since removed from
this repo) with these differences:

- **Only registered tasks.** Nothing is imported. A workspace joins the board only when one of its
  tasks starts work on it, and only those workspaces and their agents are watched.
- **Project colors from the project icon.** A project's badge, card border and accents use the
  color of the icon the app shows for it: the dominant color of a repository favicon or logo
  (weighted average that ignores transparent, near-white and near-black pixels), the app's letter
  color when the project has no image, and the old stable palette when the icon cannot be read.
  Each color is adjusted for the light and the dark theme, and the color is computed once per
  icon revision and cached by the daemon plugin. Column colors picked by hand in Group settings
  are untouched.
- **Build and redeploy Paseo.** A board toolbar button (top right, before Settings) runs
  `custom/bin/build-paseo-if-needed-and-kill-daemons.sh` after a confirmation and shows its output;
  the daemons restart and every running agent stops.
- **Refinement.** A draft's Refine button opens an agent chat in the project folder.
  `/write-ticket [focus]` in that chat closes it and writes the ticket into the task's title and
  description; then move it to Ready to start.
- **Orchestrators.** The Orchestrators tab lists them; each opens in its own tab with its
  settings, running tasks and log. An orchestrator takes Ready to start tasks (the ones chosen for
  it, or unassigned ones of its project; an All projects orchestrator only gets the projects
  that have none of their own), top of the column first, on a schedule: Automatic (always on,
  the default for new orchestrators; stored as a 00:00–00:00 window every day), a time window,
  daily times with a batch per run, or Manual (Run now). Each task gets a workspace in its
  project (a worktree for git projects, cut from the Project Manager's base branch for that
  project, or else from the branch the project checkout is on), moves to In progress, and gets an
  agent whose first
  message is the task's title and description. When the agent's turn ends the task moves to
  Ready to review. Cards link to the agent's chat. Tick several orchestrators in the list and
  **Change agent** to give them all the same provider/model, mode and thinking at once; each
  one's log records the change.
- **Folder mode.** An orchestrator's **Workspace** can be **Directly in the project folder (no
  worktree)** instead of a worktree per task. Folder mode runs one task at a time per project
  folder, whichever orchestrator owns it, so `At a time` is locked at 1; a second task waits in
  Ready to start with `Waiting: "<task>" is not delivered yet in <folder>` in the orchestrator's
  log and status. The folder stays busy from the start until the delivery is delivered or
  dismissed, or until the task goes back to Backlog/Ready or to Done without a pending delivery;
  In progress, Ready to review, Needs you, a checkpoint and every delivery stage keep it. Before
  committing, the board checks that no other task's agent is still running in the folder; if one
  is, the commit waits and retries on the next pass with the reason visible. A manual start has no
  orchestration record, so it is not in the folder queue; only the commit check covers it. The
  task starts even if the folder already has uncommitted changes: the board records the folder's
  HEAD and the `git status --porcelain` lines in the orchestration, logs a `folder-dirty` history
  event, and the review diff warns and lists those files apart. Its delivery commits on the
  branch the folder is on and never merges, and approving it from Ready to review also commits
  what is left, so the Done card offers Commit and PR description only. The project folder's
  workspace is never archived. Worktree orchestrators are unchanged.
- **Resource pools.** Orchestrators can share a pool (Orchestrators tab, **Resource pools**): a
  task starts only with a free slot in its orchestrator and in its pool, and nothing of a pool
  starts while the machine's free RAM (`MemAvailable` in `/proc/meminfo`) is under the pool's
  floor; after each start a pool with a floor waits 5 minutes for the RAM to settle. A free
  slot goes to the top card of the column. A task keeps its pool slot while its delivery checks,
  merges or fixes, so a failed check goes back to its agent without losing its turn; a fix
  that waits over 30 minutes for the pool goes to Needs you. The orchestrator's status and log
  say what holds it. In a project with several orchestrators only the first in the list takes
  the tasks with no orchestrator chosen; the arrows on each row reorder the list.
- **Review.** A Ready to review card shows the agent's last reply with **Done** and **Continue
  task**. Continue takes optional feedback and sends the task back to Ready to start; the
  orchestrator's next pass gives the feedback to the same agent.
- **Done.** A Done card in a git project has **Commit**, **PR description** (written by the
  task's agent, to copy; no PR is created) and **Merge into project**. Once merged, only PR
  description is left.
- **Ticket numbers.** Every ticket has a short, sequential number shown as `#42` on the card,
  before the details arrow, and at the top of its editor and panel. Numbers are global to the
  board (one board per plugin storage, all projects), assigned in creation order, and never
  reused. Existing tickets get theirs in a migration. The board tools accept the UUID or the
  short number as `42` or `#42` wherever they take a task id, and
  `board_list_tasks`/`board_overview` show the number.
- **Ticket panel.** Middle-click a card, right-click it and choose **Open in panel**, or
  long-press it on a phone or tablet, to read the ticket beside the board without leaving it. The
  context menu stays inside the screen near an edge. One panel at a time: opening another ticket
  replaces it. Close it with its X or Esc; left click keeps its usual behavior. The SDK workspace
  panel cannot carry a ticket id and the board is a surface, so the board owns this side panel.
- **Checkpoints.** A task that does not fit in one session ends its turn with a `checkpoint`
  report (`progress {done, next}`, optional `resumeAfter` and `waitingFor`). The engine commits
  the partial work in the task's worktree only, keeps the card in In progress, and resumes it on
  the next pass, or at `resumeAfter` (status `waiting`). A queued or waiting task holds no slot.
  When the agent is gone, the new one gets a handoff: ticket, checklist, last summary, branch.
  Past the orchestrator's **Checkpoints per task** (default 5), or after two checkpoints in a
  row with no new done item, the task goes to Needs you as `stalled`; Continue task resets the
  count. The card shows the progress ("3/7 · checkpoint 2", or "waiting until 09:00: CI") and
  expands to the checklist and log; the Dashboard lists waiting tasks apart from running ones.
- **Usage limit.** A task whose agent stops on the plan's usage limit ("You've hit your 5-hour
  limit · resets 11:30pm (America/Sao_Paulo)") is not sent to Needs you: it waits like a
  checkpoint until two minutes after the reset (an hour when the notice has no time), then the
  same agent continues. The card says "paused by the usage limit until 23:32". Meanwhile its
  orchestrator starts no new task. A fourth limit in a row goes to Needs you as `usage-limit`.
  Only a reply that starts with the notice counts, not one that quotes it. When the Project Manager chat answers a wake with the
  limit, its tasks are told again after the reset, also after a restart.
- **Chat compaction.** When a turn leaves the Project Manager chat at **Compact at (tokens)**
  or more (Settings > Bruno's Customizations > Project Manager, default 180k, 0 is off), the
  board asks a fork of the chat for a short summary of its last three replies, starts a new chat
  whose first message carries it as inherited context, and archives the old one, as Restart chat
  does. It waits for a quiet chat: no turn, permission, queued or quick message, or board wake.
  A failed round waits 30 minutes before the next try and shows as "Chat compaction failed".
  Reports lists each compaction under a "Project Manager chat" row (`server/assistant/compact.ts`).
- **Report card.** In any agent chat, a reply ending in a valid `<report>` block shows the block
  as a card (status, summary, what was asked with its evidence, question with its options,
  checks, collapsed changed files, risks) instead of JSON (`shared/task-report.ts`). An invalid
  block leaves the reply as it was. An option answers in one tap and any outcome or checklist
  step takes a comment; both continue the task like Continue task (`client/assistant/card-parts.tsx`).
- **Project Manager reply block.** The Project Manager ends each reply with a short ` ```pwb `
  block (`feito`, `pedido`, `fora`, `aviso`, `bloqueio`, `pergunta`, `opção`, `recomendo`,
  `próximo`, `seu`), described in [docs/assistant-reply-protocol.md](docs/assistant-reply-protocol.md).
  In the Project Manager's chat only, it shows as icons, the review map, the options as buttons, a
  `próximo` chip, the `seu` line last and a details expander; a task id links to the ticket in
  Reports (`shared/reply-protocol.ts`). A tap or a comment goes to the chat as a message.

- **Night tasks and start times.** A draft's **When** (task editor) puts it in Scheduled: a
  night task starts inside the night window (Orchestrators tab, Night tasks), taken by any
  enabled orchestrator whatever its schedule; a task with a start time moves to Ready to start
  at that time. The Night tasks section can also power the computer off when the night's work
  is done, after a 5-minute countdown that the board's banner can cancel.

Groups: Backlog, Scheduled, Ready to start, In progress, Ready to review, Done, on `pwb:*`
workspace labels.

Each orchestrator is stored in `orchestrators` (`shared/model.ts`, `orchestratorConfigSchema`);
schedules are in `shared/schedule.ts`. `orchestrator` holds the defaults new orchestrators start
from (`claude/claude-opus-5-5`, full access, `medium`, worktree) and `refineModeId`
(`default`) for refinement chats, with no UI yet. Permission is a per-orchestrator and
Project Manager field (**Permissions**, full access by default): the mode for Claude, Codex and
other mode providers, the `auto_accept` feature (`autoAccept`) for OpenCode, Cursor, Kimi, Kiro and Trae
(`shared/permission.ts`).

## Quick messages and the ack contract

You can write to the Project Manager without opening its chat.

- **From the app.** The status bar at the bottom of the window starts with the Project Manager:
  a colored message icon that opens the box to write a message, the Project Manager's short answer to
  the newest message (green check for ok, yellow when it needs something from you, red for an
  error, grey clock while it has not answered yet), then the topic the Project Manager chat is on now.
  Press the answer to open the conversation at that message, or the topic to open the chat. The
  line under the chat's own composer is hidden, since the bar shows it. On phones the same entries
  sit at the bottom of the sidebar; on app builds without the status bar they are a sidebar footer
  row named "Project Manager status", with a **+** to write.
- **From any chat.** Type `/assistant <message>` in the composer of any agent. The message goes to
  the Project Manager and you stay where you are.

Every message that wakes the Project Manager carries the current **Needs you** list (task, project,
reason, review policy and since when): the `[Board]` wake lists every task still waiting, a quick
message appends it, and a user message gets it steered into the same turn. While the chat is busy
the wake looks again every 10 s; a task told 10 minutes ago with no `board_report` or action since
is told once more (`delivery.toldAt`, `remindedAt`, `reportedAt`). `board_reload_plugin` reloads
the plugin when the chat's turn ends, so the board tools stay attached for the whole turn.

Each message reaches the Project Manager wrapped as `[Quick message <id> from <source>]`. The Project Manager
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
`needs-input`, `error` or `pending`. `pending` means the Project Manager has not answered within
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

Messages live in memory (the last 30). A daemon restart empties the status.

## Reports and `board_report`

The **Projects Reports** chip in the Desk header (also the Reports link at the end of the board's
tab bar, beside Dashboard and Conversations, "Projects Reports" in the Command Center, "Open
report" on a Dashboard card and "Report" in a Conversations thread) shows, per ticket, what the
Project Manager and the board did. The sidebar lists every ticket with actions, newest first,
with a search and a project filter; a ticket shows what was asked and a timeline with one collapsed
row per action. Open a row for its detail, decisions and the automatic events of that iteration (each with its
detail and, for an agent's report or a continue, its own interaction toggle); the inner
"Interaction with the agent" toggle shows what the Project Manager asked the task's agent, its answer,
its `<report>` and a link to the conversation.

The Project Manager records each action once with `board_report` (`shared/assistant-reports.ts`):

```json
{
  "taskId": "…",
  "kind": "merged",
  "summary": "One sentence; also the chat reply and the status row text.",
  "detail": "short markdown",
  "decisions": ["…"],
  "orchestrator": {
    "agentId": "…",
    "prompt": "what it asked",
    "reply": "its answer"
  },
  "quickMessageId": "q-…"
}
```

`kind` is one of `created`, `started`, `moved`, `reviewed`, `feedback`, `answered`, `fixed`,
`merged`, `escalated`, `note`. Without `orchestrator.reply` the server stores the agent's last
reply; its `<report>` block is parsed out with the delivery's parser. With `quickMessageId`, the
summary becomes that quick message's ack (`quickStatus` sets its state; it keeps the current one,
`ok` while pending). Entries go to `plugin-data/power-workboard/reports/YYYY-MM-DD.jsonl`, kept as
long as the history. The board's own history (created, moved, started, report, merged...) shows
on the page even when the Project Manager records nothing: an event up to 2 minutes after an entry, or
up to 15 minutes before it, folds into the nearest such entry, an entry of its own kind first (a
continue into a `feedback` entry). Every event records `by` (`user`, `assistant` or
`orchestrator`): what the user did by hand never folds into an assistant entry and its row says
"you". Events from before `by` keep the old rule for creates and moves (2 minutes). The rest are
automatic rows. The server caches each parsed day file by mtime and size, so the page's polling
re-reads only the day being written.

See [CHANGES.md](../../CHANGES.md#power-workboard-a-board-of-registered-tasks-with-an-agent-orchestrator)
for the full description.

```sh
npm ci
npm run check
paseo plugin install "$PWD" --home ~/.paseo
```
