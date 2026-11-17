// CUSTOM(projects-assistant): reads the structured report an agent ends its turn with.
import { reportSchema, type Report } from "../../shared/assistant";

const BLOCK = /<report>([\s\S]*?)<\/report>/gi;

/**
 * The LAST `<report>...</report>` block of a reply, parsed as JSON and validated. `text` is the
 * reply with that block removed; `report` is null when the block is missing or invalid.
 */
export function parseReport(reply: string): {
  report: Report | null;
  text: string;
} {
  let last: RegExpExecArray | null = null;
  for (const match of reply.matchAll(BLOCK)) last = match;
  if (!last) return { report: null, text: reply.trim() };
  const text = (
    reply.slice(0, last.index) + reply.slice(last.index + last[0].length)
  ).trim();
  try {
    const parsed = reportSchema.safeParse(JSON.parse(last[1].trim()));
    return { report: parsed.success ? parsed.data : null, text };
  } catch {
    return { report: null, text };
  }
}
