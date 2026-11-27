// Plan item 24: per-point text symbols (from a column, incremental letters, source row numbers), screen ==
// export, as a SHARED wire fixture (`tests/fixtures/wire/marker_text_rows.json`). Each case records the
// export request the app builds and the (x, text) pairs the canvas draws; the backend half
// (`tests/test_export_marker_text_rows.py`) posts the request and asserts matplotlib draws the same texts at
// the same x. Row numbers are SOURCE rows: a case excludes a row and the numbers must not shift.
//
// Regenerate only after a DELIBERATE rule change:
//   MARKER_TEXT_FIXTURE_WRITE=1 npx vitest run src/lib/markerTextRowsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { lettersOf, markerTextRows } from "./markerTextRows";
import { loadMarks, marks } from "./marksLoader";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { droppedRows } from "./rowstate";
import type { Dataset } from "./types";
import { textSymbolRows, textSymbolSpec } from "./uplotTextSymbols";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "marker_text_rows.json");

function dataset(n: number, y: (r: number) => number, extra: Partial<Dataset> = {}, metadata: Record<string, unknown> = {}): Dataset {
  const time = Array.from({ length: n }, (_, r) => r);
  return { id: "d1", name: "item 24", data: { time, values: time.map((r) => [y(r), r * 10]), labels: ["S", "T"], units: ["u", "u"], metadata }, ...extra };
}

interface Case { name: string; ds: Dataset; view: Partial<PlotView> }
const CASES: Case[] = [
  {
    name: "letters run past Z over a gap",
    ds: dataset(30, (r) => (r === 4 ? NaN : r)),
    view: { yKeys: [0], seriesStyles: { 0: { markerTextFrom: "letters", color: "#3366cc" } } },
  },
  {
    name: "row numbers are source rows when a row is excluded",
    ds: dataset(6, (r) => r + 1, { excludedRows: [1] }),
    view: { yKeys: [0], seriesStyles: { 0: { markerTextFrom: "rows", markerTextSize: 8, color: "#aa3377" } } },
  },
  {
    name: "a numeric column, blank where it is not a number, every 2nd drawn point",
    ds: dataset(6, (r) => r + 1, {}, {}),
    view: { yKeys: [0], seriesStyles: { 0: { markerTextFrom: 1, markerEvery: 2, color: "#228833" } } },
  },
  {
    name: "a text column leaves blank cells unmarked",
    ds: dataset(5, (r) => r + 1, {}, { text_columns: { Tag: ["Fe", "", "Ni", "Co", "  "] } }),
    view: { yKeys: [0], seriesStyles: { 0: { markerTextFrom: { name: "Tag" }, color: "#884400" } } },
  },
];
CASES[2].ds.data.values[1][1] = NaN; // row 1 has no number in the label column: its symbol is blank

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

beforeAll(async () => { await loadMarks(); });

/** What the canvas draws: (x, text) pairs in row order. */
function canvasDraws(c: Case) {
  const view = viewOf(c);
  const channels = effectiveChannels(c.ds.data, view.yKeys, view.xKey, c.ds.channelRoles, view.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(c.ds.data, null, view.xKey, channels), {
    id: c.ds.id, waterfall: 0, dropped: droppedRows(c.ds), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const xs = payload.data[0] as (number | null)[];
  const ys = payload.data[1] as (number | null)[];
  const list = marks()!.withMarkerTexts([view.seriesStyles[channels[0]]], channels, c.ds, payload.data);
  const spec = textSymbolSpec(list[0])!;
  return textSymbolRows(xs, ys, spec.every).filter((i) => spec.texts![i]).map((i) => ({ x: xs[i], text: spec.texts![i] }));
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c) });
  return buildFigureSpecFromDocument(doc, c.ds, "item-24-rows", { fmt: "svg" });
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, request: request(c), canvas: canvasDraws(c) })) });

describe("per-point text symbols, screen == export (shared wire fixture)", () => {
  it("letters count like a spreadsheet's columns", () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(lettersOf)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("letters skip the non-finite row but keep their source rows", () => {
    const d = canvasDraws(CASES[0]);
    expect(d.map((p) => p.text).slice(0, 6)).toEqual(["A", "B", "C", "D", "F", "G"]); // row 4 (E) has no y
    expect(d).toHaveLength(29);
    expect(d[28].text).toBe("AD");
  });

  it("row numbers are the source rows: an excluded row does not renumber the rest", () => {
    expect(canvasDraws(CASES[1]).map((p) => p.text)).toEqual(["1", "3", "4", "5", "6"]);
    const wire = request(CASES[1]).series_styles?.[0] as { marker_texts?: (string | null)[] };
    expect(wire.marker_texts).toEqual(["1", "3", "4", "5", "6"]); // pruned to the kept rows, numbered by source
  });

  it("a column's cells: numbers to 6 digits, blanks draw nothing, every Nth counts drawn rows", () => {
    expect(markerTextRows(CASES[2].ds, CASES[2].view.seriesStyles![0])).toEqual(["0", null, "20", "30", "40", "50"]);
    expect(canvasDraws(CASES[2]).map((p) => p.text)).toEqual(["0", "20", "40"]); // rows 0, 2, 4 of the 6 drawn
    expect(canvasDraws(CASES[3]).map((p) => p.text)).toEqual(["Fe", "Ni", "Co"]);
  });

  it("an unreadable source draws no per-point text and sends none", () => {
    const gone = { ...CASES[2], view: { yKeys: [0], seriesStyles: { 0: { markerTextFrom: 9 } } } } as Case;
    expect(markerTextRows(gone.ds, gone.view.seriesStyles![0])).toBeNull();
    expect((request(gone).series_styles?.[0] as { marker_texts?: unknown } | null)?.marker_texts).toBeUndefined();
  });

  it("matches the committed wire fixture", () => {
    expect(marks()).not.toBeNull();
    const now = JSON.parse(JSON.stringify(fresh()));
    if (process.env.MARKER_TEXT_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
