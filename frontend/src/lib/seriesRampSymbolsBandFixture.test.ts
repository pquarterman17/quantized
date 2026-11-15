// Origin gap audit 4, screen == export for the three lane-A styles, pinned as a
// SHARED wire fixture (`tests/fixtures/wire/series_ramp_symbols_band.json`):
//
//   G1  a colour gradient across N curves: the canvas' strokes, resolved by the
//       real canvas hook (`Stage/useSeriesRamp.useRampedStyles`) and the real
//       series builder, are the colours the export request carries;
//   G10 symbol edge / fill / fill opacity and "symbol every N points": the
//       canvas' points config and the rows its skip filter keeps;
//   G8  the Y error drawn as a band: the quads the canvas fills, in data units,
//       in ROW ORDER on a hysteresis loop and a descending sweep.
//
// The backend half (`tests/test_export_series_ramp_symbols_band.py`) posts each
// request and asserts matplotlib draws the same colours, the same marker rows,
// the same face / edge, and the same band vertices.
//
// Regenerate only after a DELIBERATE rule change:
//   RAMP_SYMBOLS_FIXTURE_WRITE=1 npx vitest run src/lib/seriesRampSymbolsBandFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { useRampedStyles } from "../components/Stage/useSeriesRamp";
import { resolveDrawColor } from "./contrastColor";
import { buildErrorSpans } from "./errorbars";
import type { ErrorBinding } from "./errorRoles";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels, type PlotPayload } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { loadMarks } from "./marksLoader";
import type { Dataset, SeriesStyle } from "./types";
import { bandQuads } from "./uplotErrorBand";
import { buildSeriesDefs } from "./uplotSeries";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "series_ramp_symbols_band.json",
);
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: true };

function dataset(time: number[], cols: number[][], labels: string[]): Dataset {
  return {
    id: "d1",
    name: "lane A",
    data: { time, values: time.map((_, r) => cols.map((c) => c[r])), labels, units: labels.map(() => "emu"), metadata: {} },
  };
}

interface Case {
  name: string;
  ds: Dataset;
  view: Partial<PlotView>;
  errors?: ErrorBinding[];
}

const T = [0, 1, 2, 3, 4, 5];
const TEMPS = [300, 2, 150, 10, 250, 5, 50, 200, 20, 100, 30, 75]; // 12 curves, shuffled on purpose
const curves = TEMPS.map((_, k) => T.map((t) => k + t * 0.1));
// A hysteresis loop (H up then back down) and a descending sweep, with a gap.
const LOOP_H = [-2, -1, 0, 1, 2, 1, 0, -1, -2];
const LOOP_M = [-1, -0.9, -0.2, 0.8, 1, 0.9, 0.2, -0.8, -1];
const LOOP_E = [0.1, 0.2, 0.3, 0.2, 0.1, 0.2, 0.3, 0.2, 0.1];

const CASES: Case[] = [
  {
    name: "a gradient over 12 curves, plotted order, one hidden",
    ds: dataset(T, curves, TEMPS.map((t) => `M ${t} K`)),
    view: { seriesRamp: { map: "viridis" }, hiddenChannels: [3] },
  },
  {
    name: "a reversed gradient ordered by the temperature in each legend; an own colour is kept",
    ds: dataset(T, curves, TEMPS.map((t) => `M ${t} K`)),
    view: { seriesRamp: { map: "coolwarm", reverse: true, order: "value" }, seriesStyles: { 4: { color: "#cc3311" } } },
  },
  {
    name: "symbol edge, fill, opacity and every 3rd point over a gap",
    ds: dataset([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [[1, 2, NaN, 4, 5, 6, 7, 8, 9, 10]], ["S"]),
    view: {
      seriesStyles: {
        0: { marker: true, markerShape: "square", markerEdge: "#2255aa", markerFillColor: "#dd8800", markerAlpha: 0.4, markerEvery: 3 },
      },
    },
  },
  {
    name: "every 2nd symbol on a hysteresis loop, row order",
    ds: dataset(LOOP_H, [LOOP_M], ["M"]),
    view: { seriesStyles: { 0: { marker: true, markerEvery: 2, color: "#3366cc" } } },
  },
  {
    name: "a Y error band on a hysteresis loop follows row order",
    ds: dataset(LOOP_H, [LOOP_M, LOOP_E], ["M", "dM"]),
    view: { yKeys: [0], seriesStyles: { 0: { color: "#aa3377", errorBar: { band: true } } } },
    errors: [{ channel: 1, target: 0, axis: "y", side: "both" }],
  },
  {
    name: "a Y error band on a descending sweep keeps its X bars",
    ds: dataset([5, 4, 3, 2, 1], [[1, 2, 4, 3, 5], [0.5, 0.4, 0.3, 0.2, 0.1], [0.2, 0.2, 0.2, 0.2, 0.2]], ["R", "dR", "dT"]),
    view: { yKeys: [0], seriesStyles: { 0: { color: "#228833", errorBar: { band: true, color: "#ee6677" } } } },
    errors: [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 2, target: -1, axis: "x", side: "both" }],
  },
];

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

beforeAll(async () => {
  await loadMarks(); // the marks chunk: the ramp resolver, the symbol details, the band
});

/** What the canvas draws: the ramped styles from the canvas hook, the
 *  composed payload, the series defs `buildOpts` builds. */
function canvas(c: Case) {
  const view = viewOf(c);
  const { result } = renderHook(() => useRampedStyles(view, c.ds, undefined));
  const styles: Record<number, SeriesStyle> = result.current;
  const channels = effectiveChannels(c.ds.data, view.yKeys, view.xKey, c.ds.channelRoles, view.seriesOrder);
  const payload: PlotPayload = composeDisplayPayload(buildColumns(c.ds.data, null, view.xKey, channels), {
    id: c.ds.id, waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const styleList = payload.series.map((_, i) => styles[channels[i]]);
  const xs = payload.data[0] as number[];
  const ascending = xs.every((x, i) => i === 0 || x >= xs[i - 1]);
  const { series } = buildSeriesDefs(payload, { seriesStyles: styleList }, channels.map(String), ascending, COLORS);
  const spans = buildErrorSpans(c.ds.data, channels, c.errors ?? []);
  return { channels, payload, series, spans, styles };
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c), errors: c.errors });
  return buildFigureSpecFromDocument(doc, c.ds, "lane-a", { fmt: "svg" });
}

/** The canvas truth the backend must reproduce, per PLOTTED (non-hidden) series. */
function truth(c: Case) {
  const { channels, payload, series, spans } = canvas(c);
  const view = viewOf(c);
  const shown = channels.map((ch, i) => ({ ch, i })).filter(({ ch }) => !view.hiddenChannels.includes(ch));
  return shown.map(({ i }) => {
    const def = series[i + 1];
    const pts = def.points ?? {};
    const filter = pts.filter as ((u: unknown, s: number) => number[] | null) | undefined;
    const y = spans.get(i + 1)?.find((s) => s.axis === "y");
    return {
      color: def.stroke as string,
      marker_rows: filter ? filter({ data: payload.data }, i + 1) : null,
      marker_edge: pts.stroke ?? null,
      marker_fill: pts.fill ?? null,
      band: (def as { qzErr?: { band?: boolean } }).qzErr?.band
        ? bandQuads(payload.data[0] as number[], payload.data[i + 1] as (number | null)[], y?.plus ?? [], y?.minus ?? [])
        : null,
    };
  });
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, request: request(c), canvas: truth(c) })) });

describe("lane A styles, screen == export (shared wire fixture)", () => {
  it("12 gradient curves are 12 distinct colours, legible on both canvases, and the export carries them", () => {
    for (const c of CASES.slice(0, 2)) {
      const t = truth(c);
      const sent = (request(c).series_styles ?? []).map((s) => s?.color);
      expect(sent).toEqual(t.map((s) => s.color));
      expect(new Set(sent).size).toBe(sent.length);
      for (const hex of sent) {
        expect(resolveDrawColor(hex!, true)).toBe(hex);
        expect(resolveDrawColor(hex!, false)).toBe(hex);
      }
    }
  });

  it("the gradient runs first to last, hidden curves keep their slot, an own colour wins", () => {
    const [a, b] = CASES.map(truth);
    expect(a).toHaveLength(11); // one hidden
    const all = canvas(CASES[0]);
    expect(all.series[1].stroke).toBe("#8804a5"); // viridis' start, lifted for the dark canvas
    expect(b.map((s) => s.color)).toContain("#cc3311");
    // Reversed and by value: the coldest curve (2 K, channel 1) takes the map's END (warm red).
    const cold = canvas(CASES[1]).series[2].stroke as string;
    expect(parseInt(cold.slice(1, 3), 16)).toBeGreaterThan(parseInt(cold.slice(5, 7), 16));
  });

  it("symbol details: edge, translucent fill, every Nth drawn point in row order", () => {
    const [sym] = truth(CASES[2]);
    expect(sym.marker_edge).toBe("#2255aa");
    expect(sym.marker_fill).toBe("color-mix(in oklab, #dd8800 40%, transparent)");
    expect(sym.marker_rows).toEqual([0, 4, 7]); // drawn rows 0,1,3,4,5,6,7,8,9 -> every 3rd
    expect(truth(CASES[3])[0].marker_rows).toEqual([0, 2, 4, 6, 8]);
    expect(request(CASES[2]).series_styles?.[0]).toMatchObject({
      marker_edge: "#2255aa", marker_face: "#dd8800", marker_alpha: 0.4, marker_every: 3,
    });
  });

  it("the band is one quad per segment in row order, never sorted", () => {
    const [loop] = truth(CASES[4]);
    expect(loop.band).toHaveLength(LOOP_H.length - 1);
    // the return branch (rows 5 -> 6: H 1 -> 0) is its own quad, built from its lower-X end
    [0, 0.5, 1, 1.1, 0.7, -0.1].forEach((v, k) => expect(loop.band![5][k]).toBeCloseTo(v, 12));
    expect(request(CASES[4]).series_styles?.[0]).toMatchObject({ error_band: true });
    const [desc] = truth(CASES[5]);
    expect(desc.band).toHaveLength(4);
    expect(request(CASES[5]).series_styles?.[0]).toMatchObject({ error_band: true, error_color: "#ee6677" });
  });

  it("matches the committed wire fixture", () => {
    const want = fresh();
    if (process.env.RAMP_SYMBOLS_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(want, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, "utf-8"))).toEqual(JSON.parse(JSON.stringify(want)));
  });
});
