import { describe, expect, it } from "vitest";
import { columnsPerRow, flowPages, nextLeadSpace, unusedFlowAfterEnd } from "./column-flow";

// Three 400px columns with 50px gaps: 1300px wide. Columns are 600px tall, rows 800px apart.
const geometry = {
  width: 1300,
  columnMinWidth: 380,
  maxColumns: 3,
  columnGap: 50,
  columnHeight: 600,
  rowPitch: 800,
};

describe("columnsPerRow", () => {
  it("fits as many minimum-width columns as the width allows, up to the cap", () => {
    expect(columnsPerRow(geometry)).toBe(3);
    expect(columnsPerRow({ ...geometry, width: 900 })).toBe(2);
    expect(columnsPerRow({ ...geometry, width: 2400 })).toBe(3);
    expect(columnsPerRow({ ...geometry, width: 200 })).toBe(1);
  });
});

describe("unusedFlowAfterEnd", () => {
  it("counts the rest of the end's column and the empty columns after it", () => {
    // End 100px down the first column of the second row.
    expect(unusedFlowAfterEnd(geometry, { endLeft: 0, endTop: 900 })).toBe(500 + 2 * 600);
    // End 550px down the third column of the first row.
    expect(unusedFlowAfterEnd(geometry, { endLeft: 900, endTop: 550 })).toBe(50);
  });
});

describe("nextLeadSpace", () => {
  it("grows the spacer by the unused space, wrapping at a full row", () => {
    expect(nextLeadSpace(geometry, 0, 700)).toBe(700);
    expect(nextLeadSpace(geometry, 1500, 500)).toBe(200);
    expect(nextLeadSpace(geometry, 300, 0)).toBe(300);
  });
});

describe("flowPages", () => {
  it("numbers the columns that hold content, skipping the ones the spacer fills", () => {
    // Three rows; the spacer fills the first column and part of the second.
    const pages = flowPages(geometry, 2200, 900);
    expect(pages.map((page) => [page.row, page.column, page.number])).toEqual([
      [0, 1, 1],
      [0, 2, 2],
      [1, 0, 3],
      [1, 1, 4],
      [1, 2, 5],
      [2, 0, 6],
      [2, 1, 7],
      [2, 2, 8],
    ]);
  });
});
