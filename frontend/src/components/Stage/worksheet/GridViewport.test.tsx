// GridViewport integration tests (WORKSHEET_PLAN item 2): the pure windowing
// math is unit-tested standalone in lib/gridwindow.test.ts; these tests verify
// the DOM wiring — that a REAL (non-degenerate) measured viewport actually
// renders a windowed subset (not everything, unlike the jsdom-default
// fallback Worksheet.test.tsx relies on), that scrolling shifts the window,
// and that double-click-to-edit still works on a row inside that window.
// jsdom never lays elements out, so `clientHeight`/`clientWidth` are stubbed
// directly on the scroll container to simulate a real, bounded viewport.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

function makeData(nRows: number): DataStruct {
  return {
    time: Array.from({ length: nRows }, (_, i) => i),
    values: Array.from({ length: nRows }, (_, i) => [i * 10]),
    labels: ["A"],
    units: [""],
    metadata: {},
  };
}

const noop = () => {};

function renderGrid(nRows: number, onEditCell: (row: number, col: number, value: number) => void = noop) {
  const data = makeData(nRows);
  const utils = render(
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
      onEditCell={onEditCell}
      baseCount={1}
      onRemoveFormula={noop}
      showStats={false}
      colStats={null}
      statsErr={false}
      textCols={[]}
    />,
  );
  const scrollEl = utils.container.querySelector(".qzk-grid") as HTMLElement;
  return { ...utils, scrollEl };
}

/** Stub a bounded viewport and re-trigger GridViewport's measurement effect
 *  (it listens for `resize`) — jsdom itself never measures a real size. */
function measureAs(scrollEl: HTMLElement, width: number, height: number) {
  Object.defineProperty(scrollEl, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: height });
  fireEvent(window, new Event("resize"));
}

describe("GridViewport windowed rendering", () => {
  it("renders every row when the viewport is unmeasured (jsdom default — degenerate fallback)", () => {
    renderGrid(50);
    // header + 50 data rows.
    expect(screen.getAllByRole("row")).toHaveLength(51);
  });

  it("renders only a windowed subset once a real (bounded) viewport is measured", () => {
    const { scrollEl } = renderGrid(200);
    measureAs(scrollEl, 600, 240);
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1); // header + at least some data rows
    expect(rows.length).toBeLessThan(60); // nowhere near all 200 data rows
  });

  it("scrolling shifts which rows are in the rendered window", () => {
    const { scrollEl } = renderGrid(200);
    measureAs(scrollEl, 600, 240);

    // Row 1 (the very first row) starts in the window; a far row does not.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("170")).not.toBeInTheDocument();

    Object.defineProperty(scrollEl, "scrollTop", { configurable: true, value: 4000 });
    fireEvent.scroll(scrollEl);

    // After a big scroll, the early row has left the window and row 170 (well
    // within the new window given the default row height/overscan) has entered it.
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText("170")).toBeInTheDocument();
  });

  it("double-click editing still works on a row inside a real (non-degenerate) window", () => {
    const onEditCell = vi.fn();
    const { scrollEl } = renderGrid(200, onEditCell);
    measureAs(scrollEl, 600, 240);

    // Row 0's x AND A cells are both 0 ("0.0000" would match twice) — use row 1
    // (time[1] === 1, distinct from values[1][0] === 10) to target unambiguously.
    fireEvent.doubleClick(screen.getByText("1.0000")); // row 1's x cell
    const input = screen.getByDisplayValue("1");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEditCell).toHaveBeenCalledWith(1, -1, 42);
  });
});
