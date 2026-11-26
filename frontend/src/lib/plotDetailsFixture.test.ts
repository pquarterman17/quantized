// Plan item 24 (Plot Details residue), screen == export, pinned as a SHARED wire
// fixture (`tests/fixtures/wire/plot_details.json`):
//
//   text symbols    the canvas' rows and strings (`uplotTextSymbols`) and its hidden glyph;
//   error boxes     the rectangles the canvas fills (`uplotErrorBox.boxRects`), in data units;
//   stack totals    the labels and their totals (`uplotStackTotals.stackTotals`);
//   equal aspect    the limits `equalAspectRange` yields: one X unit as long as one Y unit.
//
// The backend half (`tests/test_export_plot_details.py`) posts each request and
// asserts matplotlib draws the same texts, boxes, labels and aspect.
//
// Regenerate only after a DELIBERATE rule change:
//   PLOT_DETAILS_FIXTURE_WRITE=1 npx vitest run src/lib/plotDetailsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { axisFmtParam } from "./axisFormat";
import { equalAspectRange } from "./axisEqualAspect";
import { buildErrorSpans } from "./errorbars";
import type { ErrorBinding } from "./errorRoles";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { marks, loadMarks } from "./marksLoader";
import { buildColumns, composeDisplayPayload, effectiveChannels, type PlotPayload } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { boxRects } from "./uplotErrorBox";
import { stackedBelow } from "./uplotStack";
import { stackTotals } from "./uplotStackTotals";
import { buildSeriesDefs } from "./uplotSeries";
import { textSymbolRows } from "./uplotTextSymbols";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "plot_details.json",
);
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: true };

function dataset(time: number[], cols: number[][], labels: string[]): Dataset {
  return {
    id: "d1",
    name: "item 24",
    data: { time, values: time.map((_, r) => cols.map((c) => c[r])), labels, units: labels.map(() => "u"), metadata: {} },
  };
}

type Kind = "text" | "box" | "stack" | "equal";
interface Case {
  name: string;
  kind: Kind;
  ds: Dataset;
  view: Partial<PlotView>;
  errors?: ErrorBinding[];
  /** equal aspect: the plot's pixel size and the limits before it applies. */
  plot?: { w: number; h: number; x: [number, number]; y: [number, number] };
}

const T = [0, 1, 2, 3, 4, 5, 6, 7];
const CASES: Case[] = [
  {
    name: "a 2-letter symbol on every 2nd drawn point over a gap",
    kind: "text",
    ds: dataset(T, [[1, 2, NaN, 4, 5, 6, 7, 8]], ["S"]),
    view: { seriesStyles: { 0: { markerText: "Fe", markerTextSize: 12, markerEvery: 2, color: "#3366cc" } } },
  },
  {
    name: "a default-size one-character symbol, no marker flag",
    kind: "text",
    ds: dataset([0, 1, 2], [[3, 1, 2]], ["S"]),
    view: { seriesStyles: { 0: { markerText: "A", color: "#aa3377" } } },
  },
  {
    name: "X and Y errors drawn as boxes, asymmetric Y, a point with no Y error",
    kind: "box",
    ds: dataset([1, 2, 3, 4], [[2, 3, 5, 4], [0.5, 0.25, NaN, 0.5], [0.1, 0.2, 0.3, 0.4]], ["M", "dM", "dH"]),
    view: { yKeys: [0], seriesStyles: { 0: { color: "#228833", errorBar: { box: true } } } },
    errors: [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target: -1, axis: "x", side: "both" },
    ],
  },
  {
    name: "a total label on the top of a two-series stack, one negative row",
    kind: "stack",
    ds: dataset([1, 2, 3, 4], [[1, 2, -3, 4.5], [2, 1.25, 1, NaN]], ["A", "B"]),
    view: { seriesStyles: { 0: { bars: true, stack: true }, 1: { bars: true, stack: true, stackTotal: true } } },
  },
  {
    name: "equal aspect widens Y on a wide plot",
    kind: "equal",
    ds: dataset([0, 10], [[0, 5]], ["Y"]),
    view: { yFmt: { mode: "auto", digits: 3, equal: true } },
    plot: { w: 400, h: 300, x: [0, 10], y: [0, 5] },
  },
  {
    name: "equal aspect widens X on a flat plot",
    kind: "equal",
    ds: dataset([0, 10], [[0, 5]], ["Y"]),
    view: { yFmt: { mode: "auto", digits: 3, equal: true } },
    plot: { w: 500, h: 100, x: [0, 10], y: [0, 5] },
  },
];

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

beforeAll(async () => {
  await loadMarks();
});

function canvas(c: Case) {
  const view = viewOf(c);
  const channels = effectiveChannels(c.ds.data, view.yKeys, view.xKey, c.ds.channelRoles, view.seriesOrder);
  const payload: PlotPayload = composeDisplayPayload(buildColumns(c.ds.data, null, view.xKey, channels), {
    id: c.ds.id, waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const styleList = payload.series.map((_, i) => view.seriesStyles[channels[i]]);
  const xs = payload.data[0] as number[];
  const ascending = xs.every((x, i) => i === 0 || x >= xs[i - 1]);
  const { series } = buildSeriesDefs(payload, { seriesStyles: styleList }, channels.map(String), ascending, COLORS);
  return { channels, payload, series, styleList };
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c), errors: c.errors });
  return buildFigureSpecFromDocument(doc, c.ds, "item-24", { fmt: "svg" });
}

type Col = readonly (number | null | undefined)[];

function truth(c: Case) {
  const { channels, payload, series, styleList } = canvas(c);
  const xs = payload.data[0] as Col;
  if (c.kind === "text") {
    const st = styleList[0]!;
    const pts = series[1].points ?? {};
    return {
      text: st.markerText, pt: st.markerTextSize ?? 10, glyph_hidden: pts.show === false,
      rows: textSymbolRows(xs, payload.data[1] as Col, st.markerEvery),
    };
  }
  if (c.kind === "box") {
    const spans = buildErrorSpans(c.ds.data, channels, c.errors ?? []).get(1) ?? [];
    return { boxes: boxRects(xs, payload.data[1] as Col, spans.find((s) => s.axis === "x")!, spans.find((s) => s.axis === "y")!) };
  }
  if (c.kind === "stack") {
    const axes = payload.series.map((s) => s.axis);
    const top = styleList.length - 1;
    return { labels: stackTotals(xs, payload.data as unknown as Col[], top + 1, stackedBelow(styleList, axes, top)).map((t) => ({ x: xs[t.row], total: t.total, text: t.text })) };
  }
  const p = c.plot!;
  const r = equalAspectRange(p.x, p.y, p.w, p.h)!;
  return { x_per_px: (r.x[1] - r.x[0]) / p.w, y_per_px: (r.y[1] - r.y[0]) / p.h, plot: p };
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, kind: c.kind, request: request(c), canvas: truth(c) })) });

describe("plot details residue, screen == export (shared wire fixture)", () => {
  it("text symbols: the string, its size and the rows, with the glyph hidden", () => {
    const [a, b] = CASES.slice(0, 2).map(truth) as { text: string; pt: number; glyph_hidden: boolean; rows: number[] }[];
    expect(a).toMatchObject({ text: "Fe", pt: 12, glyph_hidden: true });
    expect(a.rows).toEqual([0, 3, 5, 7]); // drawn rows 0,1,3,4,5,6,7 -> every 2nd
    expect(b).toMatchObject({ text: "A", pt: 10, rows: [0, 1, 2] });
    expect(marks()).not.toBeNull();
    expect(request(CASES[0]).series_styles?.[0]).toMatchObject({ marker_text: "Fe", marker_text_size: 12, marker_every: 2 });
  });

  it("an invalid text symbol sends nothing and draws nothing", () => {
    const bad = { ...CASES[1], view: { seriesStyles: { 0: { markerText: "toolong" } } } } as Case;
    expect(request(bad).series_styles?.[0]?.marker_text).toBeUndefined();
    expect(textSymbolRows([0], [0], 1)).toEqual([0]);
    expect(canvas(bad).series[1].points?.show).toBe(canvas({ ...bad, view: {} }).series[1].points?.show); // as if unset
  });

  it("boxes are one per drawn point in data units; a missing side is a zero-width side", () => {
    const { boxes } = truth(CASES[2]) as { boxes: number[][] };
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toEqual([0.9, 1.5, 1.1, 2.5]);
    expect(boxes[2]).toEqual([2.7, 5, 3.3, 5]); // no Y error on row 2: a flat box
    expect(request(CASES[2]).series_styles?.[0]).toMatchObject({ error_box: true });
  });

  it("the stack total is the running sum, signed, 6 significant figures", () => {
    const { labels } = truth(CASES[3]) as { labels: { total: number; text: string }[] };
    expect(labels.map((l) => l.text)).toEqual(["3", "3.25", "-2"]) // row 3: the top series has no value;
    expect(request(CASES[3]).series_styles?.[1]).toMatchObject({ stack: true, stack_total: true });
    expect(request(CASES[3]).series_styles?.[0]?.stack_total).toBeUndefined();
  });

  it("equal aspect makes the data-per-pixel of both axes agree and sends y_fmt.equal", () => {
    for (const c of CASES.slice(4)) {
      const t = truth(c) as { x_per_px: number; y_per_px: number };
      expect(t.x_per_px).toBeCloseTo(t.y_per_px, 12);
      expect(axisFmtParam(viewOf(c).yFmt)).toMatchObject({ equal: true });
      expect((request(c) as { y_fmt?: { equal?: boolean } }).y_fmt?.equal).toBe(true);
    }
    expect(equalAspectRange([0, 10], [0, 7.5], 400, 300)).toBeNull(); // already equal
    expect(equalAspectRange([0, 0], [0, 1], 400, 300)).toBeNull(); // no span
  });

  it("matches the committed wire fixture", () => {
    const now = JSON.parse(JSON.stringify(fresh()));
    if (process.env.PLOT_DETAILS_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    const saved = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(now).toEqual(saved);
  });
});
