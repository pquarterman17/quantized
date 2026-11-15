// Forward compatibility with the released v0.34.0 (release prep after 0.34).
//
// v0.34.0 opens a .dwk by picking known fields by name, so a file that uses
// a newer feature opened there LOSES that feature, silently, and a re-save
// makes the loss permanent (measured with v0.34.0's own parse + serialize:
// every field `featuresV034WouldDrop` names was gone). v0.34.0 refuses any
// version outside 1-5, so such a file is written as v6: 0.34 says
// "unsupported workspace version: 6" instead of eating the data. A file with
// none of those features stays v4 (v5 with transform steps) and still opens
// in 0.34.
import { describe, expect, it } from "vitest";

import dwk034 from "./__fixtures__/workspace/v4-0.34.0.dwk.json";
import type { PlotWindow } from "./plotview";
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

const VIEWPORT = { width: 1600, height: 900 };
const load = (): LoadedWorkspace => parseWorkspace(JSON.stringify(dwk034), VIEWPORT);
const version = (text: string): number => (JSON.parse(text) as { version: number }).version;
const plotWindow = (ws: LoadedWorkspace): PlotWindow => ws.plotWindows![0];
/** Apply `edit` to the window's view AND its canonical figure document's view
 *  (a document-backed window reloads its view from the document, as the app
 *  keeps both in step). */
function editView(ws: LoadedWorkspace, edit: (v: PlotWindow["view"]) => void): void {
  const w = plotWindow(ws);
  edit(w.view);
  if (w.document) edit(w.document.plot.view as PlotWindow["view"]);
}

/** One edit per feature v0.34.0 drops, each applied to the 0.34 fixture. */
const FEATURES: Record<string, (ws: LoadedWorkspace) => void> = {
  "graph layers": (ws) => {
    editView(ws, (v) => { v.layers = [{ id: "t", kind: "table", rows: [["a", "1"]] } as never]; });
  },
  "extra Y axes": (ws) => {
    editView(ws, (v) => {
      v.yAxes = [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }];
      v.yAxisOf = { 1: 2 };
    });
  },
  "colour gradient": (ws) => {
    editView(ws, (v) => { v.seriesRamp = { map: "viridis" }; });
  },
  "linked Y axes": (ws) => {
    plotWindow(ws).linkYGroup = 1;
  },
  "symbol details": (ws) => {
    editView(ws, (v) => { v.seriesStyles = { ...v.seriesStyles, 0: { ...v.seriesStyles[0], markerFill: "hollow" } }; });
  },
  "error-bar band": (ws) => {
    editView(ws, (v) => { v.seriesStyles = { ...v.seriesStyles, 0: { ...v.seriesStyles[0], errorBar: { band: true } } }; });
  },
  "axis grid styling": (ws) => {
    editView(ws, (v) => { v.yFmt = { ...v.yFmt, grid: { major: true, minor: false } }; });
  },
  "log2 axis": (ws) => {
    editView(ws, (v) => { v.xFmt = { ...v.xFmt, base: "2" }; });
  },
  "column number format": (ws) => {
    const c = ws.datasets.find((d) => d.id === "c")!;
    c.columnProps = { 0: { comment: "note" } };
  },
  "live multi-dataset graph": (ws) => {
    const g: Dataset = { ...ws.datasets[0], id: "g", name: "graph", linkedCurves: [{ datasetId: "c", xKey: null, yKey: 0, label: "R1" }] };
    ws.datasets.push(g);
  },
};

describe("forward compatibility with v0.34.0", () => {
  it("v6 is the version above everything v0.34.0 accepts (1-5)", () => {
    expect(WORKSPACE_VERSION).toBe(4);
    expect(WORKSPACE_VERSION_TRANSFORM_STEPS).toBe(5);
    expect(WORKSPACE_VERSION_NEW_FEATURES).toBe(6);
  });

  it("a workspace with none of the new features stays v4, so v0.34.0 still opens it", () => {
    const text = serializeWorkspace(load());
    expect(featuresV034WouldDrop(JSON.parse(text))).toEqual([]);
    expect(version(text)).toBe(4);
  });

  for (const [name, edit] of Object.entries(FEATURES)) {
    it(`${name}: saved as v6 (v0.34.0 refuses it rather than dropping it), and this build reads it back`, () => {
      const ws = load();
      edit(ws);
      const text = serializeWorkspace(ws);
      expect(featuresV034WouldDrop(JSON.parse(text)).length).toBeGreaterThan(0);
      expect(version(text)).toBe(6);
      const back = parseWorkspace(text, VIEWPORT);
      expect(back.migrationWarnings).toEqual([]);
      // A re-save in this build keeps the feature, so it stays v6.
      expect(version(serializeWorkspace(back))).toBe(6);
    });
  }

  it("transform steps alone keep v5; with a new feature too, v6", () => {
    const ws = load();
    ws.macroSteps = [...(ws.macroSteps ?? []), { id: "t1", kind: "transform", label: "T", code: "", params: {}, enabled: true }];
    expect(version(serializeWorkspace(ws))).toBe(5);
    FEATURES["linked Y axes"](ws);
    expect(version(serializeWorkspace(ws))).toBe(6);
  });

  it("an unrelated object sharing a feature's key never bumps a file", () => {
    // `grid`/`top`/`offset` mean something else outside an axis format, and a
    // publication style array is not a view's style record.
    expect(featuresV034WouldDrop({ pages: [{ grid: { x: 1 }, top: 3, offset: 2, layers: [1] }], figureDocs: [{ config: { seriesStyles: [{ color: "#000000", width: 2 }] } }] })).toEqual([]);
  });
});
