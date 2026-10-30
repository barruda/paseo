// CUSTOM(reading-modes): two ways to read a long chat on a wide screen, as numbered pages drawn
// over the chat: Columns every chat row, Compact only prompts and final answers.
import { getStreamItemMessageId, type AssistantMessageItem, type StreamItem } from "@/types/stream";
import type { StreamLayoutItem } from "../layout";

export type ReadingMode = "chat" | "columns" | "compact";

/** The daemon's older history, which every reading mode loads in full before it lays out pages. */
export interface ReadingHistory {
  /** The daemon's history has been applied; before that, `hasOlder` means nothing yet. */
  isSynced: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => unknown;
  /** Names how far back the loaded history reaches; it moves when an older page arrives. */
  progressKey: string | null;
}

// Work the agent did on the way to its answer. Notifications, compaction markers and plugin rows
// stay: they are short, and plugins add rows after the answer (a turn's usage line), which must
// not read as a step that hides the answer.
function isStep(item: StreamItem): boolean {
  return item.kind === "tool_call" || item.kind === "thought" || item.kind === "todo_list";
}

// Every prompt starts a response, like the chat outline: system-injected turns have no prompt in
// the timeline and read as part of the response before them.
function splitResponses(items: readonly StreamItem[]): StreamItem[][] {
  const responses: StreamItem[][] = [];
  for (const item of items) {
    const current = responses.at(-1);
    if (current && item.kind !== "user_message") {
      current.push(item);
    } else {
      responses.push([item]);
    }
  }
  return responses;
}

function findLastStepIndex(response: readonly StreamItem[]): number {
  for (let index = response.length - 1; index >= 0; index -= 1) {
    if (isStep(response[index])) return index;
  }
  return -1;
}

function isAssistantMessage(item: StreamItem): item is AssistantMessageItem {
  return item.kind === "assistant_message";
}

/**
 * The ids Compact keeps: prompts, each response's final text, notifications and compaction
 * markers. A response still working (no text after its last step) keeps that last step, so a
 * running turn shows what it is doing.
 */
export function selectCompactItemIds(items: readonly StreamItem[]): Set<string> {
  const kept = new Set<string>();
  for (const response of splitResponses(items)) {
    const lastStep = findLastStepIndex(response);
    const hasFinalText = response.slice(lastStep + 1).some(isAssistantMessage);
    response.forEach((item, index) => {
      if (item.kind === "user_message") {
        kept.add(item.id);
      } else if (isAssistantMessage(item)) {
        if (index > lastStep) kept.add(item.id);
      } else if (!isStep(item)) {
        kept.add(item.id);
      } else if (index === lastStep && !hasFinalText) {
        kept.add(item.id);
      }
    });
  }
  return kept;
}

/**
 * The laid-out chat rows Compact keeps. An assistant message lays out as several block rows;
 * `items` may hold either the blocks or the whole message, so a row is kept by its own id or by
 * the message it belongs to.
 */
export function selectCompactRows(
  rows: StreamLayoutItem[],
  items: readonly StreamItem[],
): StreamLayoutItem[] {
  const kept = selectCompactItemIds(items);
  return rows.filter((row) => kept.has(row.item.id) || kept.has(getStreamItemMessageId(row.item)));
}
