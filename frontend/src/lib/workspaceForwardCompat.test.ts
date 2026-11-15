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
import type { PlotWindow } from "./plotview";
import type { SavedPlotSpec } from "./plotspec";
import type { Dataset } from "./types";
import {
  featuresV034WouldDrop,
  parseWorkspace,
  serializeWorkspace,
  WORKSPACE_VERSION,
  WORKSPACE_VERSION_NEW_FEATURES,
  WORKSPACE_VERSION_TRANSFORM_STEPS,
  type LoadedWorkspace,
} from "./workspace";
import { CLASSIFICATIONS, GATED_VALUES, SERIES_STYLE } from "./workspaceForwardCompat";

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

// ── Kitchen sink: every key path HEAD writes that v0.34.0 never wrote ──────────
/** Typed containers by path: a new key directly under one is the type's field. */
const CONTAINERS: readonly [RegExp, string][] = [
  [/^\$\.datasets\[\]$/, "Dataset"],
  [/^\$\.plotWindows\[\]$/, "PlotWindow"],
  [/\.view$/, "PlotView"],
  [/\.(xFmt|yFmt|y2Fmt)$/, "AxisFormat"],
  [/\.seriesStyles\[\]$/, "ExportSeriesStyle"],
  [/\.seriesStyles\.[^.[\]]+$/, "SeriesStyle"],
  [/^\$\.savedPlotSpecs\[\]\.spec\.display$/, "DisplayBlock"],
  [/^\$\.plotRecipes\[\]\.visual$/, "RecipeVisual"],
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

/** Why a new path is allowed, or null: the classified field it belongs to. */
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

describe("kitchen sink: no new key path escapes the classification maps", () => {
  it("every path a full-feature save adds over v0.34.0's own file belongs to a classified field", () => {
    const ws = load();
    for (const edit of Object.values(FEATURES)) edit(ws);
    const head = paths(JSON.parse(serializeWorkspace(ws)));
    const old034 = paths(dwk034);
    const problems: string[] = [];
    const classified: string[] = [];
    for (const p of head) {
      if (old034.has(p) || p in KNOWN_034_PATHS) continue;
      const why = classify(p);
      if (why === null || why.startsWith("UNCLASSIFIED")) problems.push(`${p}: ${why ?? "outside every classified type"}`);
      else classified.push(why);
    }
    expect(problems).toEqual([]);
    // Sanity: the walk saw the gated fields the edits added.
    expect(classified).toContain("DisplayBlock.ramp=gated");
    expect(classified).toContain("Dataset.linkedCurves=gated");
  });
});
