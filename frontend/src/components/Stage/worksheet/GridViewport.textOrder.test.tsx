// Worksheet audit follow-up: the grid used to always render every text
// (Origin "text-sheet") column after every numeric one, even when the file's
// own column order interleaves them — while Copy/Export (worksheetTable.ts)
// already preserve that file order. This pins the grid to the SAME order,
// via `all_column_names` (the importer's recorded file column list).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

const noop = () => {};

function grid(data: DataStruct, textCols: { shortName: string; longName?: string; rows: string[] }[]) {
  return (
    <GridViewport
      data={data}
      xName="x"
      xUnit=""
      order={data.time.map((_, i) => i)}
      masked={new Set()}
      filteredOut={new Set()}
      selected={new Set()}
      channelRoles={{}}
      sortMark={() => ""}
      selectedCols={new Set()}
      onToggleColSelect={noop}
      onSelectColRange={noop}
      onToggleSelect={noop}
      onSelectRange={noop}
      onEditCell={noop}
      baseCount={data.labels.length}
      onRemoveFormula={noop}
      showStats={false}
      colStats={null}
      statsErr={false}
      textCols={textCols}
    />
  );
}

/** The grid's own column headers, in DOM order, by their displayed name —
 *  excludes the "#" row-number corner (also `role="columnheader"`). */
function headerNames(): string[] {
  return screen
    .getAllByRole("columnheader")
    .map((h) => h.textContent ?? "")
    .filter((t) => t && t !== "#")
    .map((t) => {
      // Each header's own name is rendered before its role/unit span —
      // match against the known candidate names rather than parsing further.
      for (const name of ["x", "A", "B", "Note"]) if (t.startsWith(name)) return name;
      return t;
    });
}

function dataWithText(allColumnNames?: string[]): DataStruct {
  return {
    time: [0, 1],
    values: [[1, 2], [3, 4]],
    labels: ["A", "B"],
    units: ["", ""],
    metadata: allColumnNames ? { all_column_names: allColumnNames } : {},
  };
}

describe("GridViewport text-column file order (worksheet audit)", () => {
  it("interleaves a text column between the numeric columns it sits between in the file", () => {
    const data = dataWithText(["x", "A", "Note", "B"]);
    const text = [{ shortName: "Note", rows: ["n0", "n1"] }];
    render(grid(data, text));
    expect(headerNames()).toEqual(["x", "A", "Note", "B"]);
  });

  it("keeps a text column that leads the file right after x, before every numeric column", () => {
    const data = dataWithText(["x", "Note", "A", "B"]);
    const text = [{ shortName: "Note", rows: ["n0", "n1"] }];
    render(grid(data, text));
    expect(headerNames()).toEqual(["x", "Note", "A", "B"]);
  });

  it("falls back to the old trailing layout when the file recorded no column list", () => {
    const data = dataWithText();
    const text = [{ shortName: "Note", rows: ["n0", "n1"] }];
    render(grid(data, text));
    expect(headerNames()).toEqual(["x", "A", "B", "Note"]);
  });
});
