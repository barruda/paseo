// CUSTOM(factory): fixture factories, as maps of relative path → content, written to a temp dir.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FactoryFiles = Record<string, string>;

/** Writes `files` under a new temp dir; `{{NAME}}` placeholders take `vars[NAME]`. */
export async function writeFactory(
  files: FactoryFiles,
  vars: Record<string, string> = {},
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwb-factory-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(
      full,
      content.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? ""),
    );
  }
  return root;
}

export const MINIMAL_FACTORY: FactoryFiles = {
  "factory.yaml": "schemaVersion: pwb/v1alpha1\nname: minimal\n",
};

/** The examples of docs/factory.md, with two projects whose checkouts are {{PASEO}} and {{DREAM}}. */
export const VALID_FACTORY: FactoryFiles = {
  "factory.yaml": `# yaml-language-server: $schema=.schema/factory.json
schemaVersion: pwb/v1alpha1
name: bruno-local
description: Personal board, all projects
defaults:
  worker:
    model: claude/claude-opus-5-5
    thinking: medium
    permission: full # full | a provider mode id
    autoAccept: true
    workspace: worktree
    maxConcurrent: 2
    batchSize: 5
    maxCheckpoints: 5
    memory: true
    skills: all
  delivery:
    action: review
  pipeline: default
`,
  "board.yaml": `columns: # order on screen
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
`,
  "pm/worker.md": `---
role: foreman
enabled: true
model: claude/claude-opus-5-5
thinking: high
permission: full
skills: all
memory: true
wake: { onNeedsYou: true, delaySeconds: 12 }
compactAtTokens: 180000
interactivePermission: default
---

Project Manager system prompt.
`,
  "pm/skills/board-tips/SKILL.md":
    "---\nname: board-tips\ndescription: How to read the board\n---\nTips.\n",
  "workers/paseo/worker.md": `---
name: Paseo
description: Implements paseo tickets on the custom branch
role: implement
project: paseo
priority: 10
enabled: true
model: claude/claude-opus-5-5
thinking: high
permission: full
workspace: worktree
maxConcurrent: 2
batchSize: 5
maxCheckpoints: 5
pool: null
schedule: automatic
skills: [paseo-customizations, paseo]
memory: true
---

You implement paseo tickets.
`,
  "workers/paseo/task-prompt.md": "## Projeto paseo\n\nRead CLAUDE.md first.\n",
  "workers/paseo/skills/paseo-notes/SKILL.md":
    "---\nname: paseo-notes\ndescription: Notes about paseo\nallowed-tools: Read\n---\nNotes.\n",
  "workers/paseo/memory/MEMORY.md": "anything the agent writes",
  "workers/dreammmo/worker.md": `---
project: dreammmo
priority: 5
permission: bypassPermissions
workspace: folder
pool: unity
schedule: { window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } }
---

You implement DreamMMO tickets.
`,
  "workers/general/worker.md": `---
project: null
priority: 20
enabled: false
thinking: null
schedule: { daily: { times: ["08:00"] } }
---
`,
  "projects/paseo.yaml": `path: {{PASEO}}
pipeline: default
delivery:
  action: review
  observe: false
  baseBranch: custom
  verifyCommand: "npm run typecheck && npm run lint"
  autoFixes: 1
tests:
  gate:
    command: "npm test"
    setup: "npm ci"
    requiredEnv: [DB_URL]
    env: { CI: "1" }
    runIn: worktree
    riskPaths: ["**/migrations/**", "**/protocol/**"]
templates:
  spec: templates/spec.md
`,
  "projects/dreammmo.yaml": "path: {{DREAM}}\n",
  "pipelines/default.yaml": "start: implement\n",
  "roles/implement.md": "Implement the ticket.\n",
  "skills/shared-skill/SKILL.md":
    "---\nname: shared-skill\ndescription: For every worker\n---\nBody.\n",
  "skills/shared-skill/scripts/run.sh": "echo hi\n",
  "templates/spec.md": "# Spec\n",
  ".gitignore": "workers/*/memory/\n",
  "README.md": "My factory.\n",
};
