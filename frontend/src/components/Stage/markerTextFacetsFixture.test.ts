// Plan item 24: per-point text symbols on a FACET GRID, screen == export, as a SHARED wire fixture
// (`tests/fixtures/wire/marker_text_facets.json`). Each case records the export request the app builds and, per
// panel and series, the (x, text) pairs the canvas draws (`useFacetTextStyles`, the hook the grid renders through).
// The backend half (`tests/test_export_marker_text_facets.py`) posts the request and asserts each matplotlib panel
// draws the same texts at the same x. Texts number the SHEET's rows: a case excludes a row and one cuts a window.
//
// Regenerate only after a DELIBERATE rule change:
//   MARKER_TEXT_FIXTURE_WRITE=1 npx vitest run src/components/Stage/markerTextFacetsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { facetCompositionFromBinding } from "../../lib/facet";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { loadMarks, marks } from "../../lib/marksLoader";
import { defaultPlotView, type PlotView } from "../../lib/plotview";
import { windowedDataset } from "../../lib/rowWindowDataset";
import type { Dataset } from "../../lib/types";
import { textSymbolRows, textSymbolSpec } from "../../lib/uplotTextSymbols";
import { useFacetTextStyles } from "./useFacetTextStyles";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "marker_text_facets.json");

/** Eight rows, a Y, and a facet column holding levels 0 / 1 in an interleaved order. */
function sheet(extra: Partial<Dataset> = {}): Dataset {
  const time = [0, 1, 2, 3, 4, 5, 6, 7];
  return { id: "d1", name: "item 24 facets", ...extra, data: { time, values: time.map((r) => [10 + r, [0, 1, 1, 0, 0, 1, 0, 1][r]]), labels: ["Y", "Level"], units: ["u", ""], metadata: {} } };
}
interface Case { name: string; ds: Dataset; view: Partial<PlotView> }
const STYLE = { markerTextFrom: "letters", color: "#3366cc" } as const;
const CASES: Case[] = [
  { name: "facets: each panel's points keep their sheet row's letter, an excluded row is skipped", ds: sheet({ excludedRows: [3] }), view: { facetKey: 1, yKeys: [0], seriesStyles: { 0: STYLE } } },
  { name: "facets under a row window: letters still number the sheet's rows", ds: sheet({ excludedRows: [5] }), view: { facetKey: 1, yKeys: [0], rowRange: { from: 2, to: 6 }, seriesStyles: { 0: { markerTextFrom: "rows", color: "#aa3377" } } } },
];
const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

beforeAll(async () => { await loadMarks(); });

interface Drawn { x: number; text: string }

/** Per panel, per series: the canvas's (x, text) pairs. */
function canvasDraws(c: Case): Drawn[][][] {
  const v = viewOf(c);
  const win = windowedDataset(c.ds, v.rowRange);
  const comp = facetCompositionFromBinding(win, v.facetKey as number, v.xKey, v.yKeys);
  const { result } = renderHook(() => useFacetTextStyles(comp, c.ds, win, v.rowRange, v.xKey, v.seriesStyles, {}, false));
  const grid = result.current!;
  return grid.panels.map((p, i) => {
    const xs = p.payload.data[0] as (number | null)[];
    return grid.styles[i].map((style, k) => {
      const spec = textSymbolSpec(style)!;
      const ys = p.payload.data[k + 1] as (number | null)[];
      return textSymbolRows(xs, ys, spec.every).filter((r) => spec.texts![r]).map((r) => ({ x: xs[r] as number, text: spec.texts![r] as string }));
    });
  });
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c), facetKey: viewOf(c).facetKey });
  return buildFigureSpecFromDocument(doc, c.ds, "item-24-facets", { fmt: "svg" });
}

describe("per-point text symbols on a facet grid", () => {
  it("each panel reads its rows' letters from the sheet", () => {
    const d = canvasDraws(CASES[0]);
    // level 0 = rows 0, 3 (excluded), 4, 6; level 1 = rows 1, 2, 5, 7.
    expect(d.map((p) => p[0].map((q) => q.text))).toEqual([["A", "E", "G"], ["B", "C", "F", "H"]]);
    const wire = request(CASES[0]).facets!.map((f) => (f.series[0].style as { marker_texts?: unknown }).marker_texts);
    expect(wire).toEqual([["A", "E", "G"], ["B", "C", "F", "H"]]);
  });

  it("a row window numbers the sheet's rows, not the window's", () => {
    const d = canvasDraws(CASES[1]);
    // window rows 2..6: level 0 = rows 3, 4, 6; level 1 = rows 2, (5 excluded).
    expect(d.map((p) => p[0].map((q) => q.text))).toEqual([["4", "5", "7"], ["3"]]);
    const wire = request(CASES[1]).facets!.map((f) => (f.series[0].style as { marker_texts?: unknown }).marker_texts);
    expect(wire).toEqual([["4", "5", "7"], ["3"]]);
  });

  it("a grid split by a group draws and sends no per-point text", () => {
    const c = CASES[0];
    const comp = facetCompositionFromBinding(c.ds, 1, null, [0]);
    const { result } = renderHook(() => useFacetTextStyles(comp, c.ds, c.ds, undefined, null, viewOf(c).seriesStyles, {}, true));
    expect(result.current).toBeNull();
  });

  it("matches the committed wire fixture", () => {
    expect(marks()).not.toBeNull();
    const now = JSON.parse(JSON.stringify({ cases: CASES.map((c) => ({ name: c.name, request: request(c), canvas: canvasDraws(c) })) }));
    if (process.env.MARKER_TEXT_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
