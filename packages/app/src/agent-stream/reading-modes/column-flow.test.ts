import { describe, expect, it } from "vitest";
import { columnsPerRow, flowPages, pageIndexOfEnd, turnPages } from "./column-flow";

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

describe("pageIndexOfEnd", () => {
  it("counts the pages before the end in reading order", () => {
    expect(pageIndexOfEnd(geometry, { endLeft: 0, endTop: 100 })).toBe(0);
    expect(pageIndexOfEnd(geometry, { endLeft: 900, endTop: 550 })).toBe(2);
    expect(pageIndexOfEnd(geometry, { endLeft: 450, endTop: 900 })).toBe(4);
  });
});

describe("flowPages with a last page", () => {
  it("stops at the last page instead of filling the row", () => {
    const pages = flowPages(geometry, 1400, 0, 3);
    expect(pages.map((page) => page.number)).toEqual([1, 2, 3, 4]);
  });
});

describe("turnPages", () => {
  it("opens with blank columns that make the last page close its row", () => {
    // Content ends on its fifth page: one blank column puts it in the last column of row 2.
    expect(turnPages({ current: null, key: "a", endFlowIndex: 4, columnsPerRow: 3 })).toEqual({
      key: "a",
      blankPages: 1,
      lastPage: 4,
    });
  });

  it("keeps the blank columns and never moves back to an earlier page", () => {
    const turned = { key: "a", blankPages: 1, lastPage: 4 };
    // Measured with the blank column in place.
    expect(turnPages({ current: turned, key: "a", endFlowIndex: 4, columnsPerRow: 3 })).toBe(
      turned,
    );
    expect(turnPages({ current: turned, key: "a", endFlowIndex: 6, columnsPerRow: 3 })).toEqual({
      key: "a",
      blankPages: 1,
      lastPage: 5,
    });
  });

  it("starts over when the layout changes, measuring past the old blank columns", () => {
    const turned = { key: "a", blankPages: 2, lastPage: 3 };
    expect(turnPages({ current: turned, key: "b", endFlowIndex: 5, columnsPerRow: 2 })).toEqual({
      key: "b",
      blankPages: 0,
      lastPage: 3,
    });
  });
});
