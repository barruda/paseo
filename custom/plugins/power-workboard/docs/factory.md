# Factory as code, worker roles and pipelines

Status: approved design. Built so far: tickets 1 (task descriptions in files), 3 (attempts and
orchestrator logs in JSONL), 2 (schemas, loader, compiler and `bin/factory`), 4
(`bin/factory export`) and 6 (pipelines and roles), ticket 5 (revision stamps), ticket 7
(shadow mode: the board loads and diffs the factory, applies nothing), ticket 8 (the read-only
Pipelines tab), ticket 9 (active mode; the live cutover waits for the user), ticket 10 (the UI
writes the factory), ticket 11 (the pipeline engine), ticket 12 (PM transitions and the
autonomy presets) and ticket 13 (the review policy and the refinement flow replaced). Tickets at
the end. Inspired by Warp Factories
(https://docs.warp.dev/factories/), adapted to one local board with no cloud.

The board's configuration moves out of `workboard-data.json` into a git repository of YAML and
Markdown files: the **factory**. Workers (today's orchestrators) get a **role**, and each project
declares a **pipeline** of stages with gates. A visual editor in the board edits pipelines.

Why: every task run records the factory revision and the worker's config hash, so metrics can
compare autonomy, time and cost before and after a prompt or model change. Config changes get a
diff and a history. Scorers and automations get a place to live later.

## Decisions

| Decision            | Choice                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| Location            | One git repository, `~/.paseo/factory` by default (plugin setting `factory.root`)    |
| Source of truth     | The files. The UI keeps editing: it writes the file and commits `ui: <what changed>` |
| Invalid file        | The board keeps the last valid config and shows the error (file, line, message)      |
| Format              | YAML, and Markdown with YAML frontmatter. Parse with the `yaml` package              |
| Unknown keys        | Error (strict schemas), so a typo never passes silently                              |
| Ids                 | The folder or file name (`workers/paseo` → `paseo`), not UUIDs                       |
| Project reference   | `path:` of the checkout, resolved with realpath at load, never a `prj_…` id          |
| Worker memory       | Stays in `workers/<id>/memory/`, listed in `.gitignore`: the agent writes it         |
| Projects per worker | One (`project:`), as today; `null` takes projects with no worker of their own        |
| Rollout             | `factory.mode`: `off` (today) → `shadow` (load and diff, apply nothing) → `active`   |

## Layout

```
~/.paseo/factory/
  factory.yaml                    name, schema version, defaults
  board.yaml                      columns, pools, night, housekeeping
  pm/worker.md                    the Project Manager: frontmatter + system prompt
  pm/skills/<name>/SKILL.md
  workers/<id>/worker.md          a worker: frontmatter + system prompt
  workers/<id>/task-prompt.md     optional: text that opens every task (today's `instructions`)
  workers/<id>/skills/<name>/SKILL.md
  workers/<id>/memory/            git-ignored
  workers/<id>/.claude-plugin/    git-ignored; active mode writes the Claude plugin manifest
  projects/<id>.yaml              path, delivery, tests gate, pipeline
  pipelines/<id>.yaml             stages, gates, transitions, editor layout
  roles/<role>.md                 default stage prompt per role
  skills/<name>/SKILL.md          skills every worker may use
  templates/spec.md               spec template (per project override in projects/<id>.yaml)
  scorers/ automations/           reserved, rejected with "not supported yet" if present
  .schema/*.json                  generated JSON Schema for editor completion
  .gitignore
```

## factory.yaml

```yaml
# yaml-language-server: $schema=.schema/factory.json
schemaVersion: pwb/v1alpha1
name: bruno-local
description: Personal board, all projects
defaults:
  worker:
    model: claude/claude-opus-5-5
    thinking: medium
    permission: full # full | a provider mode id
    autoAccept: true # feature providers (OpenCode, Cursor...)
    workspace: worktree # worktree | folder
    maxConcurrent: 2
    batchSize: 5
    maxCheckpoints: 5
    memory: true
    skills: all # all | [names]
  delivery:
    action: review # review | prepare-pr | notify | nothing (merge is never a default)
  pipeline: default
```

## board.yaml

```yaml
columns: # order on screen
  - { id: backlog, kind: todo }
  - { id: scheduled, kind: scheduled, color: teal }
  - { id: ready, kind: ready, name: Ready to start }
  - { id: in-progress, kind: in-progress }
  - { id: review, kind: review, name: Ready to review }
  - { id: done, kind: done }
pools:
  - { id: unity, name: Unity Editor, maxConcurrent: 1, minFreeRamPercent: 20 }
night:
  { start: "22:00", end: "06:00", shutdownWhenDone: false, shutdownCommand: "" }
housekeeping:
  autoArchive: true
  archiveAfterDays: 0
  pinInProgressWorkspaces: true
  tmpCleanup: { path: /home/bruno/uprojects/tmp, maxAgeHours: 24 }
```

A column's `label` (`pwb:*`) is optional and defaults as today.

## workers/<id>/worker.md

```markdown
---
name: Paseo # shown in the board; defaults to the id
description: Implements paseo tickets on the custom branch
role: implement # triage | spec | implement | verify | review
project: paseo # id of projects/*.yaml; null = projects with no worker of their own
priority: 10 # lower takes tasks first (default 0, ties by id); replaces the list arrows
enabled: true
model: claude/claude-opus-5-5
thinking: high
permission: full
workspace: worktree
maxConcurrent: 2
batchSize: 5
maxCheckpoints: 5
pool: null # id from board.yaml pools
schedule: automatic # automatic | manual | { window: {...} } | { daily: {...} }
skills: [paseo-customizations, paseo]
memory: true
---

System prompt (today's profile `system-prompt.md`).
```

A worker with no `role` is an implement worker, as every orchestrator is today.

`schedule` forms: `automatic`, `manual`, `{ window: { days: [1,2,3,4,5], start: "09:00", end:
"18:00" } }`, `{ daily: { days: [...], times: ["08:00"] } }`. An omitted field inherits
`defaults.worker`, then today's orchestrator default. A worker whose project is inactive is left out.

## pm/worker.md

```markdown
---
role: foreman
enabled: true
model: claude/claude-opus-5-5
thinking: high
permission: full
skills: all
memory: true
wake: { onNeedsYou: true, delaySeconds: 12 }
compactAtTokens: 180000
interactivePermission: default # spec stages run interactively ask before edits
autonomy: standard # autonomous | standard | cautious; see "Autonomy presets"
---

Project Manager system prompt.
```

## projects/<id>.yaml

```yaml
path: ~/projetos/paseo
pipeline: default # id of pipelines/*.yaml
autonomy: standard # optional; overrides the pipeline's and pm/worker.md's
delivery:
  action: review
  observe: false
  baseBranch: custom
  verifyCommand: "npm run typecheck && npm run lint"
  autoFixes: 1
tests:
  gate:
    command: ""
    setup: ""
    requiredEnv: []
    env: {}
    runIn: worktree
    riskPaths:
      ["**/migrations/**", "**/auth/**", "**/security/**", "**/protocol/**"]
templates:
  spec: templates/spec.md
```

A project with no file uses `defaults`, and so does one with neither `delivery` nor `tests`: it
gets no project policy, as today. `path` takes `~/`; a relative path starts at the factory root. A
`path` that does not resolve, or that Paseo has no project for, is a warning and the project stays
inactive.

## pipelines/<id>.yaml

A pipeline is a set of stages. A task enters at `start` when it leaves Ready, and the board keeps its
current stage on the task. The columns stay as they are: a running stage is In progress, a gate is
Needs you with reason `gate`, and Done comes after `deliver`. The card shows a stage chip
(`spec · gate`, `implement 2/3`).

```yaml
description: Critical projects (DreamMMO)
autonomy: standard # optional; overrides pm/worker.md's for the projects on this pipeline
start: triage
stages:
  triage:
    role: triage
    to:
      - stage: spec
        when: The ticket is large, ambiguous, or changes visible behavior.
      - stage: implement
        when: The ticket is small and clear.
  spec:
    role: spec
    gate:
      question: Approve this spec?
      options:
        - { id: approve, label: Approve, to: implement }
        - { id: changes, label: Request changes, to: spec }
  implement:
    role: implement
    to: verify
  verify:
    role: verify
    to:
      - stage: review
        when: Every check passed, with evidence.
      - stage: implement
        when: A check failed.
  review:
    role: review
    session: fresh # a new agent, never the author
    to:
      - stage: deliver
        when: No blocking findings.
      - stage: implement
        when: Blocking findings remain.
layout: # editor positions only; the engine ignores it
  triage: { x: 0, y: 0 }
```

Stage fields:

| Field           | Meaning                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `role`          | Which worker runs it. `pm` makes the Project Manager run it (today's self review)                                         |
| `worker`        | Optional: pin one worker. Otherwise the project's worker with that role, else its implement worker with the role's prompt |
| `prompt`/`file` | Stage procedure. Defaults to `roles/<role>.md`                                                                            |
| `session`       | `continue` (default: the role's last agent on this task continues) or `fresh`                                             |
| `gate`          | After the stage, ask the user. Each option names its next stage, so the board advances with no PM turn                    |
| `to`            | A stage id (the board advances), or a list of `{stage, when}` (the PM chooses)                                            |
| `maxVisits`     | Default 3. One more visit sends the task to Needs you as `loop`                                                           |

A stage has `to` or `gate`, never both, and `prompt` or `file`, never both. A `spec` stage gets
the project's spec template (`templates.spec`, else `templates/spec.md`) after its prompt.

Built-in stage ids: `deliver` (runs the project's `delivery`), `end` (Done with no delivery) and
`cancel`. Transition rules:

1. A single `to` advances with no PM turn.
2. A gate option advances to its `to` with no PM turn.
3. A list of `when` conditions wakes the PM with the stage's `<report>` and the candidates. The PM
   calls `board_pipeline_advance` with the stage and a reason. **If no condition fits, it calls
   `board_pipeline_ask` (a Decisões proposal) and never picks a stage on its own.**

The loader rejects, with the file and line: a `start`, `to`, `when` stage, gate option or `layout`
key that names no stage and no built-in; `start` or a stage id that is a built-in; a gate option
without `to`; a stage no transition from `start` reaches; a pinned `worker`, a `file` or a
`roles/<role>.md` that does not exist; a `pipeline:` (project or `defaults`) with no file; and a
project whose workers have neither the stage's role nor `implement`. A project no worker takes is
not checked: it runs nothing, as today. The checks inside one file run in `pipelineFileSchema` (rules
in `shared/factory/pipeline.ts`), so the editor gets them from the schema. `roles/` takes only
`<role>.md` for the five roles and `pm`.

Built-in pipelines that the export writes. They live in `server/factory/builtin/` with the five
role prompts, `templates/spec.md` and the factory's `README.md`; `readBuiltinFactoryFiles()`
(`server/factory/builtin.ts`) returns them plus the `.gitignore`, and is the export's only source.

- `default`: `implement → review (role: pm, file: roles/review.md) → deliver`. This is the old
  review policy `self`.
- `critical`: `triage → spec (gate) → implement → verify → review (fresh) → deliver`. This replaces
  the review policy `fresh-agent`.

The review policy is gone: a project is critical when its pipeline is `critical`. The live JSON
still holds the old map (`assistant.settings.reviews`), read only and tagged
`COMPAT(factory-pipelines)` until the cutover: the export maps its `fresh-agent` projects (DreamMMO,
DreamMMO-android) to `critical` and the rest to `default` (`legacyPipelineFor` in
`shared/factory/builtin-pipelines.ts`), and outside active mode it gives each project the pipeline
the export would, so those projects stay critical before the cutover. Nothing writes it: the
settings page lost its Review select, a save keeps the stored map, and `board_set_project_policy`
has no `review`.

Spec and Refine: a draft's **Refine** button runs the project's `spec` stage interactively, in a
chat with the user, on the worker that runs that stage and with `interactivePermission`. A pipeline
with no `spec` stage, and a board outside active mode, use the `spec` role prompt and the project's
spec template (the built-in ones off active mode: the bundle cannot read `server/factory/builtin/`,
so `shared/factory/builtin-spec.ts` holds copies a test keeps equal). `/write-ticket` writes the
stage's output, the spec, into the ticket's title and description. The chat is still recorded in
`data.refinements`; Refine does not move `task.pipeline`, so a `critical` task still runs its own
`spec` stage after it leaves Ready.

## Loading and revisions

- The daemon plugin reads the factory at start and on file changes (watch, 500 ms debounce),
  validates with Zod, resolves references (project paths, pools, skills, workers, stages) and
  compiles to the structures the engine already uses (`orchestratorConfigSchema`,
  `projectPolicySchema`, `settingsSchema`, `assistantChatSettingsSchema`).
- The setting is `assistant.settings.factory` (`root`, `mode`), in Settings > Bruno's
  Customizations > Project Manager > Factory. It stays in the JSON in every mode.
- `shadow` mode applies nothing and reports the diff between the compiled factory and the live
  config. `active` mode applies it, and the JSON stops being read for these fields (see "Active
  mode").
- The watcher is one non-recursive `fs.watch` per folder the loader reads, plus `.git` for
  commits; `memory/` is skipped because agents write there. Do not switch to recursive
  `fs.watch`: on Linux it watches every file (see `docs/file-observation.md` at the repo root).
  New folders are picked up after the next load. Git runs with `--no-optional-locks`; without it,
  `git status` rewrites `.git/index` and every load would trigger the next one.
- The diff uses the factory's ids. Live orchestrators and pools map through `.factory-ids.json`,
  or through name slugs when the file is missing, so a renamed worker shows as one worker missing
  and one extra. The default task prompt of new orchestrators is not compared (the factory has no
  place for it). Profile prompts are read on each diff; a prompt edit shows on the next status
  call or data change, since it does not bump the data revision.
- RPC `workboard.factory.status`: mode, root, revision, errors, warnings, diff (at most 200 entries
  plus the count). Every board snapshot carries the summary, and the board and the Orchestrators
  tab show "factory: shadow, N differences" (in active mode "factory: active, revision abc1234")
  and the first error. In active mode the diff still compares against the JSON, which the board no
  longer reads; after the cutover it shows what the JSON would bring back if you left active.
- **Revision**: git `HEAD`, plus `+dirty.<content hash>` with uncommitted changes. Each new
  orchestration and each history event records `factoryRevision`, `workerId` and
  `workerConfigHash` (a stable hash of the compiled worker config, its prompt and task prompt).
  The stamp is taken when an agent starts (a new run, or a new agent for a continued task); a
  continuation that reuses the live agent keeps it, and history events copy their run's stamp.
  In active mode the stamp is the factory's revision, the worker's factory id and
  `compiledWorkerConfigHash`; in the other modes the revision is null and the hash comes from the
  live orchestrator and its profile's `system-prompt.md`. The hash covers only what changes the agent's work (model,
  permission, thinking, workspace, prompts, skills, memory, checkpoints, role), so a schedule,
  name or id change keeps it and the same config hashes alike under a UUID and a slug
  (`server/factory/stamp.ts`).
- Validation outside the app: `bin/factory validate [dir]` (default `$PASEO_HOME/factory`) prints
  `file:line: message [kind]` and exits 1 on any error. `bin/factory schema [dir]` writes
  `.schema/*.json` with `z.toJSONSchema` from the same schemas. Code: `shared/factory/` (schemas,
  compiler) and `server/factory/` (loader, CLI).
- Skill names in `skills:` are not resolved: they may be personal or plugin skills outside the
  factory.
- UI edits in `active` mode go through the writer; see "Active mode".

## Active mode

- **Overlay, not a copy.** `Store.setView` (`server/factory/shadow.ts` `factoryStoreView`,
  `shared/factory/active.ts`) puts the last valid compile into every `store.current`: orchestrators,
  orchestrator defaults (all but the default task prompt), the factory-owned `settings` fields
  (columns, pools, housekeeping), `night`, and `assistant.settings` `enabled`, `defaultAction`,
  `projects` and `chat`. Every `store.update` puts the JSON's own values back before saving, so
  `workboard-data.json` keeps its pre-cutover config and going back to `shadow` or `off` is
  instant and loses nothing. Keep any new factory-owned field in both `applyFactory` and
  `restoreJsonConfig`, or the board saves the factory's value into the JSON.
- **Ids.** Workers and pools run under the id the live board knew them by: `factoryIds` (live id →
  factory id) maps them back, so running tasks, orchestrator runtime and logs stay theirs. Each
  load adds the `.factory-ids.json` entries the data lacks to `factoryIds`; the data's entries
  win, also when two live ids map to the same worker (an orchestrator recreated under the same
  name before a new export): the older live id keeps it. Without the file, the name slugs the diff
  uses stand in. A worker with no live id runs under its factory id.
- **A worker leaves the factory while its task runs.** Its live id is gone from the orchestrators,
  so the task's rework and checkpoint resume go to the project's first orchestrator (`owns()`),
  and log lines for the old id are dropped. Put the worker back under the same factory id and the
  task goes back to it, with its old log.
- **Profiles** come from the factory: a worker's prompt is its `worker.md` body, its folder
  `workers/<id>/` (own skills, `memory/`), its Claude plugin `pwb-<id>`; the Project Manager's is
  `pm/` as `pwb-assistant`. The board writes `.claude-plugin/plugin.json` and `memory/` there; both
  are git-ignored, so they never make the revision dirty. A prompt edit in the UI goes through the
  writer into the body of `worker.md`.
- **Boot.** `Workboard.start` waits for the factory's first load after the scan (the compile
  needs Paseo's projects) and before the first orchestration. With no valid compile yet (missing
  folder, invalid from the start) the board starts no task (`startReady` returns) and the line
  says so; tasks already running go on. An invalid file later keeps the last valid compile, and
  stamps and the line keep its revision, not the newer broken one. board.yaml without a ready or
  scheduled column is a warning: the board adds them to the JSON's columns, never to the factory's.
- **The UI writes the factory.** A user's config edit is a store write marked `factory`
  (`CONFIG_EDIT` in `server/workboard.ts`: the orchestrator mutations but run and stop, pools,
  night, columns and housekeeping, `orchestrator-defaults`, the PM settings, and so the PM's
  `board_set_project_policy` and `board_set_default_action`). The store view turns it into file
  edits before saving (`factoryStoreView` → `FactoryShadow.writeConfig`): each file's projection
  (`shared/factory/to-files.ts`, which the export writes too) is diffed before and after, and only
  the keys that changed are written (`shared/factory/edits.ts`), so inherited keys stay inherited.
  `server/factory/writer.ts` edits through the `yaml` Document API (comments, quotes and key order
  stay), loads and compiles the result (an invalid one is undone and the edit fails), commits
  exactly the files it touched as `ui: <file> <keys>`, and loads the factory before the reply. A
  write the board does on its own (column repairs, bookkeeping) is not marked and never reaches the
  factory. Other writes of the same save (task changes) still go to the JSON.
- **Conflicts.** The edit runs on the compile the board showed: when the factory on disk is not
  that revision (a file changed, whether or not the debounce has loaded it), the board loads it
  and refuses the edit with "The factory changed on disk and was loaded again". A factory with
  errors refuses edits until its files are fixed. A factory outside git has no revision, so only a
  load that already happened is caught there. A failed load or commit puts the files back.
- **Ids of new things.** A new worker or pool gets a slug of its name (`-2` on repeats, never an id
  `.factory-ids.json` or `factoryIds` already uses) and keeps the board's id through `factoryIds`.
  A new worker is appended with the next `priority`; moving workers numbers them again in steps of 10. A project the factory has no file for gets `projects/<slug>.yaml` with its `path`.
  Removing a worker deletes its files; what the `.gitignore` keeps out (`memory/`,
  `.claude-plugin/`) moves to `plugin-data/power-workboard/factory-removed/<id>-<time>/`.
- **Any key.** `FactoryShadow.writeKeys(file, keys)` sets top-level keys of a YAML file or of a
  Markdown frontmatter, and null removes one; it needs no code per field, so a new field (such as
  `autonomy`) only needs its schema. The load after the write still validates it.
- The Pipelines tab reads the factory's `pipelines/` and each project's `pipeline:`.

## Pipeline engine

The engine runs in active mode with the Project Manager on. Otherwise a task runs today's way and
its `task.pipeline` is left as it was. Code: `shared/factory/engine.ts` (state and transitions) and
the "pipeline engine" block of `server/workboard.ts`.

- **State.** `task.pipeline`: pipeline id, stage, visits per stage, the last agent per role,
  `pending`, the open gate and a history of 50 entries. A new run from Ready starts it at `start`.
- **Who runs a stage.** A stage a transition entered (`pending`), and any running stage whose
  role is not implement, goes to its runner (`stageRunner`): the pinned worker, the project's
  worker with the role, else its implement worker. An implement stage that pins no worker goes
  where every task goes today (the task's chosen orchestrator, the project's first one, pools), so
  `default` picks the same worker as before. The orchestrator the user chose for the task also
  takes a stage whose role has no worker in the project, which would otherwise fall back to the
  first implement worker. A task back in Ready starts over at `start`.
- **Prompt.** A stage run gets the stage procedure, the spec template for `spec`, and what the
  user said at the gate. The run that starts the pipeline from Ready leaves out the procedure of an
  implement stage with no `prompt` or `file`: the worker's task prompt is today's procedure.
- **Transitions.** A single `to` to a worker stage queues the task: it stays In progress and the
  next pass runs the stage, like a checkpoint resume (no batch quota). A gate opens a Decisões
  proposal with its options and puts the task in Needs you (`gate`); deciding an option advances
  the task, and an answer with no option is refused. A `when` list puts the task in Needs you
  (`gate`) with no card (`gate.cardId: null`), and the wake carries the stage's report and the
  candidates. The PM calls `board_pipeline_advance` (a candidate whose condition fits; any other
  stage is refused, and the move is recorded as a `moved` report) or `board_pipeline_ask` (a
  Decisões proposal whose options are candidate stages). A `pm` stage and `deliver`
  hand the report to today's delivery with the project's action (`review` is the PM's review).
  `end` marks it delivered and moves it to Done; `cancel` dismisses it and moves it to Canceled
  when the board has that column.
- **Loop guard.** Entering a stage once past its `maxVisits` keeps the task where it was and sends
  it to Needs you (`loop`); Continue there gives that stage a new budget, and a task that looped
  on its own stage counts the run Continue starts as visit 1. A `pm` stage has no guard: today's
  review decides how many rounds it takes. Reviewer feedback on a task in a `pm` stage or
  `deliver` sends it back to its last implement stage (the last one that changed code) and counts
  a visit there; one past that stage's `maxVisits` starts a new budget (`implement 1/3`), since
  the reviewer's answer is never a loop and `default` keeps today's unlimited review rounds.
- **Answering.** A gate is the user's, and so is a stage choice once the PM asked: the Project
  Manager is not woken for it, and a PM decision on its card is refused. Any way
  the card gets decided needs one of its options, and archiving it while the task waits is
  refused. Done or Continue on the board archives the open
  proposal; Continue runs the current stage again with the feedback. A gate decided after the task
  left Needs you some other way only closes the gate.
- **Leaving active mode.** The engine stops and `task.pipeline` is kept. Each open gate closes and
  its Decisões proposal is archived with a note (`GATE_CLOSED_NOTE`); so does a `when` list's
  choice, whether it waited on the PM or on a `board_pipeline_ask` card. The task stays in Needs you,
  where Continue and Done work as today, and the Project Manager hears about it. A stage left
  `pending` runs as a plain continuation and stops being pending.
- **Back in active mode.** A task resumes from the stage it kept, with its visits: its next report
  follows that stage's exit. A task whose gate closed is still in Needs you; Continue runs the
  stage again and its report opens the gate, or the PM's choice, anew. A task that started while active was off has no
  pipeline and runs today's way until it starts again from Ready, which starts it at `start`. A
  task whose pipeline is gone from the factory also runs today's way.
- **Chip.** The card shows `card.stageChip` (`spec · gate`, `implement 2/3`, `review 4` for a
  `pm` stage) next to its number, except in Done and Canceled.

## Autonomy presets

What the Project Manager decides alone and what goes to the user is data in `shared/autonomy.ts`,
not prompt text. The wake's line per task, `CHAT_RULES`, the seed prompt and the descriptions of
`board_pipeline_ask` and `pm_card_create` are generated from it; `tests/factory-autonomy.test.ts`
fails when a text stops matching the data.

| Preset                  | The user decides                                             | Breaker |
| ----------------------- | ------------------------------------------------------------ | ------- |
| `autonomous` (Autônomo) | product decisions, actions with no backup and no revert      | 15 min  |
| `standard` (Padrão)     | the above, plus the merge ok of a critical project           | 15 min  |
| `cautious` (Cauteloso)  | the above, plus every merge and every migration of live data | off     |

Everything else is the PM's: merging after an approved review, a data migration with a backup made
first, a plugin reload, a config change with a copy.

- **Resolution.** `projects/<id>.yaml` > its `pipelines/<id>.yaml` > `pm/worker.md` > `standard`.
  A project with no file takes `defaults.pipeline`'s. Outside active mode every project is
  `standard`. The compiled worker hash carries its project's preset, except `standard`, so hashes
  from before presets stay valid.
- **Critical project.** Its pipeline is `critical`: the factory's in active mode, the legacy map's
  outside it (see "pipelines/<id>.yaml"). `Workboard.requiresUserMergeOk(projectId)` reads it and
  the preset. The export writes `autonomy: standard` into `pm/worker.md` and no project override:
  `standard` with `critical` leaves the merge to the user, `standard` with `default` leaves it to
  the PM, as the old `fresh-agent` and `self` did.
- **Refusals.** `pm_card_create` (`userOnlyReason`) and `board_pipeline_ask` (`reason`) refuse a
  reason the project's preset leaves to the PM. `board_pipeline_ask` also takes `no-fit`, which the
  choice rule always allows. A card stores its `userOnlyReason`. The merge ok of a critical project
  is `critical-merge`; the old name `fresh-agent` is still read, from stored cards and from the
  tools, as `critical-merge` (`storedUserOnlyReasonSchema`, `COMPAT(factory-pipelines)`).
- **Breaker.** `breakerMinutes` and `autonomyBreakerMs()` hold each preset's deadline. The breaker
  itself (a proposal left waiting wakes the PM to decide it) belongs to the "PM decides on its own"
  task, which reads this data; it must skip a card that holds an open pipeline gate or choice,
  since only the user answers those.

## Cutover

The PM asks the user first (a Decisões proposal), then runs these on the main checkout. Nothing
here changes the board until step 5.

1. Back up the data:
   `cp ~/.paseo/plugin-settings/power-workboard/workboard-data.json{,.bak-pre-factory}`.
2. Export: `custom/plugins/power-workboard/bin/factory export ~/.paseo/factory` (the folder must be
   missing or empty). Read its warnings: what it leaves out stays in the JSON or is lost in active.
3. Copy the memory: `bin/factory memory ~/.paseo/factory`. It copies each profile's `memory/` to
   `workers/<id>/memory/` and `pm/memory/` through `.factory-ids.json`, never overwrites, and
   leaves the profile folders in place.
4. Check: `bin/factory validate ~/.paseo/factory`, then Settings > Bruno's Customizations >
   Project Manager > Factory set to **Shadow**: the board shows "factory: shadow, 0 differences".
   Anything else is a difference the export got wrong; fix it before going on.
5. Switch the same setting to **Active**. The board shows "factory: active, revision …", the
   Orchestrators tab and the column settings save to the factory's files with a `ui:` commit, and
   `factoryIds` gets the id map.
6. Watch the next task start: its run records `factoryRevision` and the worker's factory id
   (`board_get_task`), and its agent gets the worker's prompt from `worker.md`.

To undo, set the mode back to Shadow or Off: the board reads the JSON again at once. Memory written
in active mode stays in the factory. A task in a column only board.yaml has moves to the JSON's
default column (To do for a draft, the default start column for a task with a workspace), and
`daemon.log` gets a warning per task; a workspace keeps the factory column's label.

## Migration

`bin/factory export <dir> [--data <file>] [--profiles <dir>] [--projects <file>]` writes the
factory from `workboard-data.json`, the profile folders and Paseo's `projects.json` (defaults: the
live files under `$PASEO_HOME`, only read), adds the built-in files (pipelines, role prompts, spec
template, README, `.gitignore`), validates
the result and only then runs `git init` and commits. `<dir>` has no default and must be missing or
empty, so no call writes the live factory by accident. Worker ids become slugs of their names
(`-2` on repeats), and so do project and pool ids. The map goes to `.factory-ids.json` (git-ignored);
active mode copies it into the runtime state (`factoryIds`), so running tasks keep their worker.
The export copies no profile memory; `bin/factory memory` does, as a cutover step.

What the export cannot carry, it reports as a warning and leaves out: orchestrators and policies of
a project Paseo no longer has, the default task prompt of new orchestrators, a profile skill without
a valid SKILL.md, and the default-column preferences (`defaultDraftGroup`, `defaultStartGroup`,
`defaultStartWorkGroup`), which stay in the JSON. Two Paseo projects may share a checkout (one path a
symlink to the other); the export resolves the path to the project the data names, and so does the
loader in shadow and active mode (`projectResolver` in `server/factory/shadow.ts`).

The live export and the switch to `active` need the user's approval (a Decisões proposal). Worktree
agents never write to `~/.paseo`.

## What stays in workboard-data.json

Runtime state only: tasks, `nextTaskNumber`, orchestrations, finishes, orchestrator runtime,
night runtime, Decisões (`pmBoard`), packages and their runs, card order, pins, `factoryIds`. Task
descriptions, `assistant.attempts` and `orchestratorLogs` move to their own files (tickets 1 and 3).

## Pipeline editor

A **Pipelines** tab in the board's tab bar, with a project picker. It draws the project's pipeline
as a graph: stages as nodes (role, worker, gate marker), transitions as edges labeled with their
`when`, built-in `deliver`/`end`/`cancel` as terminal nodes. A side panel edits the selected stage.
Validation runs live with the same schemas. Save writes `pipelines/<id>.yaml` through the factory
writer, including `layout`. On phones the tab shows the stages as a read-only list.

Live overlay (`pipelineOverlay` in `client/pipeline-view.ts`): each node shows how many of the
project's tasks are in that stage and how many wait on its gate or `when` choice; the stage panel
(the card on phones) lists them, and a task opens its ticket in the board's side panel, which
switches to the Board tab because only that tab renders the panel. It reads `task.pipeline` from
the board's own polling. A task counts while its card shows the stage chip, so tasks in Done or
Canceled, tasks the engine does not run and tasks outside active mode count nowhere. Tasks in a
draft column and archived tasks are left out too: a run from Ready starts over at `start`.

Drawing: the graph is plain React Native Views, with no SVG and no graph library. The plugin
client gets only React, React Native, zod, react-query and the SDK from the host
(`runtimeRequire` in `packages/app/src/plugins/evaluate.ts`). A pure-JS package from the plugin's
`node_modules` would bundle, but `react-native-svg` is a native module: a bundled copy would register
its native views a second time, and the host does not hand its own copy to plugins. So
`client/pipeline-layout.ts` does the layout itself and routes every edge orthogonally: stages in rows
by longest path from `start`, an edge to the next row straight down, a skip in a lane on the right, a
back edge in a lane on the left, a self loop on the node's right side. The view draws each segment as
a thin View and the arrowhead as a border triangle. A `layout` that places every node replaces the
rows; one that misses a node is ignored. A layered layout library such as dagre would bundle if the
hand-made one stops being enough.

Source: RPC `workboard.factory.pipelines.get`. In active mode it answers with the factory's
`pipelines/` and each project's `pipeline:` (`factoryPipelinesView`). Otherwise it answers with the
built-in pipelines (`shared/factory/builtin-pipelines.ts`, kept equal to
`server/factory/builtin/pipelines/` by a test) and gives each project the one the migration would:
`critical` for a `fresh-agent` project in the legacy review map, else `default`. The worker shown on a node is the
project's orchestrator, taken as an implement worker.

## Tickets

Project `paseo`, worker `paseo`. Every ticket links this file. A ticket waits in Backlog until the
tickets it depends on are merged.

| #   | Ticket                                     | Depends on | Notes                         |
| --- | ------------------------------------------ | ---------- | ----------------------------- |
| 1   | Task descriptions out of the JSON          | none       | wave 1                        |
| 2   | Factory schema, loader, compiler, validate | none       | wave 1                        |
| 3   | Attempts and orchestrator logs to JSONL    | 1          |                               |
| 4   | Factory export and round trip              | 2          |                               |
| 5   | Revision stamps on runs and history        | 2          |                               |
| 6   | Roles and pipeline schema                  | 2          |                               |
| 7   | Shadow mode                                | 4          |                               |
| 8   | Pipeline editor: read-only graph           | 6          | starts with a rendering spike |
| 9   | Active mode and cutover                    | 7, 6       | live cutover needs user gate  |
| 10  | UI writes the factory                      | 9          |                               |
| 11  | Pipeline engine                            | 9          |                               |
| 12  | PM transitions                             | 11         |                               |
| 13  | Replace review policy and Refine           | 12         |                               |
| 14  | Pipeline editor: editing                   | 8, 10      |                               |
| 15  | Pipeline editor: live overlay              | 8, 11      |                               |

### 1. Task descriptions out of the JSON

`description` is 385 KB of the 790 KB `workboard-data.json`. Store each task's description in
`plugin-data/power-workboard/tasks/<taskId>.md` (write to a temp file, then rename). Keep a
`descriptionLength`/revision on the task. The board snapshot stops carrying descriptions; the
ticket panel, editor, board tools (`board_get_task`, `board_list_tasks`, `board_update_task`,
`board_create_task`), orchestrator prompts and refinement read through one accessor with a cache.
A migration moves existing descriptions and keeps them readable if it is interrupted (the JSON
copy is removed only after the file is written). Images in descriptions keep working.
Acceptance: the JSON drops by about 385 KB; creating, editing, reading and starting a task work;
migration test with an interrupted run; tests for the accessor.

### 2. Factory schema, loader, compiler, validate

Pure code under `shared/factory/` and `server/factory/`, no behavior change. Zod schemas for every
file in "Layout" (strict), a frontmatter parser, a loader that reads a directory into a typed
factory plus a list of errors with file and line, and a compiler that turns it into today's
structures. `bin/factory validate [dir]` prints errors and exits non-zero. A script generates
`.schema/*.json` with `z.toJSONSchema`. `scorers/` and `automations/` present → error "not
supported yet". Acceptance: fixture factories (valid, each error kind) with tests; compiled
output matches today's schemas.

### 3. Attempts and orchestrator logs to JSONL

Move `assistant.attempts` (116 KB) and `orchestratorLogs` (49 KB) out of the JSON: append-only
`plugin-data/power-workboard/attempts/YYYY-MM-DD.jsonl` and `orchestrator-logs/<orchestratorId>.jsonl`,
with the recent tail kept in memory for the UI and the PM's tools. Migration as in ticket 1.
Acceptance: the orchestrator tab log, the attempt-driven behavior (delivery retries, Reports) and
the PM tools still read the same data; tests.

### 4. Factory export and round trip

`bin/factory export [dir]` per "Migration": reads `workboard-data.json` and the profile folders,
writes the factory with `default` and `critical` pipelines and `roles/*.md`, runs `git init` and
commits. Writes to the given directory only; never touches `~/.paseo` in tests. Acceptance: a round
trip test (export → load → compile) gives the same config as the source data, ids aside; the
UUID → slug map is produced.

### 5. Revision stamps on runs and history

Add optional `factoryRevision`, `workerId` and `workerConfigHash` to orchestrations and history
events. With the factory `off` or `shadow`, the hash comes from the live config and the revision
is `null`. Acceptance: new runs and events carry the fields; old data still parses; tests for the
stable hash (same config, same hash; one prompt character changed, new hash).

### 6. Roles and pipeline schema

Add `role` to workers and the `pipelines/*.yaml` schema from this file to the factory schemas and
compiler: stage fields, built-in `deliver`/`end`/`cancel`, reference checks (unknown stage, role
with no worker and no implement fallback, unreachable stage, gate option without `to`). Write the
`default` and `critical` pipelines and the five `roles/*.md` prompts (triage, spec with the spec
template, implement, verify with evidence, review) used by the export. No engine change.
Acceptance: fixtures and tests for each validation rule.

### 7. Shadow mode

Plugin setting `factory: { root, mode: off | shadow | active }` (default `off`, Settings > Bruno's
Customizations > Project Manager). In `shadow`, watch the root, load, compile and diff against the
live config without applying. RPC `workboard.factory.status` and a board banner with errors and the
diff count; the Orchestrators tab shows "factory: shadow, N differences". Acceptance: tests for
watch debounce, diff and the invalid-file case.

### 8. Pipeline editor: read-only graph

Start with a short spike: how can the plugin client draw a graph? Its client code can only import
host-provided modules (React, React Native, zod); check whether a third-party library can be
bundled or SVG is available, and write the choice in this file. Then add the **Pipelines** tab: a
project picker, the graph per "Pipeline editor" (auto layout when `layout` is missing), and a
read-only stage panel. Phones get the list. Acceptance: renders `default` and `critical`; logic
tests for the layout; the summary says where to click to see it.

### 9. Active mode and cutover

In `active`, the compiled factory is the configuration: orchestrators, project policies, PM chat
settings, columns, pools and night come from it, and profiles are read from `workers/<id>/` and
`pm/`. The UI settings for these fields become read-only with "edit in the factory" until ticket 10. `factoryIds` keeps running tasks on their worker. Write the cutover steps in this file. After
merge, the PM asks the user (Decisões) before running the export on `~/.paseo/factory` and
switching to `active`. Acceptance: integration test that boots the plugin in `active` from a
fixture factory and starts a task with the right worker settings.

### 10. UI writes the factory

In `active`, the Orchestrators tab, the Project Manager settings, Group settings, pools and night
settings write the factory through the writer (`yaml` Document API, comments kept) and commit
`ui: <what changed>`. A file changed on disk since it was read reloads with a message. The board's
PM tools that change config (`board_set_project_policy`, `board_set_default_action`) write the
factory too. Acceptance: tests that edit a commented YAML and keep the comments; commit created.

### 11. Pipeline engine

The task stores its pipeline state (pipeline id, stage, visits per stage, history). Leaving Ready
starts the pipeline at `start`. A stage runs on its worker by role (fallback: the project's
implement worker with the stage prompt), with `session: continue | fresh`. Single `to` and gate
options advance with no PM turn; a gate puts the task in Needs you with reason `gate` and creates a
Decisões proposal whose options are the gate's. `maxVisits` sends it to Needs you as `loop`.
`deliver` hands off to today's delivery. The card shows the stage chip. Projects with the
`default` pipeline behave as today. Acceptance: engine tests for each transition kind, the gate
and the loop guard; one test proves `default` keeps today's flow.

### 12. PM transitions

A stage whose `to` is a list of `when` conditions wakes the PM (same batching as Needs you) with
the stage's report and the candidates. New tools `board_pipeline_advance(taskId, stage, reason)`
and `board_pipeline_ask(taskId, question, options)`. The rule goes into the seed prompt,
`CHAT_RULES` and the tool description: pick a stage only when its condition fits, otherwise ask;
never finish silently. Each advance is recorded with `board_report` (`moved`). Acceptance: tests
that the rule is in all three places; an advance to a stage not in the candidates is refused.

### 13. Replace review policy and Refine

Remove the review policy (`settings.reviews`, `SEEDED_REVIEW_POLICIES`) and the separate
refinement flow: the export maps `fresh-agent` projects (DreamMMO, DreamMMO-android) to `critical`
and the rest to `default`; Refine runs the spec stage interactively and `/write-ticket` writes its
output to the ticket. Compatibility code is tagged `COMPAT(factory-pipelines)`. Update the README
and `custom/CHANGES.md`. Acceptance: tests for the mapping and the Refine path.

### 14. Pipeline editor: editing

Add, remove and rename stages; edit the selected stage (role, worker, prompt or file, session,
gate and its options, `when` transitions, `maxVisits`); connect stages by dragging from a node or
with a picker; move nodes (saved in `layout`). Live validation with the factory schemas; Save is
disabled while invalid. Save writes `pipelines/<id>.yaml` through the factory writer and commits.
Acceptance: logic tests for the edit model and the YAML it writes.

### 15. Pipeline editor: live overlay

Each node shows the tasks in that stage and the ones waiting on its gate; a click lists them and
opens a ticket in the side panel. Reads the task pipeline state with the board's existing
polling. Acceptance: logic tests for the counts.
