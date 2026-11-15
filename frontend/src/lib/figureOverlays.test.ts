// Gap audit 5 lane C: the fit-curve section a figure document keeps
// (lib/figureOverlays.ts) -- capture, the fail-closed rows key, and the
// untrusted load path.
import { describe, expect, it } from "vitest";

import { captureFit, fitFromDocument, overlayRowsKey, sanitizeFigureOverlays } from "./figureOverlays";
import type { Dataset, FitOverlay } from "./types";

const DS: Dataset = {
  id: "d1", name: "d1.csv",
  data: { time: [1, 2, 3], values: [[5, 0.1], [6, 0.1], [7, 0.1]], labels: ["y", "err"], units: ["", ""], metadata: {} },
};
const BIND = { yKey: 0, xKey: null };
const BAND = [{ label: "95% CI low", y: [4, 5, 6], legend: "95% confidence band" }, { label: "95% CI high", y: [6, 7, 8], legend: "" }];
const FIT: FitOverlay = { datasetId: "d1", binding: BIND, y: [5.1, 6, 6.9], band: BAND };

describe("captureFit", () => {
  it("captures the dataset's fit with its band, keyed to the dataset's rows", () => {
    const out = captureFit(FIT, DS)!;
    expect(out.rows).toBe(overlayRowsKey(DS));
    expect(out.fit).toEqual({ binding: BIND, y: [5.1, 6, 6.9], band: BAND });
  });

  it("is a copy, and refuses another dataset's, a misaligned or an unbound fit", () => {
    const source = structuredClone(FIT);
    const out = captureFit(source, DS)!;
    source.y[0] = 99;
    expect(out.fit!.y[0]).toBe(5.1);
    expect(captureFit({ ...FIT, datasetId: "other" }, DS)).toBeUndefined();
    expect(captureFit({ ...FIT, y: [1, 2] }, DS)).toBeUndefined();
    expect(captureFit({ ...FIT, band: [{ label: "low", y: [1] }] }, DS)).toBeUndefined();
    expect(captureFit(null, DS)).toBeUndefined();
  });
});

describe("overlayRowsKey covers the row state, not only the numbers (review #5)", () => {
  const key = overlayRowsKey(DS);
  it.each([
    ["an excluded row", { excludedRows: [1] }],
    ["a filter", { filter: [{ col: 0, kind: "range", min: 5.5 }] }],
    ["a column designation", { columnDesignations: { 1: "X" } }],
    ["a channel role", { channelRoles: { 1: "ignore" } }],
    ["a channel type", { channelTypes: { 1: "nominal" } }],
    ["an edited cell", { data: { ...DS.data, values: [[5, 0.1], [6.5, 0.1], [7, 0.1]] } }],
  ] as const)("%s changes it", (_name, patch) => {
    expect(overlayRowsKey({ ...DS, ...(patch as Partial<Dataset>) })).not.toBe(key);
  });

  it("a label or unit rename does not", () => {
    expect(overlayRowsKey({ ...DS, data: { ...DS.data, labels: ["M", "dM"], units: ["emu", "emu"] } })).toBe(key);
  });
});

describe("fitFromDocument (seed / render) fails closed", () => {
  const saved = captureFit(FIT, DS)!;

  it("tags the saved fit with the dataset while its rows key matches", () => {
    expect(fitFromDocument(saved, DS)).toEqual(FIT);
  });

  it("returns null once the row state changed (rows re-included), the data is loading, or it is malformed", () => {
    expect(fitFromDocument(saved, { ...DS, excludedRows: [2] })).toBeNull();
    expect(fitFromDocument(saved, { ...DS, pending: { kind: "path", path: "x", bookId: "b", rows: 3, cols: 2 } })).toBeNull();
    expect(fitFromDocument({ ...saved, fit: { binding: BIND, y: "nope" } }, DS)).toBeNull();
    expect(fitFromDocument(saved, undefined)).toBeNull();
  });
});

describe("sanitizeFigureOverlays (untrusted .dwk input)", () => {
  const saved = captureFit(FIT, DS)!;

  it("round-trips a captured section through JSON, ignoring unknown kinds", () => {
    expect(sanitizeFigureOverlays(JSON.parse(JSON.stringify({ ...saved, peaks: { y: [1] } })))).toEqual(saved);
  });

  it("rejects a malformed or empty section", () => {
    const bad = (patch: Record<string, unknown>) => sanitizeFigureOverlays({ ...JSON.parse(JSON.stringify(saved)), ...patch });
    expect(bad({ fit: { binding: { yKey: "0", xKey: null }, y: [1, 2, 3] } })).toBeUndefined();
    expect(bad({ fit: { binding: { yKey: -1, xKey: null }, y: [1, 2, 3] } })).toBeUndefined();
    expect(bad({ fit: { binding: BIND, y: [1, "x", 3] } })).toBeUndefined();
    expect(bad({ fit: { binding: BIND, y: [1, 2, 3], band: [{ label: "low", y: [1] }] } })).toBeUndefined();
    expect(bad({ rows: "" })).toBeUndefined();
    expect(sanitizeFigureOverlays({ rows: "abc" })).toBeUndefined();
    expect(sanitizeFigureOverlays("nope")).toBeUndefined();
  });
});
