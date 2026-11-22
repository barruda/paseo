import type { Task } from "../shared/model";
import type { TaskProgress } from "../shared/assistant"; // CUSTOM(task-checkpoints)

// CUSTOM(projects-assistant): what the agent must know when the Project Manager delivers its work.
export function assistantSection(): string {
  return [
    "## Delivery",
    "The Project Manager delivers the work of this task. Do not merge, push, rebase onto the base branch or open pull requests; leave your changes in this workspace.",
    // CUSTOM(projects-assistant): an agent with no profile prompt deleted its node_modules symlink as "cleanup", and the review could not run the tests.
    "The review and the delivery run the checks in this workspace. If dependencies are missing, install them here with the project's installer and leave them in place when you finish: never delete `node_modules`, virtualenvs or build outputs as cleanup. Do not symlink another checkout's `node_modules`: an ignore rule like `node_modules/` matches directories only, so git sees the symlink as an untracked file, and the delivery commit stages every untracked file.",
    // CUSTOM(worktree-shared-deps): worktree setup may hardlink node_modules to the main checkout's files.
    "The worktree setup may have filled `node_modules` with hardlinks to the main checkout's files. Never edit or patch files inside `node_modules` in place: the edit would change the main checkout too. To change dependencies, edit the manifest and run the installer (`npm install` or `npm ci` replace files instead of editing them).",
    'End your final reply with a report between <report> and </report>, as JSON: {"status": "done" | "blocked" | "needs_input" | "failed" | "checkpoint", "summary": string, "filesChanged": string[], "checks": [{"command": string, "passed": boolean}], "risks": string[], "question": string | null}. Use `question` for what the user must answer or do when the status is blocked or needs_input.',
    'Example: <report>{"status":"done","summary":"Added the retry button.","filesChanged":["src/button.tsx"],"checks":[{"command":"npm test","passed":true}],"risks":[],"question":null}</report>',
    reviewMapSection(), // CUSTOM(assistant-cards)
    checkpointSection(), // CUSTOM(task-checkpoints)
  ].join("\n\n");
}

// CUSTOM(assistant-cards): optional fields the report cards draw as a review map and as one-tap
// answers (docs/assistant-reply-protocol.md, "The task report").
function reviewMapSection(): string {
  return [
    'Optional, and worth adding: "outcomes": [{"ask": string, "evidence": "seen" | "tested" | "unverified", "detail": string}], one per thing the task asked for, quoted from it. "seen" means you ran it and watched it work (put the command and what it showed in "detail"); "tested" names the test; anything else is "unverified". "notDone": [{"kind": "skipped" | "unverified" | "outside", "text": string}] lists what you skipped, left unverified, or changed without being asked ("outside").',
    'When you ask a question, never leave it empty: add "options": [{"id": string, "label": string, "gains": string, "costs": string}], "recommend": the id you recommend, and "why". The user answers in one tap; free text still works.',
  ].join("\n\n");
}

// CUSTOM(task-checkpoints): a task too long for one session saves its progress and is resumed later.
function checkpointSection(): string {
  return [
    'Most tasks end with "done": finish the work in this session. Use status "checkpoint" only when the task really does not fit in one session, or must wait for something outside it such as CI. Then add "progress": {"done": string[], "next": string[]}, the full checklist of the task so far, with the same wording for an item across checkpoints. Leave the workspace in a state that builds; the Project Manager commits your partial work in this worktree (never on the base branch) and resumes the task later, maybe with a new agent that only has your summary and checklist.',
    'To resume only later, add "resumeAfter" (an ISO 8601 time) and "waitingFor" (what you wait for). Without them the task resumes on the next pass.',
    "Use a checkpoint only after real progress: a task with too many checkpoints, or with checkpoints in a row that complete no new item, goes to the user as stalled.",
    'Example: <report>{"status":"checkpoint","summary":"Server side done; UI next.","filesChanged":["server/a.ts"],"checks":[],"risks":[],"question":null,"progress":{"done":["Server engine"],"next":["Card badge","Dashboard"]},"resumeAfter":null,"waitingFor":null}</report>',
  ].join("\n\n");
}

/** CUSTOM(task-checkpoints): the checklist and last checkpoint, as Markdown. */
function progressMarkdown(progress: TaskProgress): string {
  const list = (items: string[], mark: string) =>
    items.map((item) => `- [${mark}] ${item}`).join("\n");
  return [
    progress.done.length ? `Done:\n${list(progress.done, "x")}` : "",
    progress.next.length ? `Next:\n${list(progress.next, " ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** CUSTOM(task-checkpoints): what the task's own agent receives when its checkpoint resumes. */
export function checkpointResumePrompt(
  progress: TaskProgress | undefined,
  waitingFor: string | null,
  assistant = false,
  tests = "",
): string {
  return [
    `The Workboard resumes this task from checkpoint ${progress?.checkpoints ?? 1}. Continue it in this workspace without waiting for confirmation.`,
    waitingFor ? `You were waiting for: ${waitingFor}. Check it first.` : "",
    progress ? progressMarkdown(progress) : "",
    "When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    tests,
    assistant ? assistantSection() : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** CUSTOM(usage-limit): what the agent receives once the plan's usage limit has reset. */
export function usageLimitResumePrompt(
  progress: TaskProgress | undefined,
  assistant = false,
  tests = "",
): string {
  return [
    "You stopped because the plan's usage limit was reached. It has reset: continue the task from where you stopped, in this workspace, without waiting for confirmation.",
    progress ? progressMarkdown(progress) : "",
    "When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    tests,
    assistant ? assistantSection() : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * CUSTOM(task-checkpoints): the handoff a new agent receives when the task's agent is gone: the
 * ticket comes from `orchestratorPrompt`; this adds the checklist, the last summary and the branch.
 */
export function handoffSection(input: {
  progress: TaskProgress | undefined;
  summary: string | null;
  branch: string | null;
}): string {
  const { progress, summary, branch } = input;
  return [
    "## Handoff",
    "Another agent worked on this task in this workspace and is gone. Its work is in this worktree" +
      (branch ? `, on branch \`${branch}\`` : "") +
      ": read `git log` and `git status` before you change anything.",
    progress ? progressMarkdown(progress) : "",
    summary?.trim() ? `Its last summary:\n\n${summary.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the agent receives when a check the Project Manager ran on its work failed. */
export function fixPrompt(command: string, output: string, tests = ""): string {
  return [
    "The Project Manager ran a check on your work before delivering it, and it failed. Fix the problem in this workspace without waiting for confirmation.",
    `Command: ${command}`,
    `Output (tail):\n\n${output.trim() || "(no output)"}`,
    tests,
    assistantSection(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// CUSTOM(assistant-autonomy): what the agent receives when merging its branch hit a conflict.
export function conflictPrompt(baseBranch: string, tests = ""): string {
  const base = baseBranch.trim() || "the base branch";
  return [
    `The Project Manager tried to merge your branch into ${base}, but ${base} moved and the merge conflicts. Resolve it in this workspace without waiting for confirmation.`,
    [
      `1. Run \`git merge ${baseBranch.trim() || "<base branch>"}\` here (a merge, not a rebase).`,
      "2. Resolve every conflict keeping both sides. In custom/CHANGES.md keep every entry.",
      "3. Rerun the project's typecheck and the tests you touched.",
      "4. Commit the merge and end with a clean `git status`.",
      "5. Do not push.",
    ].join("\n"),
    tests,
    assistantSection(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * CUSTOM(task-description-files): the ticket a prompt is built from. `body` is the description
 * from `Store.description`; a `Task` does not fit here, because its `description` field is "".
 */
export interface Ticket {
  title: string;
  body: string;
}

/** The first message an orchestrated agent receives. */
export function orchestratorPrompt(
  task: Ticket,
  instructions: string,
  assistant = false, // CUSTOM(projects-assistant)
  tests = "", // CUSTOM(packages)
): string {
  return [
    instructions.trim(),
    `# ${task.title}`,
    task.body.trim(),
    "---",
    "You were started by the Workboard orchestrator for the task above. Do the whole task in this workspace without waiting for confirmation. When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    tests,
    assistant ? assistantSection() : "", // CUSTOM(projects-assistant)
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the agent receives when the reviewer sends its task back with feedback. */
export function continuationPrompt(
  feedback: string,
  assistant = false, // CUSTOM(projects-assistant)
  tests = "", // CUSTOM(packages)
): string {
  return [
    "The reviewer sent this task back to you from the Workboard. Continue it in this workspace without waiting for confirmation.",
    feedback.trim()
      ? `Reviewer feedback:\n\n${feedback.trim()}`
      : "The reviewer left no notes: finish what is still missing.",
    "When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    tests,
    assistant ? assistantSection() : "", // CUSTOM(projects-assistant)
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The first message of a refinement chat. */
export function refinementPrompt(task: Ticket, instructions: string): string {
  return [
    instructions.trim(),
    "You are refining a task from the Workboard before another agent executes it. Do not change files or run anything that changes state: read the code, ask the user questions and propose an approach. Keep answers short. When the user is satisfied they run /write-ticket, and you will write the final ticket.",
    `# ${task.title}`,
    task.body.trim(),
    "---",
    "Start by reading what is relevant, then ask your most important questions.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The message `/write-ticket` sends to the refinement chat. */
export function writeTicketPrompt(focus: string): string {
  return [
    "/write-ticket: close the refinement now and write the final ticket for this task.",
    focus.trim() ? `Focus on: ${focus.trim()}` : "",
    "Reply with only the ticket between <ticket> and </ticket>. Its first line is `# <short title>`, then the body in Markdown: goal, context, what to do, acceptance criteria and what is out of scope. Write it for an agent that will execute it alone, without this chat. Use the language of the original task.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The side question that asks a task's agent for a pull request description of its work. */
export function pullRequestPrompt(task: Task): string {
  return [
    `Write a pull request description for the work you did on this task: "${task.title}".`,
    "Reply with only the description between <pr> and </pr>. Its first line is `# <short title>`, then the body in Markdown: what changed and why, how to test it, and anything a reviewer should look at. Use the language of the task.",
  ].join("\n\n");
}

/** Read the ticket out of the agent's reply; without markers the whole reply is the body. */
export function parseTicket(
  reply: string,
  tag = "ticket",
): {
  title: string | null;
  description: string;
} {
  const marked = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(reply);
  const body = (marked ? marked[1] : reply).trim();
  const heading = /^#\s+(.+)\n?/.exec(body);
  if (!heading) return { title: null, description: body };
  return {
    title: heading[1].trim().slice(0, 1000) || null,
    description: body.slice(heading[0].length).trim(),
  };
}
