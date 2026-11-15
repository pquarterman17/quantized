// Gap audit 5 lane C: a SAVED figure keeps its fit. The canvas, the saved
// figure's own export, a Figure Page panel built from it and a batch / Library
// multi-figure export all draw the SAME points, and every one fails closed the
// same way. Same harness and sheet as overlayInvariants.test.ts (the shared
// T1,R1,T2,R2 fixture, test/ownXFixture): R2's fit is bound to R2's OWN X, T2
// (#679), so a path that guessed the plot's X would put it on T1's rows.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FigureSpec } from "../../lib/api/figures";
import { batchFigureSpecs } from "../../lib/batchFigureExport";
import { createFigureDocument, type FigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { PlotPayload } from "../../lib/plotdata";
import type { FitOverlay } from "../../lib/types";
import { loadWindowOverlays } from "../../store/windowOverlaysLazy";
import { useApp } from "../../store/useApp";
import { R2, T1, t1r1t2r2 } from "../../test/ownXFixture";
import { panelFigure } from "../workshops/figurepage/panelResolve";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const SHEET = t1r1t2r2();
const FIT: FitOverlay = { datasetId: "own", binding: { yKey: 2, xKey: 1 }, y: [7, 8, 9, 10] };
const FIT_PAIRS = [[40, 7], [10, 8], [30, 9], [20, 10]]; // on T2, R2's own X
const BAND = [
  { label: "95% CI low", y: [6, 7, 8, 9], legend: "95% confidence band" },
  { label: "95% CI high", y: [8, 9, 10, 11], legend: "" },
];
const OPTS = { fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };

function win(document: FigureDocument): PlotWindow {
  return {
    id: "w1", kind: "plot", title: "Window 1", datasetId: "own", geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, document,
  };
}

beforeAll(async () => { await loadWindowOverlays(); }); // the lazy fold / seed module

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  const document = createFigureDocument({ id: "fig-1", name: "R vs T", datasetId: "own", view: { ...defaultPlotView(), yKeys: [0, 2] } });
  useApp.setState({
    datasets: [SHEET], activeId: "own", xKey: null, yKeys: [0, 2], hiddenChannels: [], seriesOrder: null,
    seriesStyles: {}, plotWindows: [win(document)], focusedWindowId: "w1", editableFigures: [],
    fitOverlay: FIT, baselineOverlay: null, peakOverlay: null, derivOverlay: null, excludedDisplay: "hide",
  });
});

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
const screen = (p: PlotPayload, label: string) => {
  const i = p.series.findIndex((s) => s.label === label);
  if (i < 0) return [];
  const col = p.data[i + 1] as (number | null)[];
  return (p.data[0] as number[]).flatMap((x, r) => (col[r] == null ? [] : [[x, col[r]]]));
};
const wire = (spec: FigureSpec | null, label: string) => {
  if (!spec) return [];
  const k = spec.dataset.labels.indexOf(label);
  if (k < 0) return [];
  const x = (r: number) => (spec.x_key == null ? spec.dataset.time[r] : spec.dataset.values[r][spec.x_key as number]);
  return spec.dataset.values.flatMap((row, r) => (Number.isFinite(row[k]) ? [[x(r), row[k]]] : []));
};

/** Save the focused window as an editable figure, then forget the live fit
 *  (as a later session, another dataset's fit, or a reload would). */
function saveAndForget(): FigureDocument {
  const id = useApp.getState().saveFigure("w1")!;
  useApp.setState({ fitOverlay: null });
  return useApp.getState().editableFigures.find((figure) => figure.id === id)!;
}

describe("a saved figure keeps its fit (gap audit 5 lane C)", () => {
  it("canvas, the saved figure's export, a Figure Page panel and a batch export draw the same points", async () => {
    useApp.setState({ fitOverlay: { ...FIT, band: BAND } });
    const onScreen = screen(await canvas(), "fit");
    const saved = saveAndForget();
    expect(saved.overlays?.fit?.binding).toEqual({ yKey: 2, xKey: 1 });
    const own = buildFigureSpecFromDocument(saved, SHEET, saved.name);
    const panel = await panelFigure({ kind: "figure", id: saved.id, name: saved.name });
    const [batch] = batchFigureSpecs([saved], [SHEET], { format: "pdf", archiveName: "x" });
    expect({ onScreen, own: wire(own, "fit"), panel: wire(panel, "fit"), batch: wire(batch, "fit") })
      .toEqual({ onScreen: FIT_PAIRS, own: FIT_PAIRS, panel: FIT_PAIRS, batch: FIT_PAIRS });
    // The band rides with it, as on the Stage export.
    expect(own.dataset.labels.slice(SHEET.data.labels.length)).toEqual(["fit", "95% CI low", "95% CI high"]);
  });

  it("the saved figure renders exactly as the Stage export of the live canvas did (one wire)", () => {
    const stage = buildStageFigureSpec(useApp.getState, SHEET, "own", OPTS);
    const saved = saveAndForget();
    const own = buildFigureSpecFromDocument(saved, SHEET, "own", { ...OPTS, filename: null, defaultTrace: "Line", defaultLineWidth: useApp.getState().defaultLineWidth });
    expect(own.dataset).toEqual(stage.dataset);
    expect(own.y_keys).toEqual(stage.y_keys);
    expect(own.series_styles).toEqual(stage.series_styles);
  });

  it("the Stage export of a window whose document holds the fit draws it once, not twice", () => {
    saveAndForget();
    useApp.setState({ fitOverlay: FIT }); // the canvas draws it again (seeded on focus)
    const spec = buildStageFigureSpec(useApp.getState, SHEET, "own", OPTS);
    expect(spec.dataset.labels.filter((label) => label === "fit")).toHaveLength(1);
  });

  it("fails closed when the data changed since the save: no fit, and the page says so", async () => {
    const saved = saveAndForget();
    const edited = { ...SHEET, data: { ...SHEET.data, values: SHEET.data.values.map((row, i) => (i === 0 ? [row[0], row[1], R2[0] + 1] : row)) } };
    useApp.setState({ datasets: [edited] });
    const dropped: string[][] = [];
    const own = buildFigureSpecFromDocument(saved, edited, saved.name, { onDroppedOverlays: (labels) => dropped.push(labels) });
    expect(wire(own, "fit")).toEqual([]);
    expect(dropped).toEqual([["fit"]]);
    const panel = await panelFigure({ kind: "figure", id: saved.id, name: saved.name });
    expect(wire(panel, "fit")).toEqual([]);
    expect(useApp.getState().status).toMatch(/"Window 1": saved fit left out/);
  });

  it("review #5: fails closed when rows were excluded since the save, or the fit is marked stale", () => {
    const saved = saveAndForget();
    const dropped: string[][] = [];
    const excluded = { ...SHEET, excludedRows: [1] };
    expect(wire(buildFigureSpecFromDocument(saved, excluded, "x", { onDroppedOverlays: (l) => dropped.push(l) }), "fit")).toEqual([]);
    useApp.setState({ staleFits: ["own"] });
    expect(wire(buildFigureSpecFromDocument(saved, SHEET, "x", { onDroppedOverlays: (l) => dropped.push(l) }), "fit")).toEqual([]);
    expect(dropped).toEqual([["fit"], ["fit"]]);
    useApp.setState({ staleFits: [] });
    expect(wire(buildFigureSpecFromDocument(saved, SHEET, "x"), "fit")).toEqual(FIT_PAIRS);
  });

  it("fails closed when its bound curve is hidden on the saved figure", () => {
    const saved = saveAndForget();
    const hidden = createFigureDocument({
      id: saved.id, name: saved.name, datasetId: "own", view: { ...defaultPlotView(), yKeys: [0, 2], hiddenChannels: [2] }, overlays: saved.overlays,
    });
    const dropped: string[][] = [];
    const spec = buildFigureSpecFromDocument(hidden, SHEET, "x", { onDroppedOverlays: (labels) => dropped.push(labels) });
    expect(wire(spec, "fit")).toEqual([]);
    expect(dropped).toEqual([["fit"]]);
  });

  it("is never drawn on another X: a fit saved against T1 stays off R2's T2 rows", () => {
    useApp.setState({ fitOverlay: { ...FIT, binding: { yKey: 2, xKey: null } } });
    const saved = saveAndForget();
    expect(wire(buildFigureSpecFromDocument(saved, SHEET, "x"), "fit")).toEqual([]);
    expect(T1).toHaveLength(4); // (the T1 rows it would have been guessed onto)
  });
});
