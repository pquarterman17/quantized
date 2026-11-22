// Conditional formatting in the grid: tints show on ruled columns only, a
// selected column keeps its selection colour, the X column and the entry row
// are never tinted, and only the windowed rows are ever asked for a tint.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { compileCellRules } from "../../../lib/worksheetRules";
import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

const noop = () => {};
function data(nRows: number): DataStruct {
  return {
    time: Array.from({ length: nRows }, (_, i) => i),
    values: Array.from({ length: nRows }, (_, r) => [r, r * 2]),
    labels: ["A", "B"],
    units: ["", ""],
    metadata: {},
  };
}
function props(d: DataStruct, extra: Partial<React.ComponentProps<typeof GridViewport>> = {}): React.ComponentProps<typeof GridViewport> {
  return {
    data: d, xName: "x", xUnit: "", order: d.time.map((_, i) => i), masked: new Set(), filteredOut: new Set(), selected: new Set(),
    channelRoles: {}, sortMark: () => "", selectedCols: new Set(), onToggleColSelect: noop, onSelectColRange: noop,
    onToggleSelect: noop, onSelectRange: noop, onEditCell: noop, baseCount: 2, onRemoveFormula: noop, showStats: false,
    colStats: null, statsErr: false, textCols: [], ...extra,
  };
}
// Value cells only: the pinned X cell carries its own opaque surface background.
const cells = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="row"]:not(:first-child) [role="gridcell"]')].filter((el) => el.style.background !== "var(--surface-0)");

describe("GridViewport conditional format", () => {
  it("tints cells of a ruled column and no others", () => {
    const d = data(4);
    const tintOf = compileCellRules({ 1: [{ kind: "value", op: ">", a: 3, tone: "danger" }] }, d.values);
    const { container } = render(<GridViewport {...props(d, { tintOf })} />);
    const bg = cells(container).map((el) => el.style.background);
    // rows 2 and 3 of column B (4, 6) exceed 3; nothing else is tinted
    expect(bg.filter(Boolean)).toHaveLength(2);
    expect(bg.filter(Boolean).every((b) => b.includes("var(--danger)") && b.includes("var(--surface-0)"))).toBe(true);
  });

  it("without rules no cell gets a background", () => {
    const { container } = render(<GridViewport {...props(data(3))} />);
    expect(cells(container).every((el) => el.style.background === "")).toBe(true);
  });

  it("a selected column keeps the selection colour, not the tint", () => {
    const d = data(3);
    const tintOf = compileCellRules({ 1: [{ kind: "value", op: ">", a: -1, tone: "ok" }] }, d.values);
    const { container } = render(<GridViewport {...props(d, { tintOf, selectedCols: new Set([1]) })} />);
    const tinted = cells(container).filter((el) => el.style.background.includes("var(--ok)"));
    expect(tinted).toHaveLength(0);
  });

  it("is asked only for value columns of the windowed rows, never the whole sheet", () => {
    const d = data(5000);
    const tintOf = vi.fn((_col: number, _v: number | undefined): string | undefined => undefined);
    render(<GridViewport {...props(d, { tintOf })} />);
    expect(tintOf.mock.calls.length).toBeGreaterThan(0);
    expect(tintOf.mock.calls.length).toBeLessThan(2500); // a window of rows x 2 columns, not the 10000 cells
    expect(tintOf.mock.calls.every(([col]) => col >= 0)).toBe(true); // never the X column
  });
});
