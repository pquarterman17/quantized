// The polar view honours the plot's row window (ROW_RANGE_CONTRACT 3.3, item 31), screen == export: the canvas
// strokes only the window's rows (less the sheet's exclusions) and the figure request holds the same rows and the
// radial range of the window alone. A window that does not fit is not applied on screen and refused in the export.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPolarFigureSpec } from "../../lib/polarFigureSpec";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PolarStage from "./PolarStage";
import PolarStageCore from "./PolarStageCore";

const N = 200;
const angle = (r: number) => r % 360;
/** Small inside rows 21-44 (value 1..24), huge outside: a leaked row stretches the shared radial range. */
const value = (r: number) => (r >= 20 && r <= 43 ? r - 19 : 9000);
const ds: Dataset = {
  id: "p", name: "polar.dat", excludedRows: [25, 100],
  data: { time: Array.from({ length: N }, (_v, r) => angle(r)), values: Array.from({ length: N }, (_v, r) => [value(r)]), labels: ["R"], units: [""], metadata: {} },
};
const WINDOW = { from: 20, to: 43 };

let strokes = 0;
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (t, k: string) => (k === "moveTo" || k === "lineTo" ? () => { strokes += 1; } : (t[k] ??= () => undefined)),
  set: (t, k: string, v) => ((t[k] = v), true),
});
let getContext: typeof HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  strokes = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  useApp.setState(useApp.getInitialState(), true);
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = getContext;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const paint = (rowRange?: { from: number; to: number }) => {
  strokes = 0;
  render(<PolarStageCore dataset={ds} yKeys={null} seriesStyles={{}} showGrid={false} rowRange={rowRange} theme="dark" accent="violet" />);
  return strokes;
};

describe("polar canvas", () => {
  it("strokes every analysis row without a window and only the window's rows with one", () => {
    expect(paint()).toBe(N - 2); // rows 26 and 101 are excluded
    expect(paint(WINDOW)).toBe(23); // 24 rows less row 26
  });

  it("does not apply a window past the sheet: every row draws", () => {
    expect(paint({ from: 20, to: 999 })).toBe(N - 2);
  });

  it("the focused stage reads the window from the store and shows its chip", () => {
    useApp.setState({ datasets: [ds], activeId: "p", rowRange: WINDOW, showGrid: false });
    const { getByRole } = render(<PolarStage />);
    expect(getByRole("status").textContent).toContain("rows 21-44 of 200");
    expect(getByRole("status").textContent).not.toContain("draws every row");
    expect(strokes).toBe(23);
  });
});

describe("polar export", () => {
  const st = (rowRange?: { from: number; to: number }) => ({ yKeys: null, seriesStyles: {}, seriesLabels: {}, showGrid: false, pageSetup: undefined, rowRange });
  const opts = { fmt: "svg" as const, style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

  it("holds the window's rows only, and ranges the radius over them alone: the canvas' rows", () => {
    const spec = buildPolarFigureSpec(st(WINDOW) as never, ds, "s", opts as never);
    expect(spec.dataset.time).toHaveLength(23);
    expect(spec.dataset.values.map((row) => row[0])).toEqual(Array.from({ length: 24 }, (_v, i) => i + 1).filter((v) => v !== 6));
    expect(spec.polar?.r_lim).toEqual([1, 24]);
  });

  it("is unchanged without a window and refuses one past the sheet", () => {
    expect(buildPolarFigureSpec(st() as never, ds, "s", opts as never).dataset.time).toHaveLength(N - 2);
    expect(() => buildPolarFigureSpec(st({ from: 20, to: 999 }) as never, ds, "s", opts as never)).toThrow(/Plot row range: rows 21-1000 is beyond/);
  });
});
