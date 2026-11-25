// The worksheet stats footer prints N / Missing as plain integers under the
// Scientific / 3 sf Numbers pref (P0-2); real statistics still follow the pref.
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import GridStatsFooter from "./GridStatsFooter";
import { layoutTextColumns } from "./textColumns";
import { setFormatOpts } from "../../../lib/format";
import { DEFAULT_GUTTER_WIDTH } from "../../../lib/gridwindow";

afterEach(() => setFormatOpts(6, "auto"));

describe("stats footer counts", () => {
  it("N and Missing stay integers under Scientific / 3 sf", () => {
    setFormatOpts(3, "scientific");
    render(
      <GridStatsFooter
        channelRoles={{}}
        colStats={[{ N: 201, missing: 4, mean: 201 }, { N: 201, missing: 4, mean: 201 }]}
        statsErr={false}
        visibleCols={[0]}
        leadingSpacer={0}
        trailingSpacer={0}
        colWidth={100}
        widthOf={() => 100}
        gutterWidth={DEFAULT_GUTTER_WIDTH}
        rowHeight={22}
        textLayout={layoutTextColumns([], [], [])}
      />,
    );
    const cells = (name: string) => {
      const row = screen.getByRole("rowheader", { name }).parentElement as HTMLElement;
      return within(row).getAllByRole("gridcell").map((c) => c.textContent);
    };
    expect(cells("N")).toEqual(["201", "201"]);
    expect(cells("Missing (blank or non-numeric cells)")).toEqual(["4", "4"]);
    expect(cells("Mean")).toEqual(["2.01e+2", "2.01e+2"]);
  });
});
