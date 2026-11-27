// GridViewport's `reveal` prop: bring a DISPLAY row (and optionally a column)
// into the virtualized window. The pane-level request flow is covered by
// useRowReveal.test.tsx; this pins the grid's own scroll math on both axes.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_COL_WIDTH, gutterWidthFor } from "../../../lib/gridwindow";
import type { DataStruct } from "../../../lib/types";
import GridViewport, { type GridReveal } from "./GridViewport";

const noop = () => {};

function makeData(nRows: number, nCols: number): DataStruct {
  return {
    time: Array.from({ length: nRows }, (_, i) => i),
    values: Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, c) => i + c)),
    labels: Array.from({ length: nCols }, (_, c) => `ch${c}`),
    units: Array.from({ length: nCols }, () => ""),
    metadata: {},
  };
}

function grid(data: DataStruct, reveal: GridReveal | null, textCols: { shortName: string; rows: string[] }[] = []) {
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
      reveal={reveal}
    />
  );
}

function measure(container: HTMLElement, width: number, height: number) {
  const el = container.querySelector(".qzk-grid") as HTMLElement;
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  fireEvent(window, new Event("resize"));
  return el;
}

const rowHeader = (n: number) => screen.queryByRole("rowheader", { name: String(n) });
const colHeader = (label: string) => screen.queryAllByRole("columnheader").find((h) => h.textContent?.includes(label));

describe("GridViewport reveal", () => {
  it("scrolls the requested display row into the rendered window", () => {
    const data = makeData(1000, 2);
    const { container, rerender } = render(grid(data, null));
    measure(container, 600, 240);
    expect(rowHeader(800)).toBeNull();
    rerender(grid(data, { pos: 799, key: 1 }));
    expect(rowHeader(800)).not.toBeNull();
    expect(rowHeader(1)).toBeNull();
  });

  it("scrolls a far value column into view horizontally", () => {
    const data = makeData(20, 60);
    const { container, rerender } = render(grid(data, null));
    measure(container, 600, 240);
    expect(colHeader("ch50")).toBeUndefined();
    rerender(grid(data, { pos: 3, column: 50, key: 1 }));
    expect(colHeader("ch50")).toBeDefined();
    expect(colHeader("ch0")).toBeUndefined();
  });

  it("scrolls past every value column to a named text column", () => {
    const data = makeData(20, 60);
    const text = [{ shortName: "Note", rows: data.time.map((t) => `n${t}`) }];
    const { container, rerender } = render(grid(data, null, text));
    measure(container, 600, 240);
    rerender(grid(data, { pos: 0, column: "Note", key: 1 }, text));
    // 60 value columns × 120 px precede the text column (which always renders);
    // revealing it scrolls the value window to its far end.
    expect(colHeader("ch0")).toBeUndefined();
    expect(colHeader("ch59")).toBeDefined();
  });

  it("a value column behind a text column placed before the numbers scrolls fully into a narrow window", () => {
    // Acceptance pass 6 C2: X, then the text column, then the value column. The text column sits in the
    // scrolling content ahead of the value column but carries no width in the column axis, so the column
    // was judged visible at the edge it only half reached.
    const data = { ...makeData(6, 2), metadata: { all_column_names: ["x", "grp", "ch0", "ch1"] } };
    const text = [{ shortName: "grp", rows: data.time.map((t) => `g${t}`) }];
    const { container, rerender } = render(grid(data, null, text));
    const el = measure(container, 360, 240);
    rerender(grid(data, { pos: 0, column: 0, key: 1 }, text));
    // the scroll area is the viewport less the pinned gutter and X; ch0 spans [120, 240) in it (text first)
    const avail = 360 - gutterWidthFor(data.time.length + 1) - DEFAULT_COL_WIDTH;
    expect(el.scrollLeft).toBe(2 * DEFAULT_COL_WIDTH - avail);
    expect(el.scrollLeft).toBeGreaterThan(0);
    // and the text column itself, which sits first, needs no scroll once the viewport is wide
    const wide = render(grid(data, null, text));
    measure(wide.container, 900, 240);
    wide.rerender(grid(data, { pos: 0, column: "grp", key: 2 }, text));
    expect(wide.container.querySelector<HTMLElement>(".qzk-grid")!.scrollLeft).toBe(0);
  });
});
