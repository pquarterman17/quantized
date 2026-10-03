// Units are case-sensitive data ("mT" is not "MT", "Oe" is not "OE"): the
// worksheet header's role line is styled uppercase for the channel letter, so
// the unit must sit in its own element that opts back out of that transform.
// Found on a real QD MPMS file, whose "Oe"/"emu" columns rendered "OE"/"EMU".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import GridHeader from "./GridHeader";

const data: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["Moment"],
  units: ["mT"],
  metadata: {},
};
const noop = () => {};

describe("GridHeader units keep their case", () => {
  it("renders x and channel units in a .unit element the uppercase role rule does not transform", () => {
    render(
      <GridHeader
        data={data}
        xName="Field"
        xUnit="Oe"
        channelRoles={{}}
        baseCount={1}
        visibleCols={[0]}
        leadingSpacer={0}
        trailingSpacer={0}
        colWidth={100}
        widthOf={() => 100}
        gutterWidth={40}
        sortMark={() => ""}
        selectedCols={new Set()}
        onHeaderClick={noop}
        onResizeStart={noop}
        onAutofitCol={noop}
        onRemoveFormula={noop}
        textCols={[]}
      />,
    );
    for (const unit of ["Oe", "mT"]) {
      const el = screen.getByText(unit);
      expect(el.classList.contains("unit"), unit).toBe(true);
      expect(el.closest(".role"), unit).not.toBeNull();
    }
    const css = readFileSync(resolve(process.cwd(), "src/styles/shell.css"), "utf8");
    expect(css).toMatch(/\.qzk-grid-headcell \.role \.unit\s*\{[^}]*text-transform:\s*none/);
  });
});
