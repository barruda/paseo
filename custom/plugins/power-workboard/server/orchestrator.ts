import type { Task } from "../shared/model";

/** The first message an orchestrated agent receives. */
export function orchestratorPrompt(task: Task, instructions: string): string {
  return [
    instructions.trim(),
    `# ${task.title}`,
    task.description.trim(),
    "---",
    "You were started by the Power Workboard orchestrator for the task above. Do the whole task in this workspace without waiting for confirmation. When you are done, reply with a short summary of what you changed and what a reviewer should check.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What the agent receives when the reviewer sends its task back with feedback. */
export function continuationPrompt(feedback: string): string {
  return [
    "The reviewer sent this task back to you from the Power Workboard. Continue it in this workspace without waiting for confirmation.",
    feedback.trim()
      ? `Reviewer feedback:\n\n${feedback.trim()}`
      : "The reviewer left no notes: finish what is still missing.",
    "When you are done, reply with a short summary of what you changed and what a reviewer should check.",
  ].join("\n\n");
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

/** Read the ticket out of the agent's reply; without markers the whole reply is the body. */
export function parseTicket(reply: string): {
  title: string | null;
  description: string;
} {
  const marked = /<ticket>([\s\S]*?)<\/ticket>/i.exec(reply);
  const body = (marked ? marked[1] : reply).trim();
  const heading = /^#\s+(.+)\n?/.exec(body);
  if (!heading) return { title: null, description: body };
  return {
    title: heading[1].trim().slice(0, 1000) || null,
    description: body.slice(heading[0].length).trim(),
  };
}
