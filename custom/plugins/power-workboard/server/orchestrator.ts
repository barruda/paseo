import type { Task } from "../shared/model";

// CUSTOM(projects-assistant): what the agent must know when the Projects Assistant delivers its work.
export function assistantSection(): string {
  return [
    "## Delivery",
    "The Projects Assistant delivers the work of this task. Do not merge, push, rebase onto the base branch or open pull requests; leave your changes in this workspace.",
    // CUSTOM(projects-assistant): an agent with no profile prompt deleted its node_modules symlink as "cleanup", and the review could not run the tests.
    "The review and the delivery run the checks in this workspace. If dependencies are missing, install them here with the project's installer and leave them in place when you finish: never delete `node_modules`, virtualenvs or build outputs as cleanup. Do not symlink another checkout's `node_modules`: an ignore rule like `node_modules/` matches directories only, so git sees the symlink as an untracked file, and the delivery commit stages every untracked file.",
    'End your final reply with a report between <report> and </report>, as JSON: {"status": "done" | "blocked" | "needs_input" | "failed", "summary": string, "filesChanged": string[], "checks": [{"command": string, "passed": boolean}], "risks": string[], "question": string | null}. Use `question` for what the user must answer or do when the status is blocked or needs_input.',
    'Example: <report>{"status":"done","summary":"Added the retry button.","filesChanged":["src/button.tsx"],"checks":[{"command":"npm test","passed":true}],"risks":[],"question":null}</report>',
  ].join("\n\n");
}

/** What the agent receives when a check the Projects Assistant ran on its work failed. */
export function fixPrompt(command: string, output: string): string {
  return [
    "The Projects Assistant ran a check on your work before delivering it, and it failed. Fix the problem in this workspace without waiting for confirmation.",
    `Command: ${command}`,
    `Output (tail):\n\n${output.trim() || "(no output)"}`,
    assistantSection(),
  ].join("\n\n");
}

/** The first message an orchestrated agent receives. */
export function orchestratorPrompt(
  task: Task,
  instructions: string,
  assistant = false, // CUSTOM(projects-assistant)
): string {
  return [
    instructions.trim(),
    `# ${task.title}`,
    task.description.trim(),
    "---",
    "You were started by the Power Workboard orchestrator for the task above. Do the whole task in this workspace without waiting for confirmation. When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    assistant ? assistantSection() : "", // CUSTOM(projects-assistant)
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the agent receives when the reviewer sends its task back with feedback. */
export function continuationPrompt(
  feedback: string,
  assistant = false, // CUSTOM(projects-assistant)
): string {
  return [
    "The reviewer sent this task back to you from the Power Workboard. Continue it in this workspace without waiting for confirmation.",
    feedback.trim()
      ? `Reviewer feedback:\n\n${feedback.trim()}`
      : "The reviewer left no notes: finish what is still missing.",
    "When you are done, reply with a short summary of what you changed and what a reviewer should check.",
    assistant ? assistantSection() : "", // CUSTOM(projects-assistant)
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The first message of a refinement chat. */
export function refinementPrompt(task: Task, instructions: string): string {
  return [
    instructions.trim(),
    "You are refining a task from the Power Workboard before another agent executes it. Do not change files or run anything that changes state: read the code, ask the user questions and propose an approach. Keep answers short. When the user is satisfied they run /write-ticket, and you will write the final ticket.",
    `# ${task.title}`,
    task.description.trim(),
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
