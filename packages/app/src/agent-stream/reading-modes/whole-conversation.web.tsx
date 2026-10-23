// CUSTOM(reading-modes): every reading mode lays out the whole conversation, so its numbered pages
// start at the first message and the page count holds still. This loads every older page from
// the daemon first and shows the mode only once nothing is left to load.
import { type ReactNode, useEffect, useState } from "react";
import { LoadingConversation } from "./column-scroller.web";
import type { ReadingHistory } from "./model";

// A fetch that ends with the start unmoved this long failed; the mode then shows what arrived.
const STALLED_FETCH_MS = 2000;

/**
 * Fetches older history until the daemon has none left. Done only once the timeline is synced
 * (before that, "no older pages" means nothing yet) and no older page is left or the loop stalled.
 */
function useWholeHistory(history: ReadingHistory): boolean {
  const [askedFor, setAskedFor] = useState<string | null | undefined>(undefined);
  const [stalledAt, setStalledAt] = useState<string | null | undefined>(undefined);
  const [fetching, setFetching] = useState(false);
  const { isSynced, hasOlder, isLoadingOlder, loadOlder, progressKey } = history;
  const idle = isSynced && hasOlder && !isLoadingOlder && !fetching;
  useEffect(() => {
    if (!idle || askedFor === progressKey) return;
    setAskedFor(progressKey);
    setFetching(true);
    void Promise.resolve(loadOlder()).finally(() => setFetching(false));
  }, [askedFor, idle, loadOlder, progressKey]);
  useEffect(() => {
    if (!idle || askedFor !== progressKey) return;
    const timer = setTimeout(() => setStalledAt(progressKey), STALLED_FETCH_MS);
    return () => clearTimeout(timer);
  }, [askedFor, idle, progressKey]);
  if (!isSynced) return false;
  return !hasOlder || (idle && stalledAt === progressKey);
}

export function WholeConversation({
  history,
  children,
}: {
  history: ReadingHistory;
  children: ReactNode;
}) {
  const complete = useWholeHistory(history);
  return complete ? children : <LoadingConversation />;
}
