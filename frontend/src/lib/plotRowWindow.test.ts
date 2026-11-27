// The plot's row window (ROW_RANGE_CONTRACT 3.3, R2), at the unit level: the
// hidden set, a decimated payload that names its rows, a waterfall X layout, the
// overlay and the point-picking tools, and the export's window.
import { describe, expect, it } from "vitest";

import { buildFigureSpecFromDocument } from "./figureSpec";
import { createFigureDocument } from "./figureDocument";
import { windowFigureInputs } from "./figureRowRange";
import { drawnOverlayLabels, placeAnalysisOverlays } from "./figureSpecOverlays";
import type { PlotPayload } from "./plotdata";
import { withFitOverlay } from "./plotdata";
import { lassoRows, pickRows } from "./plotPointMask";
import { plotRowRangeState } from "./plotRowRangeState";
import { windowRows } from "./plotRowWindow";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

const N = 200;
const payload = (extra: Partial<PlotPayload> = {}): PlotPayload => ({
  data: [Array.from({ length: N }, (_v, i) => i), Array.from({ length: N }, (_v, i) => i * 10)],
  series: [{ label: "y", unit: "", axis: 0 }], xLabel: "x", xUnit: "", decimated: false, window: null, ...extra,
});
const drawn = (p: PlotPayload) => (p.data[0] as (number | null)[]).flatMap((v, r) => (v == null ? [] : [r]));

describe("windowRows", () => {
  it("draws only rows 21-44 of 200, keeps the length and the source index", () => {
    const w = windowRows(payload(), { from: 20, to: 43 });
    expect(drawn(w)).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i));
    expect(w.data[0]).toHaveLength(N);
    expect((w.data[1] as (number | null)[])[25]).toBe(250);
    expect((w.data[1] as (number | null)[])[5]).toBeNull();
  });

  it("is the same object with no range or a range covering every row", () => {
    const p = payload();
    expect(windowRows(p, null)).toBe(p);
    expect(windowRows(p, { from: 0, to: N - 1 })).toBe(p);
  });

  it("a decimated payload masks by its dataset rows (rowIds), not by position", () => {
    const rowIds = [0, 50, 100, 150, 25, 30, 199];
    const p = payload({ rowIds, decimated: true, data: [rowIds.map((r) => r), rowIds.map((r) => r * 10)] });
    expect(drawn(windowRows(p, { from: 20, to: 43 }))).toEqual([4, 5]); // rows 25 and 30
  });

  it("a waterfall X layout hides a row in every block", () => {
    const p = payload({ blockRows: 100, data: [Array.from({ length: 200 }, (_v, i) => i), Array.from({ length: 200 }, (_v, i) => i)] });
    expect(drawn(windowRows(p, { from: 10, to: 12 }))).toEqual([10, 11, 12, 110, 111, 112]);
  });

  it("keeps a fit overlay row-aligned: it shows only inside the window, at the same rows", () => {
    const fit = { datasetId: "d", y: Array.from({ length: N }, (_v, i) => i * 10 + 1) };
    const w = windowRows(withFitOverlay(payload(), fit as never, "d"), { from: 20, to: 43 });
    const col = w.data[2] as (number | null)[];
    expect(col).toHaveLength(N);
    expect(col[30]).toBe(301);
    expect(col[44]).toBeNull();
    expect(col[19]).toBeNull();
  });

  it("an unfit range is not applied and says why (never clamped)", () => {
    expect(plotRowRangeState({ from: 20, to: 43 }, 30)).toMatchObject({ applied: null, label: "rows 21-44 not applied" });
    expect(plotRowRangeState({ from: 20, to: 43 }, 200)).toMatchObject({ applied: { from: 20, to: 43 }, label: "rows 21-44 of 200" });
    expect(plotRowRangeState(null, 200).applied).toBeNull();
  });
});

describe("Select rows and the lasso take the right dataset rows", () => {
  const range = { from: 20, to: 43 };
  const ds: Dataset = {
    id: "d", name: "d",
    data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i * 10]), labels: ["y"], units: [""], metadata: {} },
  };
  const w = windowRows(payload(), range);

  it("an x band across the window and beyond takes only the window's rows; a box likewise", () => {
    const band = pickRows(w, [0], ds, null, { x0: 0, x1: 100 }, range);
    expect(band).toEqual({ rows: Array.from({ length: 24 }, (_v, i) => 20 + i) });
    const box = pickRows(w, [0], ds, null, { x0: 0, x1: 100, y: [0, 1990] }, range);
    expect(box).toEqual({ rows: Array.from({ length: 24 }, (_v, i) => 20 + i) });
  });

  it("a decimated payload is traced with the hidden rows skipped, and picks only the window's rows", () => {
    const rowIds = [0, 25, 30, 150];
    const p = windowRows(payload({ rowIds, decimated: true, data: [rowIds.slice(), rowIds.map((r) => r * 10)] }), range);
    expect(pickRows(p, [0], ds, null, { x0: 0, x1: 199 }, range)).toEqual({ rows: Array.from({ length: 24 }, (_v, i) => 20 + i) });
    expect("refused" in (pickRows(p, [0], ds, null, { x0: 0, x1: 199 }) as object)).toBe(true); // without the range the masked rows cannot be traced
  });

  it("the lasso, whole-plot sized, hits only the window's rows (full and decimated)", () => {
    const everything: [number, number][] = [[-1, -1], [1e4, -1], [1e4, 1e4], [-1, 1e4]];
    const toPx = (x: number, y: number) => [x, y] as const;
    expect(lassoRows(w, [0], ds, null, everything, toPx, range)).toEqual({ rows: Array.from({ length: 24 }, (_v, i) => 20 + i) });
    const rowIds = [0, 25, 150];
    const p = windowRows(payload({ rowIds, decimated: true, data: [rowIds.slice(), rowIds.map((r) => r * 10)] }), range);
    expect(lassoRows(p, [0], ds, null, everything, toPx, range)).toEqual({ rows: Array.from({ length: 24 }, (_v, i) => 20 + i) });
  });
});

describe("the export holds exactly the window", () => {
  const ds: Dataset = {
    id: "d", name: "d", excludedRows: [25, 100],
    data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i * 10]), labels: ["y"], units: [""], metadata: {} },
  };

  it("cuts the data and the live dataset to the window and re-bases its exclusions", () => {
    const [data, extras] = windowFigureInputs({ from: 20, to: 43 }, ds.data, { liveDataset: ds });
    expect(data.time).toHaveLength(24);
    expect(data.time[0]).toBe(20);
    expect(extras.liveDataset?.excludedRows).toEqual([5]); // row 26, inside; row 101 is outside and gone
    expect(extras.liveDataset?.data).toBe(data);
  });

  it("refuses a range past the sheet or a pending sheet, never clamping", () => {
    expect(() => windowFigureInputs({ from: 20, to: 300 }, ds.data, { liveDataset: ds })).toThrow(/Plot row range: rows 21-301 is beyond/);
    expect(() => windowFigureInputs({ from: 0, to: 3 }, ds.data, { liveDataset: { ...ds, pending: {} as never } })).toThrow(/still loading/);
  });

  it("builds a spec of 24 rows less the excluded one", () => {
    const doc = createFigureDocument({ id: "w", name: "W", datasetId: "d", view: { ...defaultPlotView(), yKeys: [0], rowRange: { from: 20, to: 43 } } });
    const spec = buildFigureSpecFromDocument(doc, ds, "s", { fmt: "svg" });
    expect(spec.dataset.time).toHaveLength(23);
    expect(spec.dataset.time).not.toContain(25);
    expect(spec.dataset.time[0]).toBe(20);
  });

  it("carries no analysis overlay under a window and reports it as left out", () => {
    const fit = { datasetId: "d", binding: { yKey: 0, xKey: null }, y: Array.from({ length: N }, (_v, i) => i) };
    const doc = createFigureDocument({ id: "w", name: "W", datasetId: "d", view: { ...defaultPlotView(), yKeys: [0], rowRange: { from: 20, to: 43 } } });
    const spec = buildFigureSpecFromDocument(doc, ds, "s", { fmt: "svg" });
    const view = { ...defaultPlotView(), yKeys: [0], rowRange: { from: 20, to: 43 } };
    const placed = placeAnalysisOverlays(spec, ds, view, { fitOverlay: fit as never, baselineOverlay: null, peakOverlay: null });
    expect(placed.spec).toBe(spec);
    expect(placed.dropped.length).toBeGreaterThan(0);
    expect(placed.dropped).toEqual(drawnOverlayLabels(ds, view, { fitOverlay: fit as never, baselineOverlay: null, peakOverlay: null }));
  });
});
