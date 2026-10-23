// CUSTOM(reading-modes): Columns draws the chat itself, every row the chat renders, as numbered
// pages: up to three columns side by side, and the next screen of columns below. It covers the
// chat, which stays mounted, and renders each row with the chat's own renderer, so tool calls,
// thoughts and permissions look and work the same.
//
// Unlike the chat, it lays out the whole conversation: page numbers and the page count only hold
// still when page 1 is the conversation's first page. It first fetches every older page from the
// daemon, then mounts all rows once, hidden until the pages are laid out. Rows are memoized, so
// streaming re-renders only the tail.
import { type CSSProperties, memo, type ReactNode, useEffect, useState } from "react";
import { MessageOuterSpacingProvider } from "@/components/message";
import type { StreamLayoutItem } from "../layout";
import { LoadingConversation, PagedColumnScroller } from "./column-scroller.web";
import type { ReadingColumnsHistory, ReadingColumnsProps } from "./reading-columns";

const COLUMN_MIN_WIDTH = 420;
const MAX_COLUMNS = 3;

const rowStyle: CSSProperties = { breakInside: "avoid" };
// A row renders again only when its layout item or the renderer changes, like the chat's rows.
const ColumnRow = memo(function ColumnRow({
  layoutItem,
  renderRow,
}: {
  layoutItem: StreamLayoutItem;
  renderRow: (layoutItem: StreamLayoutItem) => ReactNode;
}) {
  return <div style={rowStyle}>{renderRow(layoutItem)}</div>;
});

export function ReadingColumns({
  mode,
  rows,
  renderRow,
  pendingPermissions,
  turnFooter,
  history,
  followRequest,
  bottomInset,
}: ReadingColumnsProps) {
  if (mode !== "columns") return null;
  return (
    <ActiveReadingColumns
      rows={rows}
      renderRow={renderRow}
      pendingPermissions={pendingPermissions}
      turnFooter={turnFooter}
      history={history}
      followRequest={followRequest}
      bottomInset={bottomInset}
    />
  );
}

// A fetch that ends with the start unmoved this long failed; Columns then shows what arrived.
const STALLED_FETCH_MS = 2000;

/**
 * Fetches older history until the daemon has none left. Done only once the timeline is synced
 * (before that, "no older pages" means nothing yet) and no older page is left or the loop stalled.
 */
function useWholeHistory(history: ReadingColumnsHistory): boolean {
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

function ActiveReadingColumns({
  rows,
  renderRow,
  pendingPermissions,
  turnFooter,
  history,
  followRequest,
  bottomInset,
}: Omit<ReadingColumnsProps, "mode">) {
  const complete = useWholeHistory(history);
  if (!complete) {
    return <LoadingConversation />;
  }
  return (
    <PagedColumnScroller
      testID="reading-columns"
      bottomInset={bottomInset}
      columnMinWidth={COLUMN_MIN_WIDTH}
      maxColumns={MAX_COLUMNS}
      startKey={rows[0]?.item.id ?? null}
      followRequest={followRequest}
    >
      <MessageOuterSpacingProvider disableOuterSpacing>
        {rows.map((layoutItem) => (
          <ColumnRow key={layoutItem.item.id} layoutItem={layoutItem} renderRow={renderRow} />
        ))}
        {pendingPermissions}
        {turnFooter}
      </MessageOuterSpacingProvider>
    </PagedColumnScroller>
  );
}
