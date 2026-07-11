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

// ── Per-column widths + drag resize (MAIN_PLAN #3) ───────────────────────────

function renderResizableGrid(
  colWidths: Record<number, number>,
  onResizeCol: (col: number, width: number) => void = noop,
  onAutofitCol: (col: number) => void = noop,
) {
  const data = makeData(10);
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
      onEditCell={noop}
      baseCount={1}
      onRemoveFormula={noop}
      showStats={false}
      colStats={null}
      statsErr={false}
      textCols={[]}
      colWidths={colWidths}
      onResizeCol={onResizeCol}
      onAutofitCol={onAutofitCol}
    />,
  );
  return utils;
}

describe("GridViewport column resize (MAIN_PLAN #3)", () => {
  it("applies a custom width to the column's header cell and data cells", () => {
    renderResizableGrid({ 0: 240 });
    const header = screen.getAllByRole("columnheader").find((h) => h.textContent?.includes("A"))!;
    expect(header.style.width).toBe("240px");
    // A data cell in that column gets the same width (continuous column).
    const cells = screen.getAllByRole("gridcell");
    expect(cells.some((c) => c.style.width === "240px")).toBe(true);
  });

  it("dragging a header edge streams clamped widths through onResizeCol", () => {
    const onResizeCol = vi.fn();
    renderResizableGrid({}, onResizeCol);
    const handle = screen.getByLabelText("resize column A");
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 160 });
    // Started from the default 120 → +60 = 180.
    expect(onResizeCol).toHaveBeenLastCalledWith(0, 180);
    // A huge negative drag clamps at the minimum, never a negative width.
    fireEvent.pointerMove(window, { clientX: -10_000 });
    const [, lastWidth] = onResizeCol.mock.calls[onResizeCol.mock.calls.length - 1] as [number, number];
    expect(lastWidth).toBeGreaterThan(0);
    expect(lastWidth).toBeLessThan(120);
    fireEvent.pointerUp(window);
    // After release, further moves do nothing (listeners removed).
    const calls = onResizeCol.mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 500 });
    expect(onResizeCol.mock.calls.length).toBe(calls);
  });

  it("double-clicking a header edge autofits instead of selecting the column", () => {
    const onAutofitCol = vi.fn();
    renderResizableGrid({}, noop, onAutofitCol);
    fireEvent.doubleClick(screen.getByLabelText("resize column A"));
    expect(onAutofitCol).toHaveBeenCalledWith(0);
  });

  it("the pinned x column is resizable too", () => {
    const onResizeCol = vi.fn();
    renderResizableGrid({}, onResizeCol);
    fireEvent.pointerDown(screen.getByLabelText("resize column x"), { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 30 });
    expect(onResizeCol).toHaveBeenLastCalledWith(-1, 150);
    fireEvent.pointerUp(window);
  });

  it("variable widths still window a wide grid (offsets path, not the uniform one)", () => {
    // 100 columns, one resized very wide: the windowed slice must respect the
    // prefix-sum offsets (leading columns shifted by the wide one) and still
    // render a bounded subset.
    const nCols = 100;
    const data: import("../../../lib/types").DataStruct = {
      time: [0, 1],
      values: [Array.from({ length: nCols }, (_, c) => c), Array.from({ length: nCols }, (_, c) => c + 1)],
      labels: Array.from({ length: nCols }, (_, c) => `C${c}`),
      units: Array.from({ length: nCols }, () => ""),
      metadata: {},
    };
    const { container } = render(
      <GridViewport
        data={data}
        xName="x"
        xUnit=""
        order={[0, 1]}
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
        baseCount={nCols}
        onRemoveFormula={noop}
        showStats={false}
        colStats={null}
        statsErr={false}
        textCols={[]}
        colWidths={{ 0: 400 }}
      />,
    );
    const scrollEl = container.querySelector(".qzk-grid") as HTMLElement;
    measureAs(scrollEl, 900, 300);
    const headers = screen.getAllByRole("columnheader");
    // Bounded window: nowhere near all 100 value columns render.
    expect(headers.length).toBeLessThan(30);
    // Scrolling right past the wide column shifts the window.
    Object.defineProperty(scrollEl, "scrollLeft", { configurable: true, value: 5000 });
    fireEvent.scroll(scrollEl);
    expect(screen.queryByText("C0")).not.toBeInTheDocument();
  });
});
