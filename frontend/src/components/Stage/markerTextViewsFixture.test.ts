// Plan item 24: per-point text symbols on a GROUPED, an ENCODED and a PER-SERIES-X view, and under a plot's ROW
// WINDOW, screen == export, as a SHARED wire fixture (`tests/fixtures/wire/marker_text_views.json`). Each case
// records the export request the app builds and, per series, the (x, text) pairs the canvas draws, read off the
// REAL `usePlotPayload` pipeline (its `styleList` carries the per-row texts, `uplotTextSymbols` places them).
// The backend half (`tests/test_export_marker_text_views.py`) posts the request and asserts matplotlib draws the
// same texts at the same x. Texts number the SOURCE rows: a case excludes a row, one cuts a window, and the
// numbers must not shift.
//
// Regenerate only after a DELIBERATE rule change:
//   MARKER_TEXT_FIXTURE_WRITE=1 npx vitest run src/components/Stage/markerTextViewsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import type { FigureEncoding } from "../../lib/figureEncoding";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { loadMarks, marks } from "../../lib/marksLoader";
import { defaultPlotView, type PlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { textSymbolRows, textSymbolSpec } from "../../lib/uplotTextSymbols";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0], _yLog: boolean, _xLog: boolean,
      yKeys: number[] | null, y2Keys: number[] | null, xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "marker_text_views.json");

/** Six rows, a Y, and a two-level categorical factor (rows alternate A, B). */
function grouped(extra: Partial<Dataset> = {}): Dataset {
  const time = [0, 1, 2, 3, 4, 5];
  return {
    id: "d1", name: "item 24 views", ...extra,
    data: {
      time, values: time.map((r) => [10 + r, r % 2]), labels: ["Y", "Factor"], units: ["u", ""], metadata: {},
      cat_levels: { 1: ["A", "B"] },
    },
  };
}
/** A Y and a numeric Z to colour by (rows 0..7); the export colours each point by Z. */
function colouredBy(): Dataset {
  const time = [0, 1, 2, 3, 4, 5, 6, 7];
  return { id: "d1", name: "item 24 colour", data: { time, values: time.map((r) => [10 + r, r * r]), labels: ["Y", "Z"], units: ["u", ""], metadata: {} } };
}
/** T1, R1, T2 (an X), R2: R1 rides T1, R2 rides T2 (the second block of the per-series-X view). */
function multiX(): Dataset {
  const time = [1, 2, 3];
  return {
    id: "d1", name: "item 24 multi-x", columnDesignations: { 1: "X" }, excludedRows: [1],
    data: { time, values: [[10, 5, 100], [20, 3, 200], [30, 9, 300]], labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: { x_column_name: "T1" } },
  };
}

interface Case {
  name: string;
  ds: Dataset;
  view: Partial<PlotView>;
  groupKey?: number | null;
  encoding?: FigureEncoding;
}
const TEXT = (from: "letters" | "rows", color: string) => ({ markerTextFrom: from, color });
const CASES: Case[] = [
  { name: "grouped: letters keep their source rows, one text per row in its level", ds: grouped({ excludedRows: [2] }), groupKey: 1, view: { yKeys: [0], seriesStyles: { 0: TEXT("letters", "#3366cc") } } },
  { name: "encoded by colour: row numbers over every row, the excluded one blank", ds: grouped({ excludedRows: [2] }), encoding: { color: 1 }, view: { yKeys: [0], seriesStyles: { 0: TEXT("rows", "#aa3377") } } },
  { name: "per-series X: each curve's rows in its own X block", ds: multiX(), view: { xKey: null, yKeys: null, hiddenChannels: [1], seriesStyles: { 0: TEXT("rows", "#228833"), 2: TEXT("letters", "#884400") } } },
  { name: "a row window: letters number the sheet's rows, not the window's", ds: grouped(), view: { yKeys: [0], rowRange: { from: 2, to: 4 }, seriesStyles: { 0: TEXT("letters", "#115577") } } },
  { name: "colour by a number: row numbers replace the coloured dots", ds: colouredBy(), view: { yKeys: [0], seriesStyles: { 0: { ...TEXT("rows", "#aa3377"), colorBy: 1 } } } },
];

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

beforeAll(async () => { await loadMarks(); });

interface Drawn { x: number; text: string }

/** Per colour-mapped series on the canvas: does the colour layer still paint its points under the text? */
async function canvasDotsUnderText(c: Case): Promise<boolean[]> {
  const v = viewOf(c);
  const p: PlotPayloadParams = {
    active: c.ds, yScale: "linear", xScale: "linear", xKey: v.xKey, yKeys: v.yKeys, groupKey: null, y2Keys: null,
    seriesOrder: null, seriesStyles: v.seriesStyles, seriesLabels: {}, errKeys: {}, hiddenChannels: v.hiddenChannels,
    waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null,
    selection: null, xLim: null, rowRange: v.rowRange,
  };
  const { result } = renderHook(() => usePlotPayload(p));
  await waitFor(() => expect(result.current.colorByColumns.size).toBeGreaterThan(0));
  await waitFor(() => expect([...result.current.colorByColumns.values()].every((s) => s.text === true)).toBe(true));
  return [...result.current.colorByColumns.values()].map((s) => !s.text);
}

/** Per series, what the canvas draws: (x, text) pairs in row order. */
async function canvasDraws(c: Case): Promise<Drawn[][]> {
  const v = viewOf(c);
  const p: PlotPayloadParams = {
    active: c.ds, yScale: "linear", xScale: "linear", xKey: v.xKey, yKeys: v.yKeys, groupKey: c.groupKey ?? null, y2Keys: null,
    seriesOrder: null, seriesStyles: v.seriesStyles, seriesLabels: {}, errKeys: {}, hiddenChannels: v.hiddenChannels,
    waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null,
    selection: null, xLim: null, rowRange: v.rowRange, ...(c.encoding ? { encoding: c.encoding } : {}),
  };
  const { result } = renderHook(() => usePlotPayload(p));
  await waitFor(() => expect(result.current.displayPayload?.series).toHaveLength(c.encoding ? 2 : result.current.displayPayload?.series.length ?? 0)); // an encoding splits once its lazy module loads
  const d = result.current.displayPayload!;
  await waitFor(() => expect(result.current.styleList?.some((s) => (s as { markerTexts?: unknown } | undefined)?.markerTexts)).toBe(true));
  const xs = d.data[0] as (number | null)[];
  const out: Drawn[][] = [];
  result.current.styleList!.forEach((style, i) => {
    const spec = textSymbolSpec(style);
    if (!spec || !spec.texts) return;
    const ys = d.data[i + 1] as (number | null)[];
    const rows = textSymbolRows(xs, ys, spec.every).filter((r) => spec.texts![r]);
    if (rows.length) out.push(rows.map((r) => ({ x: xs[r] as number, text: spec.texts![r] as string })));
  });
  return out;
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c), groupKey: c.groupKey ?? null, ...(c.encoding ? { encoding: c.encoding } : {}) });
  return buildFigureSpecFromDocument(doc, c.ds, "item-24-views", { fmt: "svg" });
}

const coloured = (c: Case): boolean => Object.values(c.view.seriesStyles ?? {}).some((st) => st.colorBy != null);
const fresh = async () => ({
  cases: await Promise.all(CASES.map(async (c) => ({
    name: c.name, request: request(c), canvas: await canvasDraws(c), ...(coloured(c) ? { dotsUnderText: await canvasDotsUnderText(c) } : {}),
  }))),
});
const texts = (series: Drawn[][]) => series.map((s) => s.map((p) => p.text));

describe("per-point text symbols on grouped, encoded, per-series-X and windowed views", () => {
  it("a grouped view draws each level's rows with their source letters", async () => {
    // rows 0..5, row 2 excluded: level A holds rows 0, 4 (row 2 is masked), level B rows 1, 3, 5.
    expect(texts(await canvasDraws(CASES[0]))).toEqual([["A", "E"], ["B", "D", "F"]]);
    const wire = request(CASES[0]).series_styles?.[0] as { marker_texts?: (string | null)[] };
    expect(wire.marker_texts).toEqual(["A", "B", "D", "E", "F"]); // the pruned dataset's rows, lettered by source row
  });

  it("an encoded view keeps every row and blanks the excluded one on the canvas", async () => {
    expect(texts(await canvasDraws(CASES[1]))).toEqual([["1", "5"], ["2", "4", "6"]]);
    const wire = request(CASES[1]);
    expect((wire.series_styles?.[0] as { marker_texts?: unknown }).marker_texts).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(wire.excluded_rows).toEqual([2]);
  });

  it("a per-series-X view repeats the sheet's rows per block, each curve only in its own", async () => {
    // R1 rides T1 = 1, 2, 3 (row 1 excluded); R2 rides T2 = 5, 3, 9 (row 1 excluded).
    expect(texts(await canvasDraws(CASES[2]))).toEqual([["1", "3"], ["A", "C"]]);
    const wire = request(CASES[2]).series_styles as ({ marker_texts?: (string | null)[] } | null)[];
    expect(wire[0]?.marker_texts).toEqual(["1", "3", "1", "3"]); // block 1 then block 2, the excluded row pruned from each
    expect(wire[1]?.marker_texts).toEqual(["A", "C", "A", "C"]);
  });

  it("a row window numbers the sheet's rows on the canvas and in the export", async () => {
    expect(texts(await canvasDraws(CASES[3]))).toEqual([["C", "D", "E"]]);
    const wire = request(CASES[3]).series_styles?.[0] as { marker_texts?: (string | null)[] };
    expect(wire.marker_texts).toEqual(["C", "D", "E"]);
  });

  it("a colour-by series draws its text only: the colour layer paints no point beneath it", async () => {
    const c = CASES[4];
    expect(texts(await canvasDraws(c))).toEqual([["1", "2", "3", "4", "5", "6", "7", "8"]]);
    expect(await canvasDotsUnderText(c)).toEqual([false]);
    const wire = request(c).series_styles?.[0] as { marker_texts?: string[]; color_by?: number };
    expect(wire.color_by).toBe(1);
    expect(wire.marker_texts).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("matches the committed wire fixture", async () => {
    expect(marks()).not.toBeNull();
    const now = JSON.parse(JSON.stringify(await fresh()));
    if (process.env.MARKER_TEXT_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
