// CUSTOM(reading-modes): Columns draws the chat itself, every row the chat renders, as numbered
// pages: up to three columns side by side, and the next screen of columns below. It covers the
// chat, which stays mounted, and renders each row with the chat's own renderer, so tool calls,
// thoughts and permissions look and work the same.
//
// Unlike the chat, it lays out the whole conversation: page numbers and the page count only hold
// still when page 1 is the conversation's first page. It first fetches every older page from the
// daemon, then mounts all rows once. Rows are memoized, so streaming re-renders only the tail.
import { type CSSProperties, memo, type ReactNode, useEffect, useState } from "react";
import { MessageOuterSpacingProvider } from "@/components/message";
import type { StreamLayoutItem } from "../layout";
import { color, overlayScrollerStyle, PagedColumnScroller } from "./column-scroller.web";
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

/**
 * Fetches older history until the daemon has none left. A fetch that ends without moving the
 * start (it failed) stops the loop, and Columns shows what arrived.
 */
function useWholeHistory(history: ReadingColumnsHistory): boolean {
  const [askedFor, setAskedFor] = useState<string | null | undefined>(undefined);
  const [fetching, setFetching] = useState(false);
  const { hasOlder, isLoadingOlder, loadOlder, progressKey } = history;
  useEffect(() => {
    if (!hasOlder || isLoadingOlder || fetching || askedFor === progressKey) return;
    setAskedFor(progressKey);
    setFetching(true);
    void Promise.resolve(loadOlder()).finally(() => setFetching(false));
  }, [askedFor, fetching, hasOlder, isLoadingOlder, loadOlder, progressKey]);
  return !hasOlder || (!fetching && !isLoadingOlder && askedFor === progressKey);
}

const loadingStyle: CSSProperties = {
  ...overlayScrollerStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  color: color.extraMuted,
};

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
    return (
      <div data-testid="reading-columns-loading" style={loadingStyle}>
        Loading the whole conversation…
      </div>
    );
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
