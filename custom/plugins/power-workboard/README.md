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

Groups: Backlog, Ready to start, In progress, Ready to review, Done, on `pwb:*` workspace labels.

Each orchestrator is stored in `orchestrators` (`shared/model.ts`, `orchestratorConfigSchema`);
schedules are in `shared/schedule.ts`. `orchestrator` holds the defaults new orchestrators start
from (`claude/claude-opus-5-5`, `bypassPermissions`, `medium`, worktree) and `refineModeId`
(`default`) for refinement chats, with no UI yet.

See [CHANGES.md](../../CHANGES.md#power-workboard-a-board-of-registered-tasks-with-an-agent-orchestrator)
for the full description.

```sh
npm ci
npm run check
paseo plugin install "$PWD" --home ~/.paseo
```
