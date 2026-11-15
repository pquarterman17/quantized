// Gap audit 5 lane C: the analysis-overlay section a figure document keeps
// (lib/figureOverlays.ts) -- capture, fail-closed row check, and the untrusted
// load path.
import { describe, expect, it } from "vitest";

import { dataFingerprint } from "./dataFingerprint";
import {
  captureFigureOverlays,
  liveOverlaysFromDocument,
  overlaysMatchData,
  sanitizeFigureOverlays,
  type LiveOverlays,
} from "./figureOverlays";
import type { DataStruct } from "./types";

const DATA: DataStruct = { time: [1, 2, 3], values: [[5], [6], [7]], labels: ["y"], units: [""], metadata: {} };
const BIND = { yKey: 0, xKey: null };
const BAND = [{ label: "95% CI low", y: [4, 5, 6], legend: "95% confidence band" }, { label: "95% CI high", y: [6, 7, 8], legend: "" }];

function live(over: Partial<LiveOverlays> = {}): LiveOverlays {
  return {
    fitOverlay: { datasetId: "d1", binding: BIND, y: [5.1, 6, 6.9], band: BAND },
    baselineOverlay: { datasetId: "d1", binding: BIND, y: [1, 1, 1] },
    peakOverlay: { datasetId: "d1", binding: { yKey: -1, xKey: null }, y: [null, 6, null] },
    ...over,
  };
}

describe("captureFigureOverlays", () => {
  it("captures every overlay drawn for the dataset, with the fit's band, keyed to the data's hash", () => {
    const out = captureFigureOverlays(live(), "d1", DATA)!;
    expect(out.rows).toBe(dataFingerprint(DATA));
    expect(out.fit).toEqual({ binding: BIND, y: [5.1, 6, 6.9], band: BAND });
    expect(out.baseline).toEqual({ binding: BIND, y: [1, 1, 1] });
    expect(out.peaks).toEqual({ binding: { yKey: -1, xKey: null }, y: [null, 6, null] });
  });

  it("is a copy: editing the store's overlay later never edits the figure", () => {
    const source = live();
    const out = captureFigureOverlays(source, "d1", DATA)!;
    source.fitOverlay!.y[0] = 99;
    expect(out.fit!.y[0]).toBe(5.1);
  });

  it("leaves out another dataset's overlay and a row-misaligned one; none at all is undefined", () => {
    const out = captureFigureOverlays(live({
      fitOverlay: { datasetId: "other", binding: BIND, y: [1, 2, 3] },
      baselineOverlay: { datasetId: "d1", binding: BIND, y: [1, 1] },
    }), "d1", DATA)!;
    expect(Object.keys(out).sort()).toEqual(["peaks", "rows"]);
    expect(captureFigureOverlays({ fitOverlay: null, baselineOverlay: null, peakOverlay: null }, "d1", DATA)).toBeUndefined();
    expect(captureFigureOverlays(live(), null, DATA)).toBeUndefined();
  });

  it("drops a fit whose band does not align to the rows (never a partial band)", () => {
    const fit = { datasetId: "d1", binding: BIND, y: [1, 2, 3], band: [{ label: "low", y: [1, 2] }] };
    expect(captureFigureOverlays(live({ fitOverlay: fit }), "d1", DATA)!.fit).toBeUndefined();
  });
});

describe("liveOverlaysFromDocument (seed / render) fails closed", () => {
  const saved = captureFigureOverlays(live(), "d1", DATA)!;

  it("tags each saved kind with the dataset while the rows hash the same", () => {
    const out = liveOverlaysFromDocument(saved, "d1", DATA);
    expect(out.fitOverlay).toEqual({ datasetId: "d1", binding: BIND, y: [5.1, 6, 6.9], band: BAND });
    expect(out.peakOverlay?.datasetId).toBe("d1");
  });

  it("returns nothing once any cell of the data changed (no re-alignment)", () => {
    const edited: DataStruct = { ...DATA, values: [[5], [6.5], [7]] };
    expect(overlaysMatchData(saved, edited)).toBe(false);
    expect(liveOverlaysFromDocument(saved, "d1", edited)).toEqual({});
    const extraRow: DataStruct = { ...DATA, time: [1, 2, 3, 4], values: [[5], [6], [7], [8]] };
    expect(liveOverlaysFromDocument(saved, "d1", extraRow)).toEqual({});
  });
});

describe("sanitizeFigureOverlays (untrusted .dwk input)", () => {
  const saved = captureFigureOverlays(live(), "d1", DATA)!;

  it("round-trips a captured section through JSON", () => {
    expect(sanitizeFigureOverlays(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("drops the whole section on any malformed curve, never part of it", () => {
    const bad = (patch: Record<string, unknown>) => sanitizeFigureOverlays({ ...JSON.parse(JSON.stringify(saved)), ...patch });
    expect(bad({ fit: { binding: { yKey: "0", xKey: null }, y: [1, 2, 3] } })).toBeUndefined();
    expect(bad({ fit: { binding: BIND, y: [1, "x", 3] } })).toBeUndefined();
    expect(bad({ baseline: { binding: BIND, y: [1, 2] } })).toBeUndefined(); // not the fit's row count
    expect(bad({ fit: { binding: BIND, y: [1, 2, 3], band: [{ label: "low", y: [1] }] } })).toBeUndefined();
    expect(bad({ rows: "" })).toBeUndefined();
    expect(sanitizeFigureOverlays({ rows: "abc" })).toBeUndefined(); // no curve at all
    expect(sanitizeFigureOverlays("nope")).toBeUndefined();
  });
});
