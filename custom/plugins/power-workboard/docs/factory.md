# Factory as code, worker roles and pipelines

Status: approved design. Built so far: tickets 2 (schemas, loader, compiler and `bin/factory`), 4
(`bin/factory export`) and 6 (pipelines and roles), not wired into the board, and ticket 5
(revision stamps). Tickets at the end. Inspired by Warp Factories
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
---

Project Manager system prompt.
```

## projects/<id>.yaml

```yaml
path: ~/projetos/paseo
pipeline: default # id of pipelines/*.yaml
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

- `default`: `implement → review (role: pm, file: roles/review.md) → deliver`. This is today's behavior and the review policy `self`.
- `critical`: `triage → spec (gate) → implement → verify → review (fresh) → deliver`. This replaces the review policy `fresh-agent`.

Spec and Refine: a draft's **Refine** button runs the project's `spec` stage interactively (or the
`spec` role prompt when the pipeline has none), and `/write-ticket` writes that stage's output into
the ticket. The review policy (`settings.reviews`) and the separate refinement flow go away;
the migration maps `fresh-agent` projects to `critical`.

## Loading and revisions

- The daemon plugin reads the factory at start and on file changes (watch, 500 ms debounce),
  validates with Zod, resolves references (project paths, pools, skills, workers, stages) and
  compiles to the structures the engine already uses (`orchestratorConfigSchema`,
  `projectPolicySchema`, `settingsSchema`, `assistantChatSettingsSchema`).
- `shadow` mode applies nothing and reports the diff between the compiled factory and the live
  config. `active` mode applies it, and the JSON stops being read for these fields.
- RPC `workboard.factory.status`: mode, root, revision, errors, warnings, diff. A banner shows
  errors.
- **Revision**: git `HEAD`, plus `+dirty.<content hash>` with uncommitted changes. Each new
  orchestration and each history event records `factoryRevision`, `workerId` and
  `workerConfigHash` (a stable hash of the compiled worker config, its prompt and task prompt).
  The stamp is taken when an agent starts (a new run, or a new agent for a continued task); a
  continuation that reuses the live agent keeps it, and history events copy their run's stamp.
  Until active mode the revision is null and the hash comes from the live orchestrator and its
  profile's `system-prompt.md`. The hash covers only what changes the agent's work (model,
  permission, thinking, workspace, prompts, skills, memory, checkpoints, role), so a schedule,
  name or id change keeps it and the same config hashes alike under a UUID and a slug
  (`server/factory/stamp.ts`).
- Validation outside the app: `bin/factory validate [dir]` (default `$PASEO_HOME/factory`) prints
  `file:line: message [kind]` and exits 1 on any error. `bin/factory schema [dir]` writes
  `.schema/*.json` with `z.toJSONSchema` from the same schemas. Code: `shared/factory/` (schemas,
  compiler) and `server/factory/` (loader, CLI).
- Skill names in `skills:` are not resolved: they may be personal or plugin skills outside the
  factory.
- UI edits in `active` mode go through a writer that edits the YAML with the `yaml` Document API
  (comments survive) and commits `ui: <what changed>`. A file changed on disk since it was read
  reloads instead of being overwritten.

## Migration

`bin/factory export <dir> [--data <file>] [--profiles <dir>] [--projects <file>]` writes the
factory from `workboard-data.json`, the profile folders and Paseo's `projects.json` (defaults: the
live files under `$PASEO_HOME`, only read), adds the built-in files (pipelines, role prompts, spec
template, README, `.gitignore`), validates
the result and only then runs `git init` and commits. `<dir>` has no default and must be missing or
empty, so no call writes the live factory by accident. Worker ids become slugs of their names
(`-2` on repeats), and so do project and pool ids. The map goes to `.factory-ids.json` (git-ignored);
the cutover copies it into the runtime state (`factoryIds`), so running tasks keep their worker.
Profile memory is not copied: in `active` mode the profile folders move to `workers/<slug>/`, and a
`workboard-data.json.bak-pre-factory` backup is kept.

What the export cannot carry, it reports as a warning and leaves out: orchestrators and policies of
a project Paseo no longer has, the default task prompt of new orchestrators, a profile skill without
a valid SKILL.md, and the default-column preferences (`defaultDraftGroup`, `defaultStartGroup`,
`defaultStartWorkGroup`), which stay in the JSON. Two Paseo projects may share a checkout (one path a
symlink to the other); the export resolves the path to the project the data names, and active mode
must do the same.

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
writer, including `layout`. Live overlay: each node shows how many tasks are in that stage and how
many wait on its gate; a click lists them. On phones the tab shows the stages as a read-only list.

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
