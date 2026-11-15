// Analysis overlays on a per-series-X view (lib/overlayPlacement.ts): on a
// T1,R1,T2,R2 sheet whose T2 is non-monotonic (40, 10, 30, 20), every overlay
// kind is drawn in the block of the X its producer bound it to, in row order,
// with gaps elsewhere -- and the figure export carries the same rows.
// `fetchPlot` delegates to the real offline `buildColumns`, so this is the
// live Stage pipeline.

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "../../lib/api/figures";
import type { StoreGet } from "../../lib/exportActive";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset, FitOverlay, OverlayBinding } from "../../lib/types";
import { R1, T1, T2, t1r1t2r2 } from "../../test/ownXFixture";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0],
      _yLog: boolean,
      _xLog: boolean,
      yKeys: number[] | null,
      y2Keys: number[] | null,
      xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

const SHEET = t1r1t2r2(); // channels R1 (0), T2 (1, "Set As X"), R2 (2)
const ON_R2: OverlayBinding = { yKey: 2, xKey: 1 };
const ON_R1: OverlayBinding = { yKey: 0, xKey: null };
const N = [null, null, null, null];
const NONE = {};

function params(over: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: SHEET, yScale: "linear", xScale: "linear", xKey: null, yKeys: null, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: NONE, seriesLabels: NONE, errKeys: NONE,
    hiddenChannels: [1], waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
    peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...over,
  };
}

async function draw(over: Partial<PlotPayloadParams>): Promise<PlotPayload> {
  const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params(over) });
  await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
  return result.current.displayPayload!;
}
const column = (p: PlotPayload, label: string) => {
  const i = p.series.findIndex((s) => s.label === label);
  return i < 0 ? undefined : (p.data[i + 1] as (number | null)[]);
};
/** (x, y) at every drawn point of a column, in row order. */
const pairs = (p: PlotPayload, label: string) =>
  (p.data[0] as number[]).flatMap((x, i) => (column(p, label)?.[i] == null ? [] : [[x, column(p, label)![i]]]));

const fit = (binding: OverlayBinding, y: (number | null)[] = [7, 8, 9, 10], ds = "own"): FitOverlay => ({ datasetId: ds, binding, y });

describe("overlays on a per-series-X view", () => {
  it("draws a fit of R2 (with its band) in the T2 block, in acquisition order", async () => {
    const p = await draw({
      fitOverlay: { ...fit(ON_R2), band: [{ label: "lo", y: [6, 7, 8, 9] }, { label: "hi", y: [8, 9, 10, 11] }] },
    });
    expect(p.data[0]).toEqual([...T1, ...T2]);
    expect(column(p, "fit")).toEqual([...N, 7, 8, 9, 10]);
    expect(pairs(p, "fit")).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
    expect(column(p, "lo")).toEqual([...N, 6, 7, 8, 9]);
    expect(column(p, "hi")).toEqual([...N, 8, 9, 10, 11]);
  });

  it("draws a baseline of R1 in the T1 block", async () => {
    const p = await draw({ baselineOverlay: { datasetId: "own", binding: ON_R1, y: [0.5, 1, 1.5, 2] } });
    expect(column(p, "baseline")).toEqual([0.5, 1, 1.5, 2, ...N]);
    expect(pairs(p, "baseline")).toEqual([[1, 0.5], [2, 1], [3, 1.5], [4, 2]]);
  });

  it("draws R2's peak markers at T2's rows only", async () => {
    const p = await draw({ peakOverlay: { datasetId: "own", binding: ON_R2, y: [null, 200, null, null] } });
    expect(column(p, "peaks")).toEqual([...N, null, 200, null, null]);
    expect(pairs(p, "peaks")).toEqual([[10, 200]]);
  });

  it("draws R2's dy/dx in the T2 block", async () => {
    const p = await draw({ derivOverlay: fit(ON_R2, [-1, 2, -3, 4]) });
    expect(column(p, "dy/dx")).toEqual([...N, -1, 2, -3, 4]);
  });

  it("keeps the fit on T2 when the series are reordered after fitting", async () => {
    for (const seriesOrder of [[2, 0], [0, 2], null]) {
      const p = await draw({ seriesOrder, fitOverlay: fit(ON_R2) });
      expect(pairs(p, "fit")).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
    }
  });

  it("does not draw a fit whose X has no block (all of T2's curves hidden)", async () => {
    const p = await draw({ hiddenChannels: [1, 2], fitOverlay: fit(ON_R2) });
    expect(p.data[0]).toEqual(T1); // the view collapsed to T1 alone
    expect(column(p, "fit")).toBeUndefined();
  });

  it("does not guess an unbound (legacy) fit onto the multi-X view", async () => {
    const legacy = { datasetId: "own", y: [7, 8, 9, 10] } as unknown as FitOverlay;
    const p = await draw({ fitOverlay: legacy });
    expect(column(p, "fit")).toBeUndefined();
    // On a one-X view of the same sheet it draws exactly as it always did.
    const one = await draw({ hiddenChannels: [1, 2], fitOverlay: legacy });
    expect(column(one, "fit")).toEqual([7, 8, 9, 10]);
  });

  it("leaves a single-X sheet exactly as before: the overlay object is drawn as given", async () => {
    const single: Dataset = { ...SHEET, columnDesignations: {} };
    const o = fit(ON_R1, [7, null, 9, 10]);
    const p = await draw({ active: single, fitOverlay: o });
    expect(p.data[0]).toEqual(T1);
    expect(column(p, "fit")).toBe(o.y);
  });
});

describe("canvas / export parity on a per-series-X view", () => {
  // The export a focused Stage window produces (lib/figureSpecStage), from the
  // same state the canvas drew.
  function exportSpec(
    ds: Dataset,
    view: { hiddenChannels: number[]; seriesStyles?: PlotPayloadParams["seriesStyles"] },
    overlays: Record<string, unknown>,
  ): FigureSpec {
    const pv = { ...defaultPlotView(), yKeys: null, ...view };
    const document = createFigureDocument({ id: "w1-doc", name: "Fit", datasetId: ds.id, view: pv });
    const get = (() => ({
      ...pv,
      focusedWindowId: "w1",
      windowsForSave: () => [{ id: "w1", kind: "plot", document }],
      autoSeriesStyles: false,
      defaultTrace: "Line",
      defaultLineWidth: 1.5,
      excludedDisplay: "hide",
      fitOverlay: null,
      baselineOverlay: null,
      peakOverlay: null,
      ...overlays,
    })) as unknown as StoreGet;
    return buildStageFigureSpec(get, ds, "own", { fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" });
  }
  const wirePairs = (spec: FigureSpec, label: string) => {
    const k = spec.dataset.labels.indexOf(label);
    return spec.dataset.values.flatMap((row, i) =>
      Number.isFinite(row[k]) ? [[spec.dataset.time[i], row[k]]] : [],
    );
  };

  it("draws the same overlay points on screen and in the FigureSpec", async () => {
    const overlays = {
      fitOverlay: fit(ON_R2),
      baselineOverlay: { datasetId: "own", binding: ON_R1, y: R1.map((v) => v / 2) },
      peakOverlay: { datasetId: "own", binding: ON_R2, y: [null, 200, null, null] },
    };
    const p = await draw(overlays);
    const spec = exportSpec(SHEET, { hiddenChannels: [1] }, overlays);
    for (const label of ["fit", "baseline", "peaks"]) {
      expect(pairs(p, label).length).toBeGreaterThan(0);
      expect(wirePairs(spec, label)).toEqual(pairs(p, label));
    }
    expect(wirePairs(spec, "fit")).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]);
  });

  it("scales each overlay by ITS curve's decade offset, on screen and in the FigureSpec alike", async () => {
    const seriesStyles = { 0: { logOffset: 2 } }; // R1 ×10^2; R2 none
    const overlays = {
      fitOverlay: fit(ON_R2),
      baselineOverlay: { datasetId: "own", binding: ON_R1, y: [1, 2, 3, 4] },
    };
    const p = await draw({ ...overlays, seriesStyles });
    expect(pairs(p, "fit")).toEqual([[40, 7], [10, 8], [30, 9], [20, 10]]); // R2's: unscaled
    expect(pairs(p, "baseline")).toEqual([[1, 100], [2, 200], [3, 300], [4, 400]]); // R1's: ×100
    const spec = exportSpec(SHEET, { hiddenChannels: [1], seriesStyles }, overlays);
    expect(wirePairs(spec, "fit")).toEqual(pairs(p, "fit"));
    expect(wirePairs(spec, "baseline")).toEqual(pairs(p, "baseline"));
  });

  it("agrees with excluded rows too, and drops a fit whose X is hidden in both", async () => {
    const masked: Dataset = { ...SHEET, excludedRows: [1] };
    const o = fit(ON_R2, [7, null, 9, 10]); // the producer leaves the excluded row a gap
    const p = await draw({ active: masked, fitOverlay: o });
    const spec = exportSpec(masked, { hiddenChannels: [1] }, { fitOverlay: o });
    expect(pairs(p, "fit")).toEqual([[40, 7], [30, 9], [20, 10]]);
    expect(wirePairs(spec, "fit")).toEqual(pairs(p, "fit"));

    const hidden = await draw({ active: masked, hiddenChannels: [1, 2], fitOverlay: o });
    expect(column(hidden, "fit")).toBeUndefined();
    expect(exportSpec(masked, { hiddenChannels: [1, 2] }, { fitOverlay: o }).dataset.labels).not.toContain("fit");
  });
});
