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
  WORKSPACE_VERSION_TRANSFORM_STEPS,
  type LoadedWorkspace,
} from "./workspace";
import { CLASSIFICATIONS, GATED_VALUES, REPORT_FIGURE_SPEC, SERIES_STYLE, type OvList } from "./workspaceForwardCompat";

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
  "PlotWindow.linkYGroup": (ws) => { plotWindow(ws).linkYGroup = 1; },
  "AxisFormat.prob": (ws) => editFmt(ws, { prob: "percent" }),
  "AxisFormat.custom": (ws) => editFmt(ws, { custom: { at: [1, 2] } }),
  "AxisFormat.cross": (ws) => editFmt(ws, { cross: 0 }),
  "AxisFormat.reverse": (ws) => editFmt(ws, { reverse: true }),
  "AxisFormat.rotate": (ws) => editFmt(ws, { rotate: 45 }),
  "AxisFormat.offset": (ws) => editFmt(ws, { offset: 5 }),
  "AxisFormat.grid": (ws) => editFmt(ws, { grid: { major: true, minor: false } }),
  "Workspace.savedRecodeMappings": (ws) => {
    ws.savedRecodeMappings = [{ id: "r1", name: "m", mapping: { groups: [{ newLabel: "P", from: ["a"] }] }, sourceLevels: ["a"], createdAt: "2026-11-16T00:00:00Z" }];
  },
  "AxisFormat.prefix": (ws) => editFmt(ws, { prefix: "$" }),
  "AxisFormat.suffix": (ws) => editFmt(ws, { suffix: " K" }),
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
  "ExportSeriesStyle.ramp_rank": (ws) => editExport(ws, { ramp_rank: 0.5 }),
  "ExportSeriesStyle.size_by": (ws) => editExport(ws, { size_by: 1 }),
  "ExportSeriesStyle.size_range": (ws) => editExport(ws, { size_range: [2, 8] }),
  "ExportSeriesStyle.drop_lines": (ws) => editExport(ws, { drop_lines: "x" }),
  "ExportSeriesStyle.connect": (ws) => editExport(ws, { connect: "spline" }),
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
  "Dataset.columnProps": (ws) => { dataset(ws, "c").columnProps = { 0: { comment: "note" } }; },
  "Dataset.hiddenCols": (ws) => { dataset(ws, "c").hiddenCols = [0]; },
  "Dataset.frozenCols": (ws) => { dataset(ws, "c").frozenCols = 1; },
  "Dataset.linkedCurves": (ws) => {
    ws.datasets.push({ ...dataset(ws, "a"), id: "g", name: "graph", linkedCurves: [{ datasetId: "c", xKey: null, yKey: 0, label: "R1" }] });
  },
};

/** Gated on save, but this build's own loader does not keep it either: the
 *  publication-style sanitizer (lib/publicationStyles.ts) drops `ramp_rank`,
 *  which the export rebuilds from the view's `rampRank` on every export. */
const NOT_KEPT_BY_HEAD_ON_RELOAD = new Set(["ExportSeriesStyle.ramp_rank"]);

const gatedEntries = (): string[] =>
  [
    ...Object.entries(CLASSIFICATIONS).flatMap(([t, m]) => Object.keys(m).filter((k) => m[k] === "gated").map((k) => `${t}.${k}`)),
    ...GATED_VALUES,
  ].sort();

describe("forward compatibility with v0.34.0", () => {
  it("v6 is the version above everything v0.34.0 accepts (1-5)", () => {
    expect(WORKSPACE_VERSION).toBe(4);
    expect(WORKSPACE_VERSION_TRANSFORM_STEPS).toBe(5);
    expect(WORKSPACE_VERSION_NEW_FEATURES).toBe(6);
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
    it(`${name}: saved as v6 (v0.34.0 refuses it rather than dropping it), and this build keeps it`, () => {
      const ws = load();
      edit(ws);
      const text = serializeWorkspace(ws);
      expect(featuresV034WouldDrop(JSON.parse(text))).toContain(name);
      expect(version(text)).toBe(6);
      const back = parseWorkspace(text, VIEWPORT);
      expect(back.migrationWarnings).toEqual([]);
      if (NOT_KEPT_BY_HEAD_ON_RELOAD.has(name)) return;
      const again = serializeWorkspace(back);
      expect(featuresV034WouldDrop(JSON.parse(again))).toContain(name);
      expect(version(again)).toBe(6);
    });
  }

  it("the new per-series style keys stay v4: v0.34.0 carries them through unchanged", () => {
    const kept = Object.keys(SERIES_STYLE).filter((k) => SERIES_STYLE[k as keyof typeof SERIES_STYLE] === "kept-by-034");
    expect(kept.length).toBeGreaterThan(0);
    const style = {
      markerFill: "hollow", markerEdge: "#000000", markerFillColor: "#ffffff", markerAlpha: 0.5, markerEvery: 2,
      rampRank: 0.5, errorBar: { cap: 4, band: true }, sizeBy: 1, sizeRange: [2, 8], dropLines: "x", connect: "spline",
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
  };
  const refLine: Required<RefLine> = {
    id: "pr", axis: "x", value: 1, label: "l", groupId: "g", groupLabel: "gl",
    stick: { intensity: 1, baseline: 0, height: 1, color: "#000", visible: true, showLabel: true },
  };
  const shade: Required<RegionShade> = { id: "pg", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#ccc", axis: 0, fullHeight: true };
  const inset: Required<InsetView> = { x: [0, 1], y: [0, 1], y2: [0, 1], yZoom: true, at: [0.1, 0.1, 0.3, 0.3], lines: true };
  const marks: Required<StatMarks> = { points: "all", jitter: true, jitterWidth: 0.5, summary: "mean", errorBars: "sd", connectMeans: true, labelRotation: 45, labelWrap: true };
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
  };
  const ovRefLine: Required<OvList<"ref_lines">> = { axis: "x", value: 1, label: "l", group_id: "g", group_label: "gl", stick };
  const ovShade: Required<OvList<"region_shades">> = { x1: 0, x2: 1, y1: 0, y2: 1, fill: "#ccc", axis: 0, full_height: true };
  const ovInset: Required<OvList<"inset">> = { x: [0, 1], y: [0, 1], y2: [0, 1], at: [0.1, 0.1, 0.3, 0.3], lines: true };
  const legend: Required<NonNullable<FigureOverrides["legend"]>> = { show: true, loc: "best", frame: true, anchor: [0, 0], title: "t" };
  const ticks: Required<NonNullable<FigureOverrides["ticks"]>> = { dir: "in", len: 3, minor: true };
  const spines: Required<NonNullable<FigureOverrides["spines"]>> = { top: true, right: true };
  const overrides: Required<Omit<FigureOverrides, "layers" | "exchange_xy">> = { // wire-only keys: never persisted
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
