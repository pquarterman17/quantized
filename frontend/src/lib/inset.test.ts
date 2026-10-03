// The magnifier inset's pure rules. Plot audit leftovers: the inset was
// screen-only — no persisted geometry, nothing on the export wire — so its
// state now lives on the view (`PlotView.inset`, sanitized from a `.dwk`), rides
// the export request (`insetWire`), and both sides pick the same connector lines
// from a shared table (`tests/fixtures/wire/inset_connectors.json`, also read by
// `tests/test_calc_figure_inset.py`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { centralRange, clampAt, DEFAULT_INSET_AT, insetConnectors, insetWire, type UpRect } from "./inset";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import { sanitizeInset } from "./plotviewDecor";

describe("centralRange", () => {
  it("returns the centred fraction of the span", () => {
    // 30% of [0,100] centred on 50 -> [35, 65].
    expect(centralRange(0, 100, 0.3)).toEqual([35, 65]);
  });

  it("clamps fraction >= 1 to the full range", () => {
    expect(centralRange(0, 100, 1)).toEqual([0, 100]);
    expect(centralRange(0, 100, 2)).toEqual([0, 100]);
  });

  it("returns the endpoints for a degenerate or non-finite span", () => {
    expect(centralRange(5, 5)).toEqual([5, 5]);
    expect(centralRange(10, 0)).toEqual([10, 0]);
    expect(centralRange(NaN, 1)).toEqual([NaN, 1]);
  });
});

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "inset_connectors.json",
);
const cases = (JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: { name: string; source: UpRect; inset: UpRect; corners: string[] }[];
}).cases;

describe("insetConnectors (shared with the export)", () => {
  it.each(cases)("$name", ({ source, inset, corners }) => {
    expect(insetConnectors(source, inset)).toEqual(corners);
  });
});

const SAVED = { x: [10, 20], y: [0.5, 9], yZoom: true, at: [0.1, 0.2, 0.3, 0.4], lines: false };

describe("PlotView.inset persistence", () => {
  it("round-trips a saved inset through the .dwk sanitizer", () => {
    expect(sanitizePlotView({ ...defaultPlotView(), insetMode: true, inset: SAVED }).inset).toEqual(SAVED);
  });

  it("opens an older .dwk (no inset) with none", () => {
    const { inset: _drop, ...older } = defaultPlotView();
    expect(sanitizePlotView({ ...older, insetMode: true }).inset).toBeNull();
  });

  it("drops a malformed inset", () => {
    expect(sanitizeInset({ ...SAVED, x: [20] })).toBeNull();
    expect(sanitizeInset({ ...SAVED, x: [1, Infinity] })).toBeNull();
    expect(sanitizeInset({ ...SAVED, at: [0.1, 0.2] })).toBeNull();
    expect(sanitizeInset({ ...SAVED, at: [0.1, 0.2, "0.3", 0.3] })).toBeNull();
    expect(sanitizeInset("x")).toBeNull();
    expect(sanitizeInset(null)).toBeNull();
    expect(sanitizeInset({ x: [1, 2], at: [0, 0, 1, 1], y: "no", yZoom: 1 })).toEqual({
      x: [1, 2], y: null, yZoom: true, at: [0, 0, 1, 1], lines: true,
    });
  });

  // The eager sanitizer only checks shape; whatever draws it orders and clamps.
  it("never exports a reversed pair or an off-frame placement", () => {
    expect(clampAt([-1, 2, 0, 0.5])).toEqual([0, 1, 0.05, 0.5]); // the export rejects a zero size
    expect(clampAt(null)).toEqual([...DEFAULT_INSET_AT]);
    expect(insetWire({ x: [1, 2], y: [3, 2], yZoom: false, at: [-1, 2, 0.01, 0.5], lines: true })).toEqual({
      x: [1, 2], at: [0, 1, 0.05, 0.5], lines: true,
    });
    expect(insetWire({ x: [2, 1], y: null, yZoom: false, at: [0.1, 0.2, 0.3, 0.4], lines: false })).toEqual({
      at: [0.1, 0.2, 0.3, 0.4], lines: false,
    });
  });
});

describe("insetWire", () => {
  it("sends the saved region, placement and connector choice", () => {
    expect(insetWire({ x: [10, 20], y: [0.5, 9], yZoom: false, at: [0.1, 0.2, 0.3, 0.4], lines: false })).toEqual({
      x: [10, 20], y: [0.5, 9], at: [0.1, 0.2, 0.3, 0.4], lines: false,
    });
  });

  it("sends only the default placement for an inset never drawn", () => {
    expect(insetWire(null)).toEqual({ at: [...DEFAULT_INSET_AT], lines: true });
  });
});
