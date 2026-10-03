// The grid renders each column through its own columnFormatter, so a QD
// "Time Stamp (sec)" column (x or value) no longer reads 3.765e+9 on every
// row, while an ordinary column keeps fmtCell's text.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

const noop = () => {};
const STAMPS = [3764745666.84624, 3764745683.63969, 3764745719.03295];

function grid(data: DataStruct) {
  return (
    <GridViewport
      data={data}
      xName="Time Stamp"
      xUnit="sec"
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
      textCols={[]}
    />
  );
}

const cellTexts = () =>
  screen.getAllByRole("row").slice(1).map((row) =>
    [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent),
  );

describe("GridViewport per-column precision", () => {
  it("shows distinct time stamps in the x and a value column", () => {
    const data: DataStruct = {
      time: STAMPS,
      values: STAMPS.map((t, i) => [t, 2.00318431854248 + i]),
      labels: ["Time Stamp", "Temperature"],
      units: ["sec", "K"],
      metadata: {},
    };
    render(grid(data));
    expect(cellTexts()).toEqual([
      ["3764745667", "3764745667", "2.0032"],
      ["3764745684", "3764745684", "3.0032"],
      ["3764745719", "3764745719", "4.0032"],
    ]);
  });
});
