// CUSTOM(projects-assistant): reads the structured report an agent ends its turn with.
import type { Report } from "../../shared/assistant";
import { lastReportBlock, parseReportBody } from "../../shared/task-report"; // CUSTOM(report-card)

/**
 * The LAST `<report>...</report>` block of a reply, parsed as JSON and validated. `text` is the
 * reply with that block removed; `report` is null when the block is missing or invalid.
 */
export function parseReport(reply: string): {
  report: Report | null;
  text: string;
} {
  const block = lastReportBlock(reply);
  if (!block) return { report: null, text: reply.trim() };
  const text = (reply.slice(0, block.start) + reply.slice(block.end)).trim();
  return { report: parseReportBody(block.body), text };
}
