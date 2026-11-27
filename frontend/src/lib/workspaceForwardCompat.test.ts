// Forward compatibility with the released v0.34.0 (lib/workspaceForwardCompat.ts).
//
// v0.34.0 opens a .dwk by picking known fields by name. A field it does not
// know is either carried through (kept) or silently dropped, and a re-save
// makes a drop permanent. v0.34.0 refuses any version outside 1-5, so a file
// with a dropped ("gated") field is written as v6: 0.34 says "unsupported
// workspace version: 6" instead of eating the data. Anything else stays v4
// (v5 with transform steps) and still opens in 0.34.
//
// The ratchet: one FEATURES case per gated entry of the classification maps
// (a new gated field without a case fails here), and a kitchen-sink save whose
// every key path 0.34 never wrote must belong to a classified field.
import { describe, expect, it } from "vitest";

import dwk034 from "./__fixtures__/workspace/v4-0.34.0.dwk.json";
import { DEFAULT_MAP_VIEW } from "./mapView";
import type { PlotWindow } from "./plotview";
import type { SavedPlotSpec } from "./plotspec";
import type { FigureOverrides } from "./figureOverrides";
import type { MapAnnotation } from "./mapView";
import type { InsetView } from "./plotviewDecor";
import type { StatMarks } from "./plotviewSanitize";
import type { Annotation, Dataset, RefLine, RegionShade, Shape } from "./types";
import {
  featuresV034WouldDrop,
  parseWorkspace,
  serializeWorkspace,
  WORKSPACE_VERSION,
  WORKSPACE_VERSION_NEW_FEATURES,
  WORKSPACE_VERSION_POST_038,
  WORKSPACE_VERSION_POST_041,
  WORKSPACE_VERSION_POST_045,
  WORKSPACE_VERSION_TRANSFORM_STEPS,
  type LoadedWorkspace,
  type WorkspaceState,
} from "./workspace";
import {
  CLASSIFICATIONS, featuresV038WouldDrop, featuresV041WouldDrop, featuresV045WouldDrop, GATED_VALUES, NEW_SINCE_V038, NEW_SINCE_V041,
  NEW_SINCE_V045,
  REPORT_FIGURE_SPEC, SERIES_STYLE, type OvList,
} from "./workspaceForwardCompat";
import { GATED_METADATA_KEYS } from "./workspaceMetadataGate";

const VIEWPORT = { width: 1600, height: 900 };
const load = (): LoadedWorkspace => parseWorkspace(JSON.stringify(dwk034), VIEWPORT);
const version = (text: string): number => (JSON.parse(text) as { version: number }).version;
const plotWindow = (ws: LoadedWorkspace): PlotWindow => ws.plotWindows![0];
type View = PlotWindow["view"];

/** Apply `edit` to the window's view AND its canonical figure document's view
 *  (a document-backed window reloads its view from the document, as the app
 *  keeps both in step). */
function editView(ws: LoadedWorkspace, edit: (v: View) => void): void {
  const w = plotWindow(ws);
  edit(w.view);
  if (w.document) edit(w.document.plot.view as View);
}
const editFmt = (ws: LoadedWorkspace, patch: Record<string, unknown>): void =>
  editView(ws, (v) => { v.yFmt = { ...v.yFmt, ...patch } as View["yFmt"]; });
/** Publication (export) styles of the saved legacy figure (an array). */
function editExport(ws: LoadedWorkspace, patch: Record<string, unknown>): void {
  const cfg = ws.figureDocs![0].config;
  cfg.seriesStyles = [{ ...(cfg.seriesStyles?.[0] ?? {}), ...patch } as never, null];
}
const spec = (ws: LoadedWorkspace): SavedPlotSpec => ws.savedPlotSpecs![0];
const dataset = (ws: LoadedWorkspace, id: string): Dataset => ws.datasets.find((d) => d.id === id)!;
/** Put a private sidecar value in dataset "c"'s `data.metadata` (the carrier the metadata-key gate reads). */
const setMeta = (ws: LoadedWorkspace, key: string, value: unknown): void => {
  const d = dataset(ws, "c");
  d.data = { ...d.data, metadata: { ...d.data.metadata, [key]: value } };
};

/** One edit per gated field (and gated value), keyed `Type.field`. */
const FEATURES: Record<string, (ws: LoadedWorkspace) => void> = {
  "PlotView.layers": (ws) => editView(ws, (v) => { v.layers = [{ id: "t", kind: "table", rows: [["a", "1"]] } as never]; }),
  // (the fixture's view carries a Y break, which the exchange is refused beside: take it out)
  "PlotView.exchangeXY": (ws) => editView(ws, (v) => {
    v.exchangeXY = true;
    v.yFmt = { ...v.yFmt, breaks: undefined };
    v.y2Fmt = v.y2Fmt && { ...v.y2Fmt, breaks: undefined };
  }),
  "PlotView.yAxes": (ws) => editView(ws, (v) => { v.yAxes = [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }]; }),
  "PlotView.yAxisOf": (ws) => editView(ws, (v) => {
    v.yAxes = [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }];
    v.yAxisOf = { 1: 3 };
  }),
  "PlotView.seriesRamp": (ws) => editView(ws, (v) => { v.seriesRamp = { map: "viridis" }; }),
  "PlotView.pointLabels": (ws) => editView(ws, (v) => { v.pointLabels = { key: 1, mode: "top", topN: 5 }; }),
  "PointLabels.avoid": (ws) => editView(ws, (v) => { v.pointLabels = { key: 1, mode: "top", topN: 5, avoid: { leaderDistance: 2, leaderWidth: 1, leaderDashed: false } }; }),
  "PointLabels.text": (ws) => editView(ws, (v) => { v.pointLabels = { key: -1, text: "Name", mode: "all", topN: 5 }; }),
  "PlotView.rowRange": (ws) => editView(ws, (v) => { v.rowRange = { from: 20, to: 43 }; }),
  "PlotView.overlays": (ws) => editView(ws, (v) => { v.overlays = { line: { band: "none", level: 0.95 }, smoother: null, ellipse: null }; }),
  "ErrorBinding.origin": (ws) => {
    const doc = plotWindow(ws).document!;
    doc.bindings = { ...doc.bindings, errors: [...doc.bindings.errors, { channel: 1, target: 0, axis: "x", side: "both", origin: true }] };
  },
  "PlotWindow.linkYGroup": (ws) => { plotWindow(ws).linkYGroup = 1; },
  "AxisFormat.prob": (ws) => editFmt(ws, { prob: "percent" }),
  "AxisFormat.custom": (ws) => editFmt(ws, { custom: { at: [1, 2] } }),
  "AxisFormat.cross": (ws) => editFmt(ws, { cross: 0 }),
  "AxisFormat.reverse": (ws) => editFmt(ws, { reverse: true }),
  "AxisFormat.rotate": (ws) => editFmt(ws, { rotate: 45 }),
  "AxisFormat.offset": (ws) => editFmt(ws, { offset: 5 }),
  "AxisFormat.grid": (ws) => editFmt(ws, { grid: { major: true, minor: false } }),
  // WORKSPACE_LAYOUT_PLAN P0: written only in windows mode (a pref, not file content).
  "Workspace.windowLayout": (ws) => {
    const plot = `plot:${plotWindow(ws).id}` as const;
    Object.assign(ws as WorkspaceState, {
      layoutMode: "windows",
      windowLayout: {
        v: 1, z: [], edges: { left: 0, right: 320, bottom: 0 }, centre: "row", data: { pinned: null, follow: "plot" },
        placements: { [plot]: { slot: "centre", order: 0, share: 1, lastSlot: "centre", open: true }, style: { slot: "right", order: 0, share: 1, lastSlot: "right", open: true } },
      },
    });
  },
  "Workspace.savedRecodeMappings": (ws) => {
    ws.savedRecodeMappings = [{ id: "r1", name: "m", mapping: { groups: [{ newLabel: "P", from: ["a"] }] }, sourceLevels: ["a"], createdAt: "2026-11-16T00:00:00Z" }];
  },
  // Plan item 21: v0.34-v0.41 read the top-level keys one by one and drop this one.
  "Workspace.ternaryFigures": (ws) => {
    ws.ternaryFigures = {
      [ws.datasets[0]!.id]: {
        picks: { a: 0, b: 1, c: 0, colorBy: 1 },
        field: { kind: "heatmap", cmap: "viridis", levels: 8, lines: true, labels: false, zLimits: [1, 9] },
      },
    };
  },
  // ROW_RANGE_CONTRACT R4a: v0.45.0 reads the top-level keys one by one and drops this one.
  "Workspace.namedRanges": (ws) => {
    const id = ws.datasets[0]!.id;
    ws.namedRanges = [{ id: "nr1:a", name: "Base", scope: { kind: "sheet", datasetId: id }, target: { datasetId: id, cols: [0], rows: { from: 0, to: 1 } } }];
  },
  "AxisFormat.prefix": (ws) => editFmt(ws, { prefix: "$" }),
  "AxisFormat.suffix": (ws) => editFmt(ws, { suffix: " K" }),
  "AxisFormat.equal": (ws) => editFmt(ws, { equal: true }),
  "AxisFormat.anchor": (ws) => editFmt(ws, { anchor: 0.5 }), // item 24: v0.45.0's sanitizeAxisExtras picks known keys (measured by reading it)
  "AxisFormat.divideMark": (ws) => editFmt(ws, { divide: 10, divideMark: false }),
  "AxisFormat.top": (ws) => editView(ws, (v) => { v.xFmt = { ...v.xFmt, top: { kind: "reciprocal" } } as View["xFmt"]; }),
  "AxisFormat.base=2": (ws) => editView(ws, (v) => { v.xFmt = { ...v.xFmt, base: "2" }; }),
  "ExportSeriesStyle.marker_fill": (ws) => editExport(ws, { marker_fill: "hollow" }),
  "ExportSeriesStyle.error_cap": (ws) => editExport(ws, { error_cap: 4 }),
  "ExportSeriesStyle.error_width": (ws) => editExport(ws, { error_width: 1.5 }),
  "ExportSeriesStyle.error_color": (ws) => editExport(ws, { error_color: "#112233" }),
  "ExportSeriesStyle.error_band": (ws) => editExport(ws, { error_band: true }),
  "ExportSeriesStyle.marker_edge": (ws) => editExport(ws, { marker_edge: "#000000" }),
  "ExportSeriesStyle.marker_face": (ws) => editExport(ws, { marker_face: "#ffffff" }),
  "ExportSeriesStyle.marker_alpha": (ws) => editExport(ws, { marker_alpha: 0.5 }),
  "ExportSeriesStyle.marker_every": (ws) => editExport(ws, { marker_every: 2 }),
  "ExportSeriesStyle.rug": (ws) => editExport(ws, { rug: "x" }),
  "ExportSeriesStyle.rug_length": (ws) => editExport(ws, { rug_length: 0.1 }),
  "ExportSeriesStyle.rug_opacity": (ws) => editExport(ws, { rug_opacity: 0.3 }),
  "ExportSeriesStyle.ramp_rank": (ws) => editExport(ws, { ramp_rank: 0.5 }),
  "ExportSeriesStyle.size_by": (ws) => editExport(ws, { size_by: 1 }),
  "ExportSeriesStyle.size_range": (ws) => editExport(ws, { size_range: [2, 8] }),
  "ExportSeriesStyle.drop_lines": (ws) => editExport(ws, { drop_lines: "x" }),
  "ExportSeriesStyle.connect": (ws) => editExport(ws, { connect: "spline" }),
  "ExportSeriesStyle.stack": (ws) => editExport(ws, { stack: true }),
  "ExportSeriesStyle.float": (ws) => editExport(ws, { float: "high" }),
  "ExportSeriesStyle.symbol_gap": (ws) => editExport(ws, { symbol_gap: 3 }),
  "ExportSeriesStyle.line_front": (ws) => editExport(ws, { line_front: true }),
  "ExportSeriesStyle.double_line": (ws) => editExport(ws, { double_line: 2 }),
  "ExportSeriesStyle.stack_total": (ws) => editExport(ws, { stack_total: true }),
  "ExportSeriesStyle.error_box": (ws) => editExport(ws, { error_box: true }),
  "ExportSeriesStyle.marker_text": (ws) => editExport(ws, { marker_text: "A" }),
  "ExportSeriesStyle.marker_text_size": (ws) => editExport(ws, { marker_text_size: 12 }),
  "DisplayBlock.ramp": (ws) => {
    const s = spec(ws);
    s.spec = { ...s.spec, display: { ...s.spec.display, ramp: { map: "plasma" } } };
  },
  "RecipeVisual.yAxes": (ws) => {
    ws.plotRecipes![0].visual.yAxes = [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }];
  },
  "RecipeVisual.yAxisOf": (ws) => {
    const v = ws.plotRecipes![0].visual;
    v.yAxes = [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }];
    v.yAxisOf = { [Object.keys(v.seriesStyles)[0] ?? "x0"]: 3 };
  },
  "Annotation.dot": (ws) => editView(ws, (v) => { v.annotations = [...v.annotations, { id: "t", x: 1, y: 2, text: "note", dot: false }]; }),
  "MapViewState.view3d": (ws) => {
    ws.mapViews = { a: { ...DEFAULT_MAP_VIEW, view3d: { kind: "surface", elev: 40, azim: 25, zLabel: "Z", zUnit: "u", style: "nature", title: "T", zoom: 1.5, dropLines: true } } };
  },
  "RecipeMapView.view3d": (ws) => {
    ws.plotRecipes![0].map = { colormap: "magma", logZ: false, colorLimits: null, view3d: { kind: "waterfall", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "", zoom: 1, dropLines: false } };
  },
  "StatPicks.barPercent": (ws) => editView(ws, (v) => { v.statPicks = { mode: "bar", barStack: true, barPercent: true }; }),
  "StatPicks.valueRange": (ws) => editView(ws, (v) => { v.statPicks = { mode: "bar", valueRange: [65, 75] }; }),
  "StatPicks.histCols": (ws) => editView(ws, (v) => { v.statPicks = { mode: "histogram", histCols: [2] }; }),
  "StatPicks.cdfY": (ws) => editView(ws, (v) => { v.statPicks = { mode: "cdf", cdfY: "count" }; }),
  "StatPicks.cdfBand": (ws) => editView(ws, (v) => { v.statPicks = { mode: "cdf", cdfBand: true }; }),
  "StatPicks.rug": (ws) => editView(ws, (v) => { v.statPicks = { mode: "histogram", rug: { on: true } }; }),
  "StatPicks.marginal": (ws) => editView(ws, (v) => { v.statPicks = { mode: "marginal", marginal: "box" }; }),
  "StatPicks.ridgeOverlap": (ws) => editView(ws, (v) => { v.statPicks = { mode: "ridgeline", ridgeOverlap: 2, ridgeBw: "scott" }; }),
  "StatPicks.ridgeBw": (ws) => editView(ws, (v) => { v.statPicks = { mode: "ridgeline", ridgeOverlap: 1, ridgeBw: "silverman" }; }),
  "StatPicks.violinSide": (ws) => editView(ws, (v) => { v.statPicks = { mode: "sideviolin", violinSide: "split", ridgeBw: "scott" }; }),
  "StatPicks.pairedCi": (ws) => editView(ws, (v) => { v.statPicks = { mode: "paired", pairedCi: true }; }),
  "StatPicks.lollipopStat": (ws) => editView(ws, (v) => { v.statPicks = { mode: "lollipop", lollipopStat: "median", lollipopSort: "none" }; }),
  "StatPicks.lollipopSort": (ws) => editView(ws, (v) => { v.statPicks = { mode: "lollipop", lollipopStat: "mean", lollipopSort: "desc" }; }),
  "StatPicks.histStack": (ws) => editView(ws, (v) => { v.statPicks = { mode: "histogram", histStack: true }; }),
  "StatMarks.comparisons": (ws) => editView(ws, (v) => { v.statMarks = { box: { comparisons: "brackets" } }; }),
  "StatMarks.compareMethod": (ws) => editView(ws, (v) => { v.statMarks = { box: { compareMethod: "dunnett" } }; }),
  "StatMarks.compareControl": (ws) => editView(ws, (v) => { v.statMarks = { box: { compareControl: "ctrl" } }; }),
  "StatMarks.compareExact": (ws) => editView(ws, (v) => { v.statMarks = { box: { compareExact: true } }; }),
  "MapViewState.cellLabels": (ws) => { ws.mapViews = { ...ws.mapViews, [dataset(ws, "c").id]: { ...DEFAULT_MAP_VIEW, cellLabels: { format: "fixed", precision: 2 } } }; },
  "Shape.kind=measure": (ws) => editView(ws, (v) => { v.shapes = [...v.shapes, { id: "sm", kind: "slope", x1: 1, y1: 1, x2: 10, y2: 100 }]; }),
  "OverrideShape.kind=measure": (ws) => {
    const doc = ws.figureDocs![0] as unknown as { config: { overrides?: unknown } }; // the legacy FigureDoc keeps its overrides raw
    doc.config.overrides = { shapes: [{ kind: "distance", x1: 0, y1: 0, x2: 3, y2: 4 }] };
  },
  "Map3dView.ext": (ws) => { ws.mapViews = { ...ws.mapViews, [dataset(ws, "c").id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "bars3d", ext: { barW: 0.5 } } } }; },
  "Map3dView.kind=bars_vectors": (ws) => { ws.mapViews = { ...ws.mapViews, [dataset(ws, "c").id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "vectors3d" } } }; },
  "PlotOverlays.groupShapes": (ws) => editView(ws, (v) => { v.overlays = { line: null, smoother: null, ellipse: { level: 0.95, kind: "mean" }, hull: true }; }),
  "Dataset.columnProps": (ws) => { dataset(ws, "c").columnProps = { 0: { comment: "note" } }; },
  "Dataset.hiddenCols": (ws) => { dataset(ws, "c").hiddenCols = [0]; },
  "Dataset.frozenCols": (ws) => { dataset(ws, "c").frozenCols = 1; },
  "Dataset.cellRules": (ws) => { dataset(ws, "c").cellRules = { 0: [{ kind: "value", op: ">", a: 1, tone: "danger" }] }; },
  "Dataset.rowStyle": (ws) => { const d = dataset(ws, "c"); d.rowStyle = { color: d.data.time.map(() => "s1") }; },
  // One case per GATED_METADATA_KEYS entry (a key in the list is gated whether or not code writes it yet).
  "Dataset.metadata.__quantized_cell_notes": (ws) => { setMeta(ws, "__quantized_cell_notes", { 0: { 1: "check this" } }); },
  "Dataset.metadata.__quantized_input_row_range": (ws) => { setMeta(ws, "__quantized_input_row_range", [{ datasetId: "c", from: 20, to: 43, rows: 48 }]); },
  // OG20: a saved snapshot result's recorded window (envelope `parameters.rowRange`).
  "AnalysisResult.parameters.rowRange": (ws) => {
    ws.analysisResults = [...(ws.analysisResults ?? []), {
      version: 1, id: "ar-r", name: "Distribution", producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
      sources: [{ datasetId: "c", role: "input" }], outputs: [], warnings: [], createdAt: "2026-11-27T00:00:00.000Z",
      parameters: { rowRange: { from: 20, to: 43, rows: 48 } },
    }];
  },
  "Dataset.linkedCurves": (ws) => {
    ws.datasets.push({ ...dataset(ws, "a"), id: "g", name: "graph", linkedCurves: [{ datasetId: "c", xKey: null, yKey: 0, label: "R1" }] });
  },
};

/** Gated on save, but this build's own loader does not keep it either: the
 *  publication-style sanitizer (lib/publicationStyles.ts) drops `ramp_rank`,
 *  which the export rebuilds from the view's `rampRank` on every export. */
const NOT_KEPT_BY_HEAD_ON_RELOAD = new Set(["ExportSeriesStyle.ramp_rank"]);

// Pinned: the gated entries of v0.38.0 (they read these fields, so v6 suffices).
const READ_BY_V038 = [
  "Annotation.dot", "AxisFormat.base=2", "AxisFormat.cross", "AxisFormat.custom", "AxisFormat.grid",
  "AxisFormat.offset", "AxisFormat.prefix", "AxisFormat.prob", "AxisFormat.reverse", "AxisFormat.rotate",
  "AxisFormat.suffix", "AxisFormat.top", "Dataset.columnProps", "Dataset.frozenCols", "Dataset.hiddenCols",
  "Dataset.linkedCurves", "DisplayBlock.ramp", "ExportSeriesStyle.connect", "ExportSeriesStyle.drop_lines",
  "ExportSeriesStyle.error_band", "ExportSeriesStyle.error_cap", "ExportSeriesStyle.error_color",
  "ExportSeriesStyle.error_width", "ExportSeriesStyle.marker_alpha", "ExportSeriesStyle.marker_edge",
  "ExportSeriesStyle.marker_every", "ExportSeriesStyle.marker_face", "ExportSeriesStyle.marker_fill",
  "ExportSeriesStyle.ramp_rank", "ExportSeriesStyle.size_by", "ExportSeriesStyle.size_range", "MapViewState.view3d",
  "PlotView.exchangeXY", "PlotView.layers", "PlotView.seriesRamp", "PlotView.yAxes", "PlotView.yAxisOf",
  "PlotWindow.linkYGroup", "RecipeMapView.view3d", "RecipeVisual.yAxes", "RecipeVisual.yAxisOf",
  "Workspace.savedRecodeMappings",
];

const PLAIN_3D = { kind: "surface", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "", zoom: 1, dropLines: false } as const;

const gatedEntries = (): string[] =>
  [
    ...Object.entries(CLASSIFICATIONS).flatMap(([t, m]) => Object.keys(m).filter((k) => m[k] === "gated").map((k) => `${t}.${k}`)),
    ...GATED_VALUES,
  ].sort();

describe("3-D bars and vectors (v0.45.0 reads view3d but drops ext and the new kinds)", () => {
  it("a plain surface / scatter3d / waterfall view stays on its old rung; ext or a new kind is v9; v9 round-trips both", () => {
    for (const kind of ["surface", "scatter3d", "waterfall"] as const) {
      const plain = load();
      plain.mapViews = { [dataset(plain, "c").id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind } } };
      const t = serializeWorkspace(plain);
      expect(featuresV045WouldDrop(JSON.parse(t))).toEqual([]);
      expect(version(t)).toBe(6);
    }
    const ws = load();
    const id = dataset(ws, "c").id;
    const ext = { barW: 0.5, barColor: "#336699", vecDx: 3, vecEnd: true };
    ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "bars3d", ext } } };
    const text = serializeWorkspace(ws);
    expect(version(text)).toBe(9);
    expect(featuresV045WouldDrop(JSON.parse(text)).sort()).toEqual(["Map3dView.ext", "Map3dView.kind=bars_vectors"]);
    expect(parseWorkspace(text, VIEWPORT).mapViews?.[id]?.view3d).toMatchObject({ kind: "bars3d", ext });
    // A vectors view with no options still needs v9 (the kind alone); a bars view's own options need it too.
    ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "vectors3d" } } };
    expect(featuresV045WouldDrop(JSON.parse(serializeWorkspace(ws)))).toEqual(["Map3dView.kind=bars_vectors"]);
    ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "bars3d", ext: { barW: 0.4 } } } };
    expect(featuresV045WouldDrop(JSON.parse(serializeWorkspace(ws)))).toContain("Map3dView.ext");
  });

  it("the rung follows the CURRENT kind: another kind's leftover ext keys do not raise it", () => {
    const ws = load();
    const id = dataset(ws, "c").id;
    const left = { vecDx: 3, vecDy: 4, vecDz: 5, vecEnd: true, barW: 0.5, scColor: 2, wallXY: true };
    const write = (kind: "surface" | "waterfall" | "vectors3d" | "scatter3d", ext: Record<string, number | boolean>) => {
      ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind, ext } } };
      const t = serializeWorkspace(ws);
      return { v: version(t), f: featuresV045WouldDrop(JSON.parse(t)), kept: parseWorkspace(t, VIEWPORT).mapViews?.[id]?.view3d?.ext };
    };
    // A plain surface / waterfall after vectors were set: the file is one v0.45.0 renders, and the vector keys survive for switching back.
    for (const kind of ["surface", "waterfall"] as const) expect(write(kind, left)).toEqual({ v: 6, f: [], kept: left });
    // A vectors view uses its own keys, so it is v9; a scatter with #1106's extras too.
    expect(write("vectors3d", left).f).toEqual(["Map3dView.ext", "Map3dView.kind=bars_vectors"]);
    expect(write("scatter3d", { scColor: 3, wallXY: true, vecDx: 1 })).toMatchObject({ v: 9, f: ["Map3dView.ext"] });
    // A scatter holding only another kind's keys is plain.
    expect(write("scatter3d", { vecDx: 1, barW: 0.5 })).toMatchObject({ v: 6, f: [] });
  });

  it("the colour options (bar column, vector length, error caps) are gated through their own kind and inert on another", () => {
    const ws = load();
    const id = dataset(ws, "c").id;
    const write = (kind: "surface" | "bars3d" | "vectors3d" | "scatter3d", ext: Record<string, number | boolean | string>) => {
      ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind, ext } } };
      const t = serializeWorkspace(ws);
      return { v: version(t), f: featuresV045WouldDrop(JSON.parse(t)), kept: parseWorkspace(t, VIEWPORT).mapViews?.[id]?.view3d?.ext };
    };
    // Each key alone on the kind that reads it: v9, ext reported, and the value survives a v9 round trip.
    expect(write("bars3d", { barCol: 3 })).toEqual({ v: 9, f: ["Map3dView.ext", "Map3dView.kind=bars_vectors"], kept: { barCol: 3 } });
    // A text column picked by name (`barColText`) keeps the `bar` prefix, so it is gated the same way: v9 on bars, inert elsewhere.
    expect(write("bars3d", { barColText: "metal" })).toEqual({ v: 9, f: ["Map3dView.ext", "Map3dView.kind=bars_vectors"], kept: { barColText: "metal" } });
    expect(write("scatter3d", { barColText: "metal" })).toMatchObject({ v: 6, f: [] });
    expect(write("surface", { barColText: "metal" })).toMatchObject({ v: 6, f: [] });
    // Item 48 leftovers: grouped bars, data-unit sizes and the vector colour column, gated by the same prefixes.
    const V9 = ["Map3dView.ext", "Map3dView.kind=bars_vectors"];
    expect(write("bars3d", { barSide: true, barAbs: true, barAW: 0.5, barAD: 2 })).toEqual({ v: 9, f: V9, kept: { barSide: true, barAbs: true, barAW: 0.5, barAD: 2 } });
    expect(write("vectors3d", { vecCCol: 6 })).toEqual({ v: 9, f: V9, kept: { vecCCol: 6 } });
    expect(write("vectors3d", { vecCText: "a column name well over twelve characters long" })).toEqual({ v: 9, f: V9, kept: { vecCText: "a column name well over twelve characters long" } });
    expect(write("scatter3d", { barSide: true, vecCCol: 6 })).toMatchObject({ v: 6, f: [] });
    expect(write("vectors3d", { vecLen: true })).toEqual({ v: 9, f: ["Map3dView.ext", "Map3dView.kind=bars_vectors"], kept: { vecLen: true } });
    expect(write("scatter3d", { scErrX: 5, scErrCaps: true })).toEqual({ v: 9, f: ["Map3dView.ext"], kept: { scErrX: 5, scErrCaps: true } });
    // On another kind they ride along inertly: a plain surface and a scatter holding only bar / vector keys stay on the old rung.
    expect(write("surface", { barCol: 3, vecLen: true, scErrCaps: true })).toMatchObject({ v: 6, f: [] });
    expect(write("scatter3d", { barCol: 3, vecLen: true })).toMatchObject({ v: 6, f: [] });
    expect(write("bars3d", { vecLen: true, scErrCaps: true })).toMatchObject({ f: ["Map3dView.kind=bars_vectors"] });
  });

  it("every nested scatter-extras key rides in ext, which v0.45.0 drops whole (measured), so one gate covers them", () => {
    const ws = load();
    const id = dataset(ws, "c").id;
    const ext = { scColor: 3, scSize: 4, scErrX: 5, scErrY: 6, scErrZ: 7, scGroup: 8, wallXY: true, wallXZ: true, wallYZ: true };
    ws.mapViews = { [id]: { ...DEFAULT_MAP_VIEW, view3d: { ...PLAIN_3D, kind: "scatter3d", ext } } };
    const text = serializeWorkspace(ws);
    expect(version(text)).toBe(9);
    expect(featuresV045WouldDrop(JSON.parse(text))).toEqual(["Map3dView.ext"]);
    expect(parseWorkspace(text, VIEWPORT).mapViews?.[id]?.view3d).toMatchObject({ kind: "scatter3d", ext });
  });
});

describe("group shapes (item 24: v0.45.0 reads overlays but drops centroid, hull and the mean ellipse)", () => {
  const rung = (overlays: unknown): { version: number; drops: string[] } => {
    const ws = load();
    editView(ws, (v) => { v.overlays = overlays as typeof v.overlays; });
    const t = serializeWorkspace(ws);
    return { version: version(t), drops: featuresV045WouldDrop(JSON.parse(t)) };
  };
  const DATA = { line: null, smoother: null, ellipse: { level: 0.95 } };

  it("a plain or data-ellipse overlay is unchanged; each new option is v9", () => {
    expect(rung(DATA).drops).toEqual([]);
    expect(rung(DATA).version).toBe(7);
    for (const o of [{ ...DATA, ellipse: null, centroid: true }, { ...DATA, ellipse: null, hull: true }, { ...DATA, ellipse: { level: 0.9, kind: "mean" } }]) {
      expect(rung(o)).toEqual({ version: 9, drops: ["PlotOverlays.groupShapes"] });
    }
  });

  it("v9 round-trips every option", () => {
    const o = { line: null, smoother: null, ellipse: { level: 0.9, kind: "mean" }, centroid: true, hull: true };
    const ws = load();
    editView(ws, (v) => { v.overlays = o as typeof v.overlays; });
    const back = parseWorkspace(serializeWorkspace(ws), VIEWPORT);
    expect(JSON.stringify(back)).toContain('"kind":"mean"');
    expect(JSON.stringify(back)).toContain('"hull":true');
    expect(JSON.stringify(back)).toContain('"centroid":true');
  });
});

describe("forward compatibility with v0.34.0", () => {
  it("v6 is the version above everything v0.34.0 accepts (1-5)", () => {
    expect(WORKSPACE_VERSION).toBe(4);
    expect(WORKSPACE_VERSION_TRANSFORM_STEPS).toBe(5);
    expect(WORKSPACE_VERSION_NEW_FEATURES).toBe(6);
    expect(WORKSPACE_VERSION_POST_038).toBe(7); // v0.35-v0.38 accept 1-6
  });

  it("ratchet: every gated field is either one v0.38.0 already read or listed as new since", () => {
    // The gated fields v0.38.0's own map listed (`git show v0.38.0:frontend/src/lib/workspaceForwardCompat.ts`).
    // A field gated after this pin must go into NEW_SINCE_V038 (or this list, if a later release reads it).
    const readBy038 = gatedEntries().filter((g) => !NEW_SINCE_V038.has(g) && !NEW_SINCE_V041.has(g) && !NEW_SINCE_V045.has(g));
    expect(readBy038).toEqual(READ_BY_V038);
    for (const f of NEW_SINCE_V038) expect(gatedEntries()).toContain(f);
  });

  it("ratchet: every gated field is one v0.41.0 already read, or listed in NEW_SINCE_V041 / NEW_SINCE_V045", () => {
    // v0.41.0's classification maps are this build's minus NEW_SINCE_V041 and NEW_SINCE_V045
    // (`git show v0.41.0:frontend/src/lib/workspaceForwardCompat.ts`): it read
    // exactly READ_BY_V038 plus NEW_SINCE_V038.
    const readBy041 = gatedEntries().filter((g) => !NEW_SINCE_V041.has(g) && !NEW_SINCE_V045.has(g));
    expect(readBy041).toEqual([...READ_BY_V038, ...NEW_SINCE_V038].sort());
    for (const f of [...NEW_SINCE_V041, ...NEW_SINCE_V045]) expect(gatedEntries()).toContain(f);
    for (const f of NEW_SINCE_V041) expect(NEW_SINCE_V038.has(f)).toBe(false);
  });

  it("the rung sets are disjoint, and a released rung's set is FROZEN", () => {
    // THE LADDER RULE: once a release that reads a rung ships, a field gated afterwards needs the NEXT rung.
    // v0.45.0 reads v8 (MEASURED: its own parse + serialize keep exactly these two v8 fields and drop every
    // NEW_SINCE_V045 one). Adding to NEW_SINCE_V041 here re-opens the data-loss hole this test was written for:
    // v0.45.0 would open the v8 file and silently drop the field. Add a rung instead.
    expect([...NEW_SINCE_V041].sort()).toEqual(["Dataset.rowStyle", "Workspace.windowLayout"]);
    expect([...NEW_SINCE_V038].sort()).toEqual([
      "AxisFormat.divideMark", "Dataset.cellRules", "ErrorBinding.origin", "ExportSeriesStyle.float", "ExportSeriesStyle.stack",
      "PlotView.overlays", "PlotView.pointLabels", "StatMarks.compareControl", "StatMarks.compareExact", "StatMarks.compareMethod",
      "StatMarks.comparisons", "StatPicks.barPercent", "StatPicks.histCols", "StatPicks.valueRange",
    ]);
    for (const f of NEW_SINCE_V045) expect(NEW_SINCE_V041.has(f) || NEW_SINCE_V038.has(f)).toBe(false);
  });

  it("v8 is the version above everything v0.39-v0.41 accept (1-7), v9 above everything v0.42-v0.45 accept (1-8)", () => {
    expect(WORKSPACE_VERSION_POST_041).toBe(8);
    expect(WORKSPACE_VERSION_POST_045).toBe(9);
    expect(parseWorkspace(JSON.stringify({ ...dwk034, version: 8 }), VIEWPORT).datasets.length).toBeGreaterThan(0);
    expect(parseWorkspace(JSON.stringify({ ...dwk034, version: 9 }), VIEWPORT).datasets.length).toBeGreaterThan(0);
    expect(() => parseWorkspace(JSON.stringify({ ...dwk034, version: 10 }), VIEWPORT)).toThrow("unsupported workspace version: 10");
  });

  it("a workspace with none of the gated fields stays v4, so v0.34.0 still opens it", () => {
    const text = serializeWorkspace(load());
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual([]);
    expect(version(text)).toBe(4);
  });

  it("ratchet: every gated field (and gated value) has exactly one FEATURES case", () => {
    expect(Object.keys(FEATURES).sort()).toEqual(gatedEntries());
  });

  for (const [name, edit] of Object.entries(FEATURES)) {
    // v9 for a field v0.42-v0.45 drop (they accept v8); v8 for one v0.39-v0.41 drop (they accept v7); v7 for one v0.35-v0.38
    // drop too (they accept v6); v6 otherwise.
    const want = NEW_SINCE_V045.has(name) ? 9 : NEW_SINCE_V041.has(name) ? 8 : NEW_SINCE_V038.has(name) ? 7 : 6;
    it(`${name}: saved as v${want} (older releases refuse it rather than dropping it), and this build keeps it`, () => {
      const ws = load();
      edit(ws);
      const text = serializeWorkspace(ws);
      expect(featuresV034WouldDrop(JSON.parse(text))).toContain(name);
      expect(featuresV038WouldDrop(JSON.parse(text)).includes(name)).toBe(want === 7);
      expect(featuresV041WouldDrop(JSON.parse(text)).includes(name)).toBe(want === 8);
      expect(featuresV045WouldDrop(JSON.parse(text)).includes(name)).toBe(want === 9);
      expect(version(text)).toBe(want);
      const back = parseWorkspace(text, VIEWPORT);
      expect(back.migrationWarnings).toEqual([]);
      if (NOT_KEPT_BY_HEAD_ON_RELOAD.has(name)) return;
      // The session's layout mode is a preference, not file content: carry it.
      const again = serializeWorkspace({ ...back, layoutMode: (ws as WorkspaceState).layoutMode });
      expect(featuresV034WouldDrop(JSON.parse(again))).toContain(name);
      expect(version(again)).toBe(want);
    });
  }

  it("ternary settings (including the Z range) are gated at v9; a project without them is unchanged", () => {
    const withTernary = load();
    FEATURES["Workspace.ternaryFigures"]!(withTernary);
    const text = serializeWorkspace(withTernary);
    expect(featuresV045WouldDrop(JSON.parse(text))).toEqual(["Workspace.ternaryFigures"]);
    expect(featuresV041WouldDrop(JSON.parse(text))).toEqual([]);
    expect(version(text)).toBe(9);
    expect(parseWorkspace(text, VIEWPORT).ternaryFigures?.[withTernary.datasets[0]!.id]?.field.zLimits).toEqual([1, 9]);
    const without = serializeWorkspace(load());
    expect(JSON.parse(without)).not.toHaveProperty("ternaryFigures");
    expect(version(without)).toBe(4);
  });

  it("a file holding every v9 field saves as v9 and round-trips them all; v8-only and plain files keep their rung", () => {
    const ws = load();
    for (const name of NEW_SINCE_V045) FEATURES[name]!(ws);
    const text = serializeWorkspace(ws);
    expect(version(text)).toBe(9);
    // (several edits share one carrier and overwrite each other, so not every entry survives together: each
    // entry is pinned alone by the loop above; here the SET that is present must round-trip unchanged.)
    const present = featuresV045WouldDrop(JSON.parse(text));
    expect(present.length).toBeGreaterThan(NEW_SINCE_V045.size / 2);
    const back = parseWorkspace(text, VIEWPORT);
    const again = serializeWorkspace({ ...back, layoutMode: (ws as WorkspaceState).layoutMode });
    expect(version(again)).toBe(9);
    expect(featuresV045WouldDrop(JSON.parse(again))).toEqual(present);
    // A v8-rung field alone stays v8 (not every file is bumped to v9).
    const v8 = load();
    FEATURES["Dataset.rowStyle"]!(v8);
    expect(version(serializeWorkspace(v8))).toBe(8);
    expect(version(serializeWorkspace(load()))).toBe(4);
  });

  it("the metadata-key gate: every key is v9, empty or absent is not, a not-gated sidecar stays v4", () => {
    expect(GATED_METADATA_KEYS).toEqual(["__quantized_cell_notes", "__quantized_input_row_range"]); // pinned: a new key is a deliberate edit (and a case above)
    for (const k of GATED_METADATA_KEYS) {
      const has = (v: unknown, where: "data" | "raw" = "data"): string[] => {
        const ws = load();
        const d = dataset(ws, "c");
        if (where === "raw") d.raw = { ...d.data, metadata: { [k]: v } };
        else setMeta(ws, k, v);
        return featuresV045WouldDrop(JSON.parse(serializeWorkspace(ws)));
      };
      expect(has({ 0: { 1: "n" } })).toEqual([`Dataset.metadata.${k}`]);
      expect(has({ 0: { 1: "n" } }, "raw")).toEqual([`Dataset.metadata.${k}`]); // the pre-correction copy counts too
      expect(has({})).toEqual([]);
      expect(has(undefined)).toEqual([]);
    }
    // R3's source-row link is deliberately NOT gated (contract review amendment): older releases lose only the link.
    const link = load();
    setMeta(link, "__quantized_source_rows", { source: "a", rows: { 0: "r1:1" } });
    expect(featuresV034WouldDrop(JSON.parse(serializeWorkspace(link)))).toEqual([]);
    expect(version(serializeWorkspace(link))).toBe(4);
    // The key is read by name from the dataset's own metadata, never from an unrelated object.
    const other = load();
    dataset(other, "c").notes = "__quantized_cell_notes";
    expect(featuresV034WouldDrop(JSON.parse(serializeWorkspace(other)))).toEqual([]);
  });

  it("a v9 file is refused by the v0.45.0 reader (versions 1-8), and a file with no v9 field still opens there", () => {
    // v0.45.0's own gate (`git show v0.45.0:frontend/src/lib/workspace.ts`): `version` must be one of 1..8.
    const READER_V045_ACCEPTS = (text: string): boolean => [1, 2, 3, 4, 5, 6, 7, 8].includes(version(text));
    for (const name of [...NEW_SINCE_V045]) {
      const ws = load();
      FEATURES[name]!(ws);
      expect(READER_V045_ACCEPTS(serializeWorkspace(ws))).toBe(false);
    }
    expect(READER_V045_ACCEPTS(serializeWorkspace(load()))).toBe(true);
    const v8 = load();
    FEATURES["Dataset.rowStyle"]!(v8);
    expect(READER_V045_ACCEPTS(serializeWorkspace(v8))).toBe(true); // v0.45.0 keeps row styles (measured by #1092)
  });

  it("the new per-series style keys stay v4: v0.34.0 carries them through unchanged", () => {
    const kept = Object.keys(SERIES_STYLE).filter((k) => SERIES_STYLE[k as keyof typeof SERIES_STYLE] === "kept-by-034");
    expect(kept.length).toBeGreaterThan(0);
    const style = {
      markerFill: "hollow", markerEdge: "#000000", markerFillColor: "#ffffff", markerAlpha: 0.5, markerEvery: 2,
      rampRank: 0.5, errorBar: { cap: 4, band: true }, sizeBy: 1, sizeRange: [2, 8], dropLines: "x", connect: "spline", stack: true, float: "high", rowStates: true,
      rug: "x", rugLength: 0.1, rugOpacity: 0.3,
      symbolGap: 3, lineFront: true, doubleLine: 2, markerText: "A", markerTextSize: 12, stackTotal: true, markerTextFrom: { name: "Tag" },
    };
    expect(Object.keys(style).sort()).toEqual([...kept].sort());
    const ws = load();
    editView(ws, (v) => { v.seriesStyles = { ...v.seriesStyles, 0: { ...v.seriesStyles[0], ...style } as never }; });
    const visual = ws.plotRecipes![0].visual;
    const id = Object.keys(visual.seriesStyles)[0] ?? "x0";
    visual.seriesStyles = { ...visual.seriesStyles, [id]: { ...visual.seriesStyles[id], ...style } as never };
    const text = serializeWorkspace(ws);
    expect(text).toContain('"markerFill": "hollow"'); // really written
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual([]);
    expect(version(text)).toBe(4);
  });

  it("transform steps alone keep v5; with a gated field too, v6", () => {
    const ws = load();
    ws.macroSteps = [...(ws.macroSteps ?? []), { id: "t1", kind: "transform", label: "T", code: "", params: {}, enabled: true }];
    expect(version(serializeWorkspace(ws))).toBe(5);
    FEATURES["PlotWindow.linkYGroup"](ws);
    expect(version(serializeWorkspace(ws))).toBe(6);
  });

  it("dataset and window fields count only on their own entries, never on an unrelated object", () => {
    expect(
      featuresV034WouldDrop({
        pages: [{ grid: { x: 1 }, top: 3, offset: 2, layers: [1], columnProps: { 0: {} }, linkedCurves: [{}], linkYGroup: 2 }],
        figureDocs: [{ config: { seriesStyles: [{ color: "#000000", width: 2 }] } }],
      }),
    ).toEqual([]);
  });

  it("a view is found at any depth, even under a key named `data` or `values`", () => {
    const view = { seriesStyles: {}, yFmt: { mode: "auto", digits: 2, grid: { major: true } } };
    expect(featuresV034WouldDrop({ pages: [{ data: { values: { view } } }] })).toEqual(["AxisFormat.grid"]);
  });
});

// Gap audit 5 lane C / review #3: a saved fit curve is DERIVED, not gated.
const SAVED_FIT = { rows: "abc.00000000", fit: { binding: { yKey: 0, xKey: null }, y: [1, 2, 3] } };
function withSavedFits(ws: LoadedWorkspace): void {
  const doc = plotWindow(ws).document!;
  plotWindow(ws).document = { ...doc, overlays: SAVED_FIT };
  ws.editableFigures![0] = { ...ws.editableFigures![0], overlays: SAVED_FIT };
}

describe("derived and report-spec fields (measured against v0.34.0)", () => {
  it("review N8: the derived set is pinned -- a new derived field is a deliberate edit here", () => {
    const DERIVED = ["FigureDocument.overlays"];
    const derived = Object.entries(CLASSIFICATIONS).flatMap(([t, m]) => Object.keys(m).filter((k) => m[k] === "derived").map((k) => `${t}.${k}`));
    expect(derived.sort()).toEqual(DERIVED);
  });

  it("FigureDocument.overlays is derived: classified, written, and the file stays v4", () => {
    expect(CLASSIFICATIONS.FigureDocument.overlays).toBe("derived");
    const ws = load();
    withSavedFits(ws);
    const text = serializeWorkspace(ws);
    const saved = JSON.parse(text) as { plotWindows: { document: { overlays?: unknown } }[]; editableFigures: { overlays?: unknown }[] };
    expect(saved.plotWindows[0].document.overlays).toEqual(SAVED_FIT); // really written
    expect(saved.editableFigures[0].overlays).toEqual(SAVED_FIT);
    expect(featuresV034WouldDrop(saved)).toEqual([]);
    expect(version(text)).toBe(4);
    const why = [...paths(saved)].filter((p) => !paths(dwk034).has(p)).map(classify);
    expect(why).toContain("FigureDocument.overlays=derived");
    const newPaths = [...paths(saved)].filter((p) => !paths(dwk034).has(p) && !(p in KNOWN_034_PATHS));
    expect(newPaths.filter((p) => { const w = classify(p); return w === null || w.startsWith("UNCLASSIFIED"); })).toEqual([]);
  });

  it("a report figure block's analysis_overlays is kept by 0.34 (opaque spec): still v4", () => {
    expect(REPORT_FIGURE_SPEC.analysis_overlays).toBe("kept-by-034");
    const ws = load();
    ws.reports = [{
      id: "rep-1", name: "R", datasetId: null,
      report: {
        title: "R", source_refs: [], created: "2026-11-15T00:00:00+00:00",
        sections: [{ title: "F", blocks: [{ type: "figure", name: "f", spec: { fmt: "svg", y_keys: [0, 1], analysis_overlays: [false, true] } }] }],
      },
    }] as never;
    const text = serializeWorkspace(ws);
    expect(text).toContain('"analysis_overlays"');
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual([]);
    expect(version(text)).toBe(4);
  });
});

// ── Kitchen sink: every key path HEAD writes that v0.34.0 never wrote ──────────
/** Typed containers by path: a new key directly under one is the type's field. */
const CONTAINERS: readonly [RegExp, string][] = [
  [/^\$\.datasets\[\]$/, "Dataset"],
  [/^\$\.plotWindows\[\]$/, "PlotWindow"],
  [/^\$\.plotWindows\[\]\.document$/, "FigureDocument"],
  [/^\$\.editableFigures\[\]$/, "FigureDocument"],
  [/\.view$/, "PlotView"],
  [/\.bindings\.errors\[\]$/, "ErrorBinding"],
  [/\.(xFmt|yFmt|y2Fmt)$/, "AxisFormat"],
  [/\.seriesStyles\[\]$/, "ExportSeriesStyle"],
  [/\.seriesStyles\.[^.[\]]+$/, "SeriesStyle"],
  [/^\$\.savedPlotSpecs\[\]\.spec\.display$/, "DisplayBlock"],
  [/^\$\.plotRecipes\[\]\.visual$/, "RecipeVisual"],
  // Decoration elements, ANCHORED to the parents that really hold them (a bare
  // `.annotations[]` would also match a map view's pinned text, a different type).
  [/\.(view|decor|decorations|overrides)\.annotations\[\]$/, "Annotation"],
  [/\.mapViews\.[^.[\]]+\.annotations\[\]$/, "MapAnnotation"],
  [/\.annotations\[\]\.frame$/, "AnnotationFrame"],
  [/\.(view|decor|decorations)\.shapes\[\]$/, "Shape"],
  [/\.(view|decor|decorations|visual)\.refLines\[\]$/, "RefLine"],
  [/\.(view|decor|decorations)\.regionShades\[\]$/, "RegionShade"],
  [/\.(view|decorations)\.inset$/, "InsetView"],
  [/\.statMarks\.[^.[\]]+$/, "StatMarks"],
  [/\.view\.statPicks$/, "StatPicks"],
  [/\.view\.pointLabels$/, "PointLabels"],
  [/\.overrides$/, "FigureOverrides"],
  [/\.overrides\.shapes\[\]$/, "OverrideShape"],
  [/\.overrides\.ref_lines\[\]$/, "OverrideRefLine"],
  [/\.overrides\.region_shades\[\]$/, "OverrideRegionShade"],
  [/\.overrides\.inset$/, "OverrideInset"],
  [/\.(view|decor|decorations|visual)\.refLines\[\]\.stick$/, "ReferenceStick"],
  [/\.overrides\.ref_lines\[\]\.stick$/, "OverrideStick"],
  [/\.overrides\.legend$/, "OverrideLegend"],
  [/\.overrides\.ticks$/, "OverrideTicks"],
  [/\.overrides\.spines$/, "OverrideSpines"],
  [/\.overrides\.(margins|page_pad)$/, "OverrideBox"],
  [/^\$\.mapViews\.[^.[\]]+$/, "MapViewState"],
  [/^\$\.plotRecipes\[\]\.map$/, "RecipeMapView"],
  [/^\$$/, "Workspace"], // top-level keys added after 0.34 (a saved Recode mapping list)
];

/** Fields that existed in v0.34.0 but the frozen 0.34 file happens not to use
 *  (so their paths look new), each with where 0.34 declared it. */
const KNOWN_034_PATHS: Record<string, string> = {
  "$.workbooks[].originBook": "WorkbookNode.originBook (lib/workbooks.ts at v0.34.0)",
};

/** Key paths of a JSON value: arrays as `[]`, numeric record keys as `#`. */
function paths(v: unknown, p = "$", out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) paths(x, `${p}[]`, out);
  } else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      const q = `${p}.${/^\d+$/.test(k) ? "#" : k}`;
      out.add(q);
      paths(x, q, out);
    }
  }
  return out;
}

/** Why a new path is allowed, or null: the classified field it belongs to. The
 *  NEAREST typed container wins, so a key under `annotations[].frame` is the
 *  frame's own field, never credited to `Annotation.frame`. */
function classify(path: string): string | null {
  const segs = path.split(/(?=\.)/); // keep the dots: "$", ".a", ".b[]", ...
  for (let i = segs.length - 1; i >= 1; i--) {
    const container = segs.slice(0, i).join("");
    const field = segs[i].slice(1).replace(/(\[\])+$/, "");
    for (const [rx, type] of CONTAINERS) {
      if (!rx.test(container)) continue;
      const cls = CLASSIFICATIONS[type][field];
      return cls ? `${type}.${field}=${cls}` : `UNCLASSIFIED ${type}.${field}`;
    }
  }
  return null;
}

/** One fully populated element of every decoration array (`Required<T>`: a new
 *  field fails `tsc` here until it is classified AND populated), so the sink
 *  writes every sub-key and compares it, whatever the frozen 0.34 file held. */
const FULL_FRAME: Required<NonNullable<Annotation["frame"]>> = { fill: "#fff", stroke: "#000", opacity: 0.5, pad: 3 };
function populate(ws: LoadedWorkspace): void {
  const annotation: Required<Annotation> = {
    id: "pa", groupId: "g", x: 1, y: 2, text: "t", axis: 1, size: 12, anchor: "data", frame: FULL_FRAME, dot: false,
  };
  const shape: Required<Shape> = {
    id: "ps", groupId: "g", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "data", stroke: "#000", fill: "#fff", opacity: 0.5, width: 2, dash: true,
    x3: 2, y3: 2, length: 1, orient: "h", text: "t", triangle: true,
  };
  const refLine: Required<RefLine> = {
    id: "pr", axis: "x", value: 1, label: "l", groupId: "g", groupLabel: "gl",
    stick: { intensity: 1, baseline: 0, height: 1, color: "#000", visible: true, showLabel: true },
  };
  const shade: Required<RegionShade> = { id: "pg", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#ccc", axis: 0, fullHeight: true };
  const inset: Required<InsetView> = { x: [0, 1], y: [0, 1], y2: [0, 1], yZoom: true, at: [0.1, 0.1, 0.3, 0.3], lines: true };
  const marks: Required<StatMarks> = { points: "all", jitter: true, jitterWidth: 0.5, summary: "mean", errorBars: "sd", connectMeans: true, labelRotation: 45, labelWrap: true, comparisons: "letters", compareMethod: "tukey", compareControl: "c", compareExact: true };
  editView(ws, (v) => {
    v.annotations = [...v.annotations, annotation];
    v.shapes = [...v.shapes, shape];
    v.refLines = [...v.refLines, refLine];
    v.regionShades = [...v.regionShades, shade];
    v.inset = inset;
    v.statMarks = { box: marks };
  });
  const mapNote: Required<MapAnnotation> = { id: "pm", x: 1, y: 2, text: "m", space: null };
  ws.mapViews = { ...ws.mapViews, pop: { ...DEFAULT_MAP_VIEW, annotations: [mapNote] } };
  const stick: Required<NonNullable<OvList<"ref_lines">["stick"]>> = {
    intensity: 1, baseline: 0, height: 1, color: "#000", visible: true, show_label: true,
  };
  const box: Required<NonNullable<FigureOverrides["margins"]>> = { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 };
  const ovAnnotation: Required<OvList<"annotations">> = { x: 1, y: 2, text: "t", size: 9, anchor: "page", frame: FULL_FRAME, dot: false };
  const ovShape: Required<OvList<"shapes">> = {
    kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "page", stroke: "#000", fill: "#fff", opacity: 0.5, width: 2, dash: true,
    x3: 2, y3: 2, length: 1, orient: "h", text: "t", triangle: true,
  };
  const ovRefLine: Required<OvList<"ref_lines">> = { axis: "x", value: 1, label: "l", group_id: "g", group_label: "gl", stick };
  const ovShade: Required<OvList<"region_shades">> = { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#ccc", axis: 0, full_height: true };
  const ovInset: Required<OvList<"inset">> = { x: [0, 1], y: [0, 1], y2: [0, 1], at: [0.1, 0.1, 0.3, 0.3], lines: true };
  const legend: Required<NonNullable<FigureOverrides["legend"]>> = { show: true, loc: "best", frame: true, anchor: [0, 0], title: "t" };
  const ticks: Required<NonNullable<FigureOverrides["ticks"]>> = { dir: "in", len: 3, minor: true };
  const spines: Required<NonNullable<FigureOverrides["spines"]>> = { top: true, right: true };
  const overrides: Required<Omit<FigureOverrides, "layers" | "exchange_xy" | "overlays" | "point_labels">> = { // wire-only keys: never persisted
    font_size: 9, font_name: "Arial", title_size: 9, label_size: 9, tick_size: 9, legend_size: 9,
    legend, ticks, spines,
    x_lim: [0, 1], x_reversed: true, y_lim: [0, 1], y2_lim: [0, 1],
    margins: box, page_pad: box, grid: true,
    annotations: [ovAnnotation],
    x_breaks: [[1, 2]],
    shapes: [ovShape],
    ref_lines: [ovRefLine],
    region_shades: [ovShade],
    inset: ovInset,
  };
  const doc = ws.figureDocs![0] as unknown as { publication?: { overrides?: unknown } };
  doc.publication = { ...doc.publication, overrides };
}

/** The key paths a populated full-feature save adds over v0.34.0's own file that
 *  no classification map accounts for, plus every classified field seen. */
function sinkProblems(mutate?: (doc: unknown) => void): { problems: string[]; classified: string[] } {
  const ws = load();
  for (const edit of Object.values(FEATURES)) edit(ws);
  populate(ws);
  const json: unknown = JSON.parse(serializeWorkspace(ws));
  mutate?.(json);
  const head = paths(json);
  const old034 = paths(dwk034);
  const problems: string[] = [];
  const classified: string[] = [];
  for (const p of head) {
    // `mapViews` and its per-dataset entries are v0.34 structure (P2.8), absent from the
    // frozen 0.34 file only because it holds no map view; their FIELDS are classified.
    if (old034.has(p) || p in KNOWN_034_PATHS || /^\$\.mapViews(\.[^.[\]]+)?$/.test(p) || /^\$\.figureDocs\[\]\.publication(\.overrides)?$/.test(p)) continue; // publication: v0.34 FigureDoc v2
    // A saved result is v0.34 structure (the frozen file holds none, so its paths look new); only the recorded
    // row range inside its free-form `parameters` is new, and it is gated by name (OG20, workspaceValueGates).
    if (p.startsWith("$.analysisResults[]")) { if (/\.parameters\.rowRange(\.|$)/.test(p)) classified.push("AnalysisResult.parameters.rowRange=gated"); continue; }
    const why = classify(p);
    if (why === null || why.startsWith("UNCLASSIFIED")) problems.push(`${p}: ${why ?? "outside every classified type"}`);
    else classified.push(why);
  }
  return { problems, classified };
}

describe("kitchen sink: no new key path escapes the classification maps", () => {
  it("every path a populated full-feature save adds over v0.34.0's own file belongs to a classified field", () => {
    const { problems, classified } = sinkProblems();
    expect(problems).toEqual([]);
    // Sanity: the walk saw the gated fields the edits added...
    expect(classified).toContain("DisplayBlock.ramp=gated");
    expect(classified).toContain("Dataset.linkedCurves=gated");
    expect(classified).toContain("MapViewState.view3d=gated");
    expect(classified).toContain("RecipeMapView.view3d=gated");
    expect(classified).toContain("Annotation.dot=gated");
    // ...and every populated decoration element, in every container, with no false positive on a v0.34 key.
    for (const c of [
      "Shape.x1=v034", "RefLine.axis=v034", "RegionShade.fullHeight=v034", "InsetView.lines=v034", "StatMarks.jitterWidth=v034",
      "AnnotationFrame.pad=v034", "MapAnnotation.space=v034", "OverrideShape.dash=v034", "OverrideRefLine.group_label=v034",
      "OverrideRegionShade.full_height=v034", "OverrideInset.at=v034", "FigureOverrides.page_pad=v034",
      "ReferenceStick.showLabel=v034", "OverrideStick.show_label=v034", "OverrideLegend.title=v034", "OverrideTicks.minor=v034",
      "OverrideSpines.right=v034", "OverrideBox.bottom=v034",
    ]) expect(classified).toContain(c);
  });

  it("catches a new key under every modelled element, wherever the fixture is empty (real fixture, not synthetic)", () => {
    interface Doc {
      plotWindows: { view: PlotWindow["view"] }[];
      mapViews: Record<string, { annotations: object[] }>;
      figureDocs: { publication: { overrides: NonNullable<FigureOverrides> } }[];
    }
    const last = <T,>(a: T[]): T => a[a.length - 1];
    const inject = (path: (d: Doc) => object | null | undefined) => (doc: unknown) => {
      (path(doc as Doc) as Record<string, unknown>).newKey = 1;
    };
    const cases: Record<string, (d: Doc) => object | null | undefined> = {
      "annotations[].frame": (d) => last(d.plotWindows[0].view.annotations).frame,
      "annotations[]": (d) => last(d.plotWindows[0].view.annotations),
      "shapes[]": (d) => last(d.plotWindows[0].view.shapes),
      "refLines[]": (d) => last(d.plotWindows[0].view.refLines),
      "regionShades[]": (d) => last(d.plotWindows[0].view.regionShades),
      "inset": (d) => d.plotWindows[0].view.inset,
      "statMarks.box": (d) => d.plotWindows[0].view.statMarks.box,
      "mapViews.annotations[]": (d) => d.mapViews.pop.annotations[0],
      "overrides.shapes[]": (d) => d.figureDocs[0].publication.overrides.shapes?.[0],
      "overrides.annotations[].frame": (d) => d.figureDocs[0].publication.overrides.annotations?.[0].frame,
      "overrides": (d) => d.figureDocs[0].publication.overrides,
      "refLines[].stick": (d) => last(d.plotWindows[0].view.refLines).stick,
      "overrides.ref_lines[].stick": (d) => d.figureDocs[0].publication.overrides.ref_lines?.[0].stick,
      "overrides.legend": (d) => d.figureDocs[0].publication.overrides.legend,
      "overrides.ticks": (d) => d.figureDocs[0].publication.overrides.ticks,
      "overrides.spines": (d) => d.figureDocs[0].publication.overrides.spines,
      "overrides.margins": (d) => d.figureDocs[0].publication.overrides.margins,
      "overrides.page_pad": (d) => d.figureDocs[0].publication.overrides.page_pad,
    };
    for (const [name, at] of Object.entries(cases)) {
      const { problems } = sinkProblems(inject(at));
      expect(problems.some((p) => p.includes(".newKey")), `a new key under ${name}`).toBe(true);
    }
  });

  it("a map view's pinned text is its own type, not an Annotation", () => {
    expect(classify("$.mapViews.a.annotations[].space")).toBe("MapAnnotation.space=v034");
    expect(classify("$.plotWindows[].view.annotations[].space")).toBe("UNCLASSIFIED Annotation.space");
  });
});

describe("kitchen sink: the gate itself", () => {
  const doc = (a: object) => ({ pages: [{ view: { seriesStyles: {}, yFmt: {}, annotations: [a] } }] });
  const ann = { id: "a", x: 1, y: 1, text: "t" };

  it("an annotation dot is reported only for dot:false (never for dot:true or absent)", () => {
    expect(featuresV034WouldDrop(doc({ ...ann, dot: false }))).toEqual(["Annotation.dot"]);
    expect(featuresV034WouldDrop(doc({ ...ann, dot: true }))).toEqual([]);
    expect(featuresV034WouldDrop(doc(ann))).toEqual([]);
  });

  it("is found in a view, a plot-spec decor and recipe decorations alike", () => {
    for (const root of ["$.plotWindows[].view", "$.plotRecipes[].visual.decorations", "$.savedPlotSpecs[].spec.decor", "$.figureDocs[].publication.overrides"]) {
      expect(classify(`${root}.annotations[].dot`)).toBe("Annotation.dot=gated");
    }
  });
});
