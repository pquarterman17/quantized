// The row-number gutter stays pinned across the whole horizontal scroll (gap
// audit 5, P8/B5). A sticky cell is confined to its parent row, and a flex row
// is only as wide as the viewport, so the pin holds only while EVERY row that
// carries a pinned cell (header, data rows, the entry row, the stats footer)
// is a `.qzk-grid-row` and that rule is `min-width: max-content`. jsdom lays
// nothing out, so this checks both halves structurally.

import { readFileSync } from "node:fs";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

const noop = () => {};
const data: DataStruct = {
  time: [0, 1, 2],
  values: [[0, 1], [1, 2], [2, 3]],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

function mount(statsErr: boolean) {
  return render(
    <GridViewport
      data={data}
      xName="x"
      xUnit=""
      order={[0, 1, 2]}
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
      baseCount={2}
      onRemoveFormula={noop}
      showStats
      colStats={null}
      statsErr={statsErr}
      textCols={[]}
    />,
  ).container;
}

describe("the row-number gutter stays pinned", () => {
  it("the shared row rule is as wide as its cells", () => {
    const css = readFileSync("src/styles/shell.css", "utf8");
    const rule = css.split("\n").find((l) => l.startsWith(".qzk-grid-row {"));
    expect(rule).toMatch(/min-width:\s*max-content/);
  });

  for (const statsErr of [false, true]) {
    it(`every sticky gutter sits directly in a .qzk-grid-row (stats ${statsErr ? "unavailable" : "footer"})`, () => {
      const gutters = Array.from(mount(statsErr).querySelectorAll<HTMLElement>(".qzk-grid-rownum"));
      // header corner + 3 data rows + at least one footer row
      expect(gutters.length).toBeGreaterThanOrEqual(5);
      for (const g of gutters) {
        expect(g.style.position).toBe("sticky");
        expect(g.style.left).toBe("0px");
        expect(g.parentElement?.classList.contains("qzk-grid-row")).toBe(true);
      }
    });
  }
});
