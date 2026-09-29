// P1.4 residual 2: the Graph Builder -> Publication Preview bridge carries the
// Color / Symbol / Label encodings. The preview renders a canonical
// FigureDocument through `buildFigureSpecFromDocument` (`canonicalReadiness`),
// which already sends `bindings.encoding`; these tests pin that the BRIDGE puts
// it there, with the series half the Graph Builder's own Export sends, so the
// preview's request is the committed wire fixture's
// (`tests/fixtures/wire/graph_encoding_export.json`, drawn and read back by
// `tests/test_export_graph_encoding.py`).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeCanonicalReadiness } from "../components/workshops/figurebuilder/canonicalReadiness";
import { GRADIENT_DS, GRADIENT_SPEC, readGradientFixture } from "../test/gradientEncodingFixture";
import type { FigureSpec } from "./api/figures";
import { encodeSpec } from "./plotEncoding";
import { encodedFigureSpec } from "./plotEncodingExport";
import { plotSpecToFigureDocument } from "./plotSpecFigure";
import type { PlotSpec } from "./plotspec";
import { SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset, DataStruct } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(here, "../../../tests/fixtures/wire/graph_encoding_export.json"), "utf-8"),
) as { request: FigureSpec };
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// The fixture's own table (lib/plotEncodingExport.test.ts documents each row).
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  values: [
    [1.0, 0, 0, 10], [1.5, 0, 1, 10], [2.0, 1, 0, 300], [2.5, 1, 1, 300], [3.0, 2, 0, 77], [3.5, 2, 1, 77],
    [4.0, 2, 1, 80], [4.5, 0, 0, 10], [5.0, 1, 1, 300], [NaN, 0, 1, 10], [6.0, NaN, 0, 10], [6.5, 1, 0, 300],
    [7.0, 2, 0, 77],
  ],
  labels: ["Rxy", "sample", "field", "T"],
  units: ["Ohm", "", "", "K"],
  metadata: { x_column_name: "t", x_column_unit: "s" },
  cat_levels: { 1: ["S1", "S2", "S3"] },
  level_order: { 1: [2, 0, 1] },
};
const DS: Dataset = { id: "enc", name: "encoding.csv", data: DATA };
const ref = (channel: number) => ({ datasetId: "enc", channel });
const zones = (over: Partial<PlotSpec["zones"]> = {}): PlotSpec["zones"] => ({
  x: null, y: [ref(0)], group: null, facet: null, yErr: [], xErr: null, ...over,
});
const SPEC: PlotSpec = { version: 1, zones: zones({ color: ref(1), symbol: ref(2), label: ref(3) }), mark: "scatter" };
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "", greyscale: false };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

/** What the Publication Preview requests for `spec` opened from the Graph
 *  Builder: the bridge, then the preview's own readiness path. */
function previewRequest(spec: PlotSpec, live: Record<number, { width?: number }> = {}): FigureSpec {
  const document = plotSpecToFigureDocument(spec, "Encoded", live, encodeSpec(spec, [DS]));
  expect(document).not.toBeNull();
  const ready = computeCanonicalReadiness(document, DS);
  if (ready?.state !== "ready") throw new Error(`preview not ready: ${JSON.stringify(ready)}`);
  return ready.spec;
}

const SERIES_FIELDS = ["y_keys", "x_key", "group_col", "encoding", "series_styles", "error_spans"] as const;
const seriesHalf = (s: FigureSpec) => Object.fromEntries(SERIES_FIELDS.map((k) => [k, s[k]]));

describe("Publication Preview of an encoded Graph Builder spec (P1.4)", () => {
  it("the draft document carries the picks as the plot window's own binding", () => {
    const document = plotSpecToFigureDocument(SPEC, "Encoded", {}, encodeSpec(SPEC, [DS]))!;
    expect(document.bindings.encoding).toEqual({ color: 1, symbol: 2, label: 3 });
    expect(document.bindings.groupKey).toBeNull();
  });

  it("requests the committed wire fixture's series, encoding and legend", () => {
    const req = previewRequest(SPEC);
    expect(req.encoding).toEqual(FIXTURE.request.encoding);
    expect(req.y_keys).toEqual(FIXTURE.request.y_keys);
    expect(req.series_styles).toEqual(FIXTURE.request.series_styles);
    expect(req.overrides?.legend?.show).toBe(true);
    expect(req.group_col).toBeUndefined();
    expect(req.error_spans).toBeUndefined();
    expect(JSON.parse(JSON.stringify(req.dataset))).toEqual(FIXTURE.request.dataset);
  });

  it("is the Graph Builder Export's own series half (preview == export)", () => {
    const e = encodeSpec(SPEC, [DS])!;
    expect(seriesHalf(previewRequest(SPEC))).toEqual(seriesHalf(encodedFigureSpec(e, SPEC, "encoding", OPTS)));
  });

  it("draws the preview's mark, not the live per-channel styling, for an encoded spec only", () => {
    expect(previewRequest(SPEC, { 0: { width: 3 } }).series_styles).toEqual(FIXTURE.request.series_styles);
    // Control: the same live styling does reach an UNencoded spec's preview.
    const plain: PlotSpec = { ...SPEC, zones: zones() };
    expect(previewRequest(plain, { 0: { width: 3 } }).series_styles?.[0]).toMatchObject({ width: 3 });
    expect(previewRequest(plain).encoding).toBeUndefined();
  });

  it("keeps the error wells for a legend-source-only encoding and drops them once a factor splits", () => {
    const wells = zones({ yErr: [ref(3)], label: ref(3) });
    expect(previewRequest({ ...SPEC, zones: wells }).error_spans).toHaveLength(1);
    expect(previewRequest({ ...SPEC, zones: { ...wells, color: ref(1) } }).error_spans).toBeUndefined();
  });

  it("a gradient Color-by and text-column factors open as the gradient wire fixture's request (residuals 4, 5)", () => {
    const G = readGradientFixture();
    const e = encodeSpec(GRADIENT_SPEC, [GRADIENT_DS]);
    const document = plotSpecToFigureDocument(GRADIENT_SPEC, "Gradient", {}, e)!;
    // The gated picks go back to the document's form: the gradient as the colour
    // pick, the text columns by name.
    expect(document.bindings.encoding).toEqual({ color: 1, text: { symbol: "C", label: "D" } });
    const ready = computeCanonicalReadiness(document, GRADIENT_DS);
    if (ready?.state !== "ready") throw new Error(`preview not ready: ${JSON.stringify(ready)}`);
    expect(ready.spec.encoding).toEqual(G.request.encoding);
    expect(ready.spec.y_keys).toEqual(G.request.y_keys);
    expect(ready.spec.series_styles).toEqual(G.request.series_styles);
    expect(JSON.parse(JSON.stringify(ready.spec.dataset))).toEqual(G.request.dataset);
  });

  it("stores the GATED picks: a factor from another dataset never becomes this dataset's channel", () => {
    const foreign: PlotSpec = { ...SPEC, zones: zones({ color: { datasetId: "other", channel: 1 }, label: ref(3) }) };
    const document = plotSpecToFigureDocument(foreign, "Encoded", {}, encodeSpec(foreign, [DS]))!;
    expect(document.bindings.encoding).toEqual({ label: 3 });
    expect(previewRequest(foreign).encoding).not.toHaveProperty("color_col");
  });

  it("an ungated pick (a continuous symbol column) opens as an ordinary figure", () => {
    const req = previewRequest({ ...SPEC, zones: zones({ symbol: ref(0) }) });
    expect(req.encoding).toBeUndefined();
  });
});
