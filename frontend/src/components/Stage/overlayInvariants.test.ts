// The overlay invariants I1-I6 (lib/overlayPlacement.ts header), each proved
// across EVERY caller that can draw or ship an overlay: the canvas (the real
// usePlotPayload pipeline), the direct export (no focused window), the export
// through the focused window's document, Send to report, and reopening a saved
// fit. Every path runs against ONE real store state; assertions are on drawn
// (x, y) values, never on mock calls.
//
// Sheet: T1,R1,T2,R2 (lib/test/ownXFixture) -- `time` is T1, channels R1 (0),
// T2 (1, "Set As X", non-monotonic 40,10,30,20), R2 (2).

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "../../lib/api/figures";
import type { StoreGet } from "../../lib/exportActive";
import { fitAnalysisResult } from "../../lib/fitAnalysisResult";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { PlotPayload } from "../../lib/plotdata";
import type { ReportFigureBlock } from "../../lib/report";
import { NEW_REPORT, runSendFigureToReportCommand } from "../../lib/sendFigureToReport";
import type { Dataset, FitOverlay, FitSpec, OverlayBinding } from "../../lib/types";
import {
  prepareAnalysisResultPlot, recalculateFitAnalysisResult, sendAnalysisResultPlotToReport,
} from "../../store/analysisResultActions";
import { fitDrawBinding } from "../../lib/fitDrawBinding";
import { specCarriesFit } from "../../store/analysisResultPlotOpen";
import { useApp } from "../../store/useApp";
import { peakBinding, peakInputs } from "../workshops/peaks/peakInputs";
import { dropGapRows } from "../../lib/api/finitePairs";
import { commitRecomputedFit, withReadProvenance } from "../../lib/fitRecompute";
import { qfitSpec } from "../../lib/quickfit";
import { R1, T1, T2, t1r1t2r2 } from "../../test/ownXFixture";
import { usePerSeriesX } from "./usePerSeriesX";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const mocks = vi.hoisted(() => ({ ask: vi.fn(), fitBands: vi.fn(), fitModel: vi.fn(), listFitModels: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()), fitModel: mocks.fitModel,
}));
vi.mock("../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/curvefit")>()), listFitModels: mocks.listFitModels,
}));
vi.mock("../../store/paramDialog", () => ({ askParams: mocks.ask }));
vi.mock("../../components/overlays/ParamDialog", () => ({ askParams: mocks.ask }));
vi.mock("../../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));
vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0], _yLog: boolean, _xLog: boolean,
      yKeys: number[] | null, y2Keys: number[] | null, xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

const SHEET = t1r1t2r2();
const ON_R2: OverlayBinding = { yKey: 2, xKey: 1 }; // R2 against its own X, T2
const R2_ON_T1: OverlayBinding = { yKey: 2, xKey: null }; // the wrong X for R2
const ON_R1: OverlayBinding = { yKey: 0, xKey: null };
const FIT: FitOverlay = { datasetId: "own", binding: ON_R2, y: [7, 8, 9, 10] };
const FIT_PAIRS = [[40, 7], [10, 8], [30, 9], [20, 10]];
const OPTS = { fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };

function win(document: PlotWindow["document"]): PlotWindow {
  return {
    id: "w1", kind: "plot", title: "Window 1", datasetId: "own", geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, document,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [SHEET], activeId: "own", xKey: null, yKeys: [0, 2], hiddenChannels: [], seriesOrder: null,
    seriesStyles: {}, plotWindows: [], focusedWindowId: null, reports: [], history: [], future: [],
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, excludedDisplay: "hide",
  });
});

// ---- the five callers, all reading the one store ----

/** The canvas: the live Stage pipeline over the store's current view. */
async function canvas(): Promise<PlotPayload> {
  const s = useApp.getState();
  const p: PlotPayloadParams = {
    active: s.datasets.find((d) => d.id === s.activeId), yScale: "linear", xScale: "linear", xKey: s.xKey,
    yKeys: s.yKeys, groupKey: null, y2Keys: null, seriesOrder: s.seriesOrder, seriesStyles: s.seriesStyles,
    seriesLabels: {}, errKeys: {}, hiddenChannels: s.hiddenChannels, waterfall: s.waterfall,
    excludedDisplay: s.excludedDisplay, fitOverlay: s.fitOverlay, baselineOverlay: s.baselineOverlay,
    peakOverlay: s.peakOverlay, derivOverlay: null, selection: null, xLim: null,
  };
  const { result } = renderHook(() => usePlotPayload(p));
  await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
  return result.current.displayPayload!;
}
const direct = (): FigureSpec => buildStageFigureSpec(useApp.getState, SHEET, "own", OPTS);
function throughDocument(): FigureSpec {
  const s = useApp.getState();
  const document = createFigureDocument({ id: "w1-doc", name: "W", datasetId: "own", view: { ...defaultPlotView(), ...s } });
  useApp.setState({ plotWindows: [win(document)], focusedWindowId: "w1" });
  const spec = buildStageFigureSpec(useApp.getState, SHEET, "own", OPTS);
  useApp.setState({ plotWindows: [], focusedWindowId: null });
  return spec;
}
async function report(): Promise<FigureSpec> {
  mocks.ask.mockResolvedValueOnce({ target: NEW_REPORT, caption: "", fmt: "svg", style: "default", greyscale: false });
  const before = useApp.getState().reports.length;
  await runSendFigureToReportCommand(useApp.getState);
  return lastReportSpec(before);
}
function lastReportSpec(before: number): FigureSpec {
  const reports = useApp.getState().reports;
  expect(reports.length).toBe(before + 1);
  const blocks = reports.at(-1)!.report.sections.flatMap((s) => s.blocks)
    .filter((b): b is ReportFigureBlock => b.type === "figure");
  return blocks.at(-1)!.spec as unknown as FigureSpec;
}

/** (x, y) of every drawn point of an overlay, in row order, on screen / on the wire. */
const screen = (p: PlotPayload, label: string) => {
  const i = p.series.findIndex((s) => s.label === label);
  if (i < 0) return [];
  const col = p.data[i + 1] as (number | null)[];
  return (p.data[0] as number[]).flatMap((x, r) => (col[r] == null ? [] : [[x, col[r]]]));
};
const wire = (spec: FigureSpec, label: string) => {
  const k = spec.dataset.labels.indexOf(label);
  if (k < 0) return [];
  const x = (r: number) => (spec.x_key == null ? spec.dataset.time[r] : spec.dataset.values[r][spec.x_key as number]);
  return spec.dataset.values.flatMap((row, r) => (Number.isFinite(row[k]) ? [[x(r), row[k]]] : []));
};

/** The same overlay's points from every caller. */
async function everywhere(label: string) {
  return {
    canvas: screen(await canvas(), label),
    direct: wire(direct(), label),
    document: wire(throughDocument(), label),
    report: wire(await report(), label),
  };
}
const all = (pairs: number[][]) => ({ canvas: pairs, direct: pairs, document: pairs, report: pairs });

describe("I1 -- drawn only at the X and against the Y it was computed on", () => {
  it("an R2 fit sits on T2's rows on screen, in both exports and in the report", async () => {
    useApp.setState({ fitOverlay: FIT });
    expect(await everywhere("fit")).toEqual(all(FIT_PAIRS));
  });

  it("an R2 fit computed on T1 is drawn nowhere -- never moved onto R2's own X", async () => {
    useApp.setState({ fitOverlay: { ...FIT, binding: R2_ON_T1 } });
    expect(await everywhere("fit")).toEqual(all([]));
  });

  it("no-curve markers (-1) on time are drawn nowhere on a multi-X view", async () => {
    useApp.setState({ peakOverlay: { datasetId: "own", binding: { yKey: -1, xKey: null }, y: [null, 20, null, null] } });
    expect(await everywhere("peaks")).toEqual(all([]));
  });
});

describe("I2 -- canvas and every export make the same decision from the same data", () => {
  it("fit, baseline and peaks: identical points, and each scaled by ITS curve's offset", async () => {
    useApp.setState({
      seriesStyles: { 0: { logOffset: 2 } }, // R1 x10^2, R2 none
      fitOverlay: FIT,
      baselineOverlay: { datasetId: "own", binding: ON_R1, y: R1.map((v) => v / 10) },
      peakOverlay: { datasetId: "own", binding: ON_R2, y: [null, 200, null, null] },
    });
    expect(await everywhere("fit")).toEqual(all(FIT_PAIRS)); // R2's: unscaled
    expect(await everywhere("baseline")).toEqual(all(T1.map((x, i) => [x, R1[i] * 10]))); // R1's: x100
    expect(await everywhere("peaks")).toEqual(all([[10, 200]]));
  });

  it("a hidden bound curve drops its overlay on every path", async () => {
    useApp.setState({ hiddenChannels: [2], fitOverlay: FIT });
    expect(await everywhere("fit")).toEqual(all([]));
  });

  it("the document route decides from the DOCUMENT's view alone, never a mix with the live store", () => {
    // The focused document hides R2 and offsets R1; the live singleton shows
    // both, unoffset. Every overlay decision must follow the view the spec
    // was built from: R2's fit is gone, R1's baseline is x10.
    const docView = { ...defaultPlotView(), yKeys: [0, 2], hiddenChannels: [2], seriesStyles: { 0: { logOffset: 1 } } };
    const document = createFigureDocument({ id: "w1-doc", name: "W", datasetId: "own", view: docView });
    const live = useApp.getState();
    const get = (() => ({
      ...live, yKeys: [0, 2], hiddenChannels: [], seriesStyles: {}, focusedWindowId: "w1",
      windowsForSave: () => [win(document)],
      fitOverlay: FIT, baselineOverlay: { datasetId: "own", binding: ON_R1, y: [1, 2, 3, 4] },
    })) as unknown as StoreGet;
    const spec = buildStageFigureSpec(get, SHEET, "own", OPTS);
    expect(spec.y_keys?.slice(0, 1)).toEqual([0]); // the document's curves
    expect(wire(spec, "fit")).toEqual([]);
    expect(wire(spec, "baseline")).toEqual([[1, 10], [2, 20], [3, 30], [4, 40]]);

    // The reverse: the document plots R2, the live singleton does not. The
    // spec draws R2 (the document's), so its fit rides with it -- placement is
    // not decided from the live yKeys.
    const shows = createFigureDocument({ id: "w1-doc", name: "W", datasetId: "own", view: { ...defaultPlotView(), yKeys: [0, 2] } });
    const get2 = (() => ({
      ...live, yKeys: [0], focusedWindowId: "w1", windowsForSave: () => [win(shows)], fitOverlay: FIT,
    })) as unknown as StoreGet;
    expect(wire(buildStageFigureSpec(get2, SHEET, "own", OPTS), "fit")).toEqual(FIT_PAIRS);
  });
});

describe("I3 -- provenance is what was really fitted, separate from where markers go", () => {
  // time = row index; T1 (0, X), R1 (1), T2 (2, X), R2 (3): channel 0 is an X column.
  const xyxy = (over: Partial<Dataset> = {}): Dataset => ({
    id: "xyxy", name: "xyxy.csv",
    data: {
      time: [0, 1, 2], values: [[1, 10, 40, 100], [2, 20, 10, 200], [3, 30, 30, 300]],
      labels: ["T1", "R1", "T2", "R2"], units: ["K", "ohm", "K", "ohm"], metadata: {},
    },
    columnDesignations: { 0: "X", 2: "X" },
    ...over,
  });

  it("a fallback peak fit records the first VALUE channel against its own X, never the X column", () => {
    const pi = peakInputs(xyxy(), 0, [0], null); // nothing effective -> fallback
    expect(pi.yKeyUsed).toBe(1); // R1, not T1
    expect(pi.xKeyUsed).toBe(0); // R1's own X
    expect(pi.x).toEqual([1, 2, 3]);
    expect(pi.y).toEqual([10, 20, 30]);
    expect(peakBinding(pi)).toEqual({ yKey: -1, xKey: 0 }); // markers: no curve
  });

  it("records no Y when there is no value channel, and keeps the Y when every row is filtered out", () => {
    const none = peakInputs(xyxy({ columnDesignations: { 0: "X", 1: "X", 2: "X", 3: "X" } }), 0, [0], null);
    expect(none).toMatchObject({ yKeyUsed: null, x: [], y: [] });
    expect(peakBinding(none).yKey).toBe(-1);
    const empty = peakInputs(xyxy({ excludedRows: [0, 1, 2] }), 0, [0], null);
    expect(empty).toMatchObject({ yKeyUsed: 1, x: [], y: [] });
  });

  it("a recalculated fit records the X it actually re-read (R2's own T2), not a stale T1", async () => {
    mocks.fitModel.mockResolvedValue({ params: [2, 1], errors: [0, 0], R2: 1, RMSE: 0, yFit: [1, 2, 3, 4], exitFlag: 1 });
    mocks.listFitModels.mockResolvedValue({ models: [{ name: "Linear", paramNames: ["a", "b"] }] });
    const spec: FitSpec = { model: "Linear", xKey: null, yKey: 2, params: [1, 0], errors: [0, 0], p0: [1, 0], fixed: [false, false], nPoints: 4 };
    const ds: Dataset = { ...SHEET, fitSpec: spec };
    useApp.setState({ datasets: [ds], analysisResults: [fitAnalysisResult(ds, spec)], staleFits: ["own"] });
    expect(await recalculateFitAnalysisResult("analysis-fit-own")).toBe(true);
    expect(mocks.fitModel).toHaveBeenCalledWith(expect.objectContaining({ x: T2 }));
    expect(useApp.getState().datasets[0].fitSpec).toMatchObject({ xKey: 1, yKey: 2 });
  });

  it("a quick fit of a curve on the TIME column records time, not the plot's X", () => {
    // Plot X = T2: R1's own X is the time column (T1), recorded as null.
    const spec = qfitSpec(SHEET, { xKey: 1, yKeys: [0], seriesOrder: null, hiddenChannels: [] }, "Linear", null, ON_R1);
    expect(spec).toMatchObject({ xKey: null, yKey: 0 });
  });

  it("a fully legacy spec's re-fit never promotes the live plot's channels to provenance", () => {
    const legacy: FitSpec = { model: "Linear", params: [1, 0] };
    const ds: Dataset = { ...SHEET, fitSpec: legacy };
    useApp.setState({ datasets: [ds] });
    const result = { params: [2, 1], errors: [0, 0], R2: 1, RMSE: 0, yFit: [1, 2, 3, 4], exitFlag: 1 };
    commitRecomputedFit(useApp.setState, useApp.getState, ds, legacy, dropGapRows(T1, R1), ON_R1, result);
    const saved = useApp.getState().datasets[0].fitSpec!;
    expect(saved.xKey).toBeUndefined();
    expect(saved.yKey).toBeUndefined();
    expect(saved.params).toEqual([2, 1]);
  });

  it("a re-fit records the X it read only when the spec recorded X and Y and that Y was read", () => {
    const spec: FitSpec = { model: "Linear", xKey: null, yKey: 2 };
    expect(withReadProvenance(spec, ON_R2)).toEqual({ ...spec, xKey: 1 }); // R2 re-read on its own T2
    expect(withReadProvenance({ model: "Linear", yKey: 2 }, ON_R2).xKey).toBeUndefined(); // no recorded X: kept
    expect(withReadProvenance({ model: "Linear", xKey: null, yKey: 5 }, ON_R2)).toMatchObject({ xKey: null, yKey: 5 }); // fallback read
    const same = { model: "Linear", xKey: 1, yKey: 2 };
    expect(withReadProvenance(same, ON_R2)).toBe(same);
  });

  it("the result card refuses to send exactly what the gate refuses", () => {
    // Both ask lib/fitDrawBinding; a stale X (resolved to time) is refused.
    expect(fitDrawBinding(SHEET, { channels: [2], xChannel: null }, { xKey: 7, yKey: 2 })).toBeNull();
  });

  it("a fit is never drawn against an X-designated column as its Y", () => {
    expect(fitDrawBinding(SHEET, { channels: [1], xChannel: null }, { xKey: null, yKey: 1 })).toBeNull();
    expect(fitDrawBinding(SHEET, { channels: [2], xChannel: 1 }, { xKey: 1, yKey: 2 })).toEqual(ON_R2);
  });
});

describe("I4 -- plot-open and fit-draw are separate, and every consumer honours a refusal", () => {
  const base: FitSpec = {
    model: "Linear", params: [2, 1], errors: [0, 0], p0: [1, 0], fixed: [false, false], nPoints: 4,
  };
  function saveFit(spec: FitSpec) {
    const ds: Dataset = { ...SHEET, fitSpec: spec };
    useApp.setState({ datasets: [ds], analysisResults: [fitAnalysisResult(ds, spec)], yKeys: [0], xKey: null });
  }
  beforeEach(() => {
    mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({
      yFit: x.map((v) => 2 * v + 1), ciLo: [], ciHi: [], piLo: [], piHi: [], level: 0.95,
    }));
  });
  const MODEL_ON_T2 = T2.map((x) => [x, 2 * x + 1]);

  it("a matching fit reopens on its own X and draws the same points on screen, in the exports and in the report", async () => {
    saveFit({ ...base, xKey: 1, yKey: 2 });
    expect(await prepareAnalysisResultPlot("analysis-fit-own", 0)).not.toBeNull();
    expect(useApp.getState().fitOverlay?.binding).toEqual(ON_R2);
    expect(screen(await canvas(), "fit")).toEqual(MODEL_ON_T2);
    expect(wire(direct(), "fit")).toEqual(MODEL_ON_T2);
    expect(wire(throughDocument(), "fit")).toEqual(MODEL_ON_T2);
    mocks.ask.mockResolvedValueOnce({ target: NEW_REPORT, caption: "", fmt: "svg", style: "default", greyscale: false });
    expect(await sendAnalysisResultPlotToReport("analysis-fit-own", 0)).toBe(true);
    expect(wire(lastReportSpec(0), "fit")).toEqual(MODEL_ON_T2);
  });

  const refusals: [string, Partial<FitSpec>][] = [
    ["a stale X (out of range, resolved to time)", { xKey: 7, yKey: 2 }],
    ["a legacy fit with NO recorded X", { yKey: 2 }],
    ["an X-designated column recorded as the Y", { xKey: null, yKey: 1 }],
    ["R2 recorded against T1 (its curve is drawn on T2)", { xKey: null, yKey: 2 }],
  ];
  for (const [what, spec] of refusals) {
    it(`${what}: Open shows the plot without the fit; Send to report refuses and changes nothing`, async () => {
      saveFit({ ...base, ...spec });
      expect(await prepareAnalysisResultPlot("analysis-fit-own", 0)).not.toBeNull();
      expect(useApp.getState().fitOverlay).toBeNull();
      expect(useApp.getState().status).toContain("opened the plot without the fit");
      expect(useApp.getState().status).toContain("Re-fit");
      expect(mocks.fitBands).not.toHaveBeenCalled();

      useApp.setState({ yKeys: [0], xKey: null, fitOverlay: null, status: "" });
      expect(await sendAnalysisResultPlotToReport("analysis-fit-own", 0)).toBe(false);
      expect(useApp.getState().reports).toEqual([]);
      expect(useApp.getState().status).toContain("can't send fitted plot");
      expect(useApp.getState().status).toContain("Re-fit");
      expect(useApp.getState()).toMatchObject({ yKeys: [0], xKey: null, fitOverlay: null });
      expect(mocks.ask).not.toHaveBeenCalled();
    });
  }

  it("Send to report says false when nothing was added (dialog cancelled)", async () => {
    saveFit({ ...base, xKey: 1, yKey: 2 });
    mocks.ask.mockResolvedValueOnce(null);
    expect(await sendAnalysisResultPlotToReport("analysis-fit-own", 0)).toBe(false);
    expect(mocks.ask).toHaveBeenCalledTimes(1); // the dialog really opened, and was cancelled
    expect(useApp.getState().fitOverlay?.binding).toEqual(ON_R2);
    expect(useApp.getState().reports).toEqual([]);
  });

  it("Open shows a hidden fitted curve, so its fit is really drawn", async () => {
    saveFit({ ...base, xKey: 1, yKey: 2 });
    useApp.setState({ hiddenChannels: [2] });
    expect(await prepareAnalysisResultPlot("analysis-fit-own", 0)).not.toBeNull();
    expect(useApp.getState().hiddenChannels).toEqual([]);
    expect(screen(await canvas(), "fit")).toEqual(MODEL_ON_T2);
  });

  it("Send to report refuses before the dialog when the view's figure cannot carry the drawn fit (polar)", async () => {
    saveFit({ ...base, xKey: 1, yKey: 2 });
    useApp.setState({ polarMode: true });
    expect(await sendAnalysisResultPlotToReport("analysis-fit-own", 0)).toBe(false);
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().status).toContain("cannot carry the fit");
    expect(mocks.ask).not.toHaveBeenCalled(); // no answers asked for, then thrown away
  });

  it("the built-figure check counts only a fit series on a shape overlays can ride", () => {
    const fitCol = { dataset: { ...SHEET.data, labels: [...SHEET.data.labels, "fit"] }, y_keys: [0, 3], fmt: "svg" } as FigureSpec;
    expect(specCarriesFit(fitCol, SHEET)).toBe(true);
    expect(specCarriesFit({ ...fitCol, encoding: {} } as FigureSpec, SHEET)).toBe(false); // an encoding's "fit" category
    expect(specCarriesFit(null, SHEET)).toBe(false); // a stat figure
  });
});

describe("I5 -- a single-X view keeps today's behaviour", () => {
  const ONE: Dataset = { ...SHEET, columnDesignations: {} }; // R1, T2, R2 all on T1

  it("a legacy unbound fit still draws on a single-X sheet, everywhere -- and on no multi-X view", async () => {
    const legacy = { datasetId: "own", y: [7, 8, 9, 10] } as unknown as FitOverlay;
    useApp.setState({ datasets: [ONE], yKeys: [0], fitOverlay: legacy });
    const pairs = T1.map((x, i) => [x, 7 + i]);
    const canvasPairs = screen(await canvas(), "fit");
    expect(canvasPairs).toEqual(pairs);
    const spec = buildStageFigureSpec(useApp.getState, ONE, "own", OPTS);
    expect(wire(spec, "fit")).toEqual(pairs);
    useApp.setState({ datasets: [SHEET], yKeys: [0, 2] });
    expect(await everywhere("fit")).toEqual(all([]));
  });

  it("a bound overlay on a single-X sheet is drawn as the very object given", () => {
    const o: FitOverlay = { datasetId: "own", binding: ON_R1, y: [7, 8, 9, 10] };
    const { result } = renderHook(() =>
      usePerSeriesX(ONE, null, null, { yKeys: [0], seriesOrder: null, hiddenChannels: [], fitOverlay: o, baselineOverlay: null, peakOverlay: null, derivOverlay: null }),
    );
    expect(result.current.overlays.fitOverlay).toBe(o);
  });
});

describe("I6 -- no redundant work", () => {
  it("toggling an unrelated curve or renaming returns the SAME placed overlay", () => {
    const props = { yKeys: [0, 2], seriesOrder: null, hiddenChannels: [] as number[], fitOverlay: FIT, baselineOverlay: null, peakOverlay: null, derivOverlay: null };
    const { result, rerender } = renderHook((p: typeof props & { ds: Dataset }) => usePerSeriesX(p.ds, null, null, p), {
      initialProps: { ...props, ds: SHEET },
    });
    const first = result.current.overlays.fitOverlay;
    expect(first?.y).toEqual([null, null, null, null, 7, 8, 9, 10]);
    rerender({ ...props, ds: { ...SHEET, name: "renamed.csv" } }); // same data
    expect(result.current.overlays.fitOverlay).toBe(first);
    rerender({ ...props, ds: SHEET, hiddenChannels: [1] }); // T2 (not R2) toggled
    expect(result.current.overlays.fitOverlay).toBe(first);
  });
});
