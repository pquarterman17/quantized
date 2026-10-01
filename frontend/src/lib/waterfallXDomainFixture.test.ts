// Waterfall X offset — the X AUTOSCALE, screen == export, pinned as a SHARED
// wire fixture (`tests/fixtures/wire/waterfall_x_domain.json`).
//
// An X-offset waterfall slides series s by s·dx, so an auto-scaled X axis must
// cover every DRAWN series at its own shifted x: from the smallest to the
// largest x at which a visible series has a point. Not the whole x column — a
// hidden series keeps its block (and its slot) in the canvas payload but is
// neither drawn nor on the wire, and an excluded row keeps its x but draws
// nothing. An explicit x limit wins over all of it.
//
// Each case below hand-states that domain; the canvas half asserts uPlot's x
// range is exactly that domain padded by the canvas' rule
// (`uplotXRange.padXDomain`), and the backend half
// (`tests/test_export_waterfall_x.py`) asserts matplotlib's autoscaled xlim is
// exactly the same domain padded by ITS margin rule. The renderers pad
// differently (2% vs matplotlib's margins), as for every plot; the covered
// domain is what must agree.
//
// LOG X. The Y waterfall is the precedent: its step is additive, in data units,
// a fraction of the LINEAR span, whatever the axis scale (`applyWaterfall`
// never consults `yScale`); it can never push a point non-positive only because
// its step is positive (`waterfallApplies`). The X step may be negative
// (Origin's slides left), so on a log X axis a shifted point can land at or
// below 0. Neither renderer can place it: uPlot's log scale and matplotlib's
// both drop it, and the autoscale covers the positive drawn points only — the
// rule `fullYExtents` already applies to a log Y. The "log" case pins that.
//
// Regenerate only after a DELIBERATE rule change:
//   WATERFALL_X_FIXTURE_WRITE=1 npx vitest run src/lib/waterfallXDomainFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { resolveCanvasLims } from "./canvasLims";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { droppedRows } from "./rowstate";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import { padXDomain } from "./uplotXRange";
import { expandWaterfallX } from "./waterfallX";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "waterfall_x_domain.json",
);

function dataset(excludedRows: number[]): Dataset {
  return {
    id: "d1",
    name: "spectra",
    data: {
      time: [10, 12, 14, 16, 18], // x-span 8
      values: [
        [1, 5, 2],
        [3, 6, 4],
        [2, 9, 8],
        [4, 7, 5],
        [6, 8, 3],
      ],
      labels: ["S1", "S2", "S3"],
      units: ["a.u.", "a.u.", "a.u."],
      metadata: {},
    },
    excludedRows,
  };
}

interface Case {
  name: string;
  view: Partial<PlotView>;
  excludedRows: number[];
  /** The x data domain the autoscale must cover (null: an explicit limit). */
  xDomain: [number, number] | null;
}

const CASES: Case[] = [
  {
    // step 0.25·8 = 2. Drawn: S1 10..16 (row 4 excluded), S2 12..18. The hidden
    // S3 block (14..22) and the excluded rows' x are in the canvas x column.
    name: "hidden last series + excluded last row",
    view: { yKeys: [0, 1, 2], hiddenChannels: [2], waterfallDx: 0.25 },
    excludedRows: [4],
    xDomain: [10, 18],
  },
  {
    // step 1.25·8 = 10: the blocks are ascending (10..18, 20..28, 30..38), so
    // uPlot would read the [first, last] endpoints — the hidden S3's 38.
    name: "step past the span (ascending blocks), hidden last series",
    view: { yKeys: [0, 1, 2], hiddenChannels: [2], waterfallDx: 1.25 },
    excludedRows: [],
    xDomain: [10, 28],
  },
  {
    // step -0.5·8 = -4: S1 10..18, S2 6..14, S3 2..10.
    name: "negative step slides left",
    view: { yKeys: [0, 1, 2], waterfallDx: -0.5 },
    excludedRows: [],
    xDomain: [2, 18],
  },
  {
    // step -1.5·8 = -12: S1 10..18, S2 -2..6 (only 2, 4, 6 drawable), S3
    // -14..-6 (none). Log X covers the positive drawn points only.
    name: "log X, negative step crossing zero",
    view: { yKeys: [0, 1, 2], waterfallDx: -1.5, xScale: "log" },
    excludedRows: [],
    xDomain: [2, 18],
  },
  {
    name: "explicit x limits win",
    view: { yKeys: [0, 1, 2], waterfallDx: 0.25, xLim: [11, 15] },
    excludedRows: [],
    xDomain: null,
  },
];

function viewOf(c: Case): PlotView {
  return { ...defaultPlotView(), ...c.view };
}

/** The canvas' x scale range for `c`: the payload `Stage/usePlotPayload` draws
 *  (compose, then the X-offset layout) through `buildOpts`, with the hidden
 *  flags it passes. */
function canvasXRange(c: Case): unknown {
  const ds = dataset(c.excludedRows);
  const view = viewOf(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const composed = composeDisplayPayload(buildColumns(ds.data, null, view.xKey, channels), {
    id: ds.id, waterfall: view.waterfall, dropped: droppedRows(ds), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const none = new Map();
  const shown = expandWaterfallX(composed, channels.length, view.waterfallDx, {
    errorBars: none, errorSpans: none, colorByColumns: none,
  }).displayPayload;
  const hidden = shown.series.map((_, i) => i < channels.length && view.hiddenChannels.includes(channels[i]));
  const opts = buildOpts(shown, {
    width: 600, height: 400, xScale: view.xScale, yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    hidden, xLim: resolveCanvasLims(shown, { xLim: view.xLim, xScale: view.xScale, yScale: "linear", hidden }).x.range,
  });
  const range = (opts.scales?.x as { range?: unknown }).range;
  return typeof range === "function" ? (range as () => unknown)() : range;
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "Waterfall", datasetId: "d1", view: viewOf(c) });
  return buildFigureSpecFromDocument(doc, dataset(c.excludedRows), "waterfall", { fmt: "svg" });
}

function fresh() {
  return {
    cases: CASES.map((c) => ({
      name: c.name,
      request: request(c),
      x_domain: c.xDomain,
      x_lim: c.view.xLim ?? null,
    })),
  };
}

describe("waterfall X offset — the X autoscale covers every drawn series", () => {
  it.each(CASES)("canvas: $name", (c) => {
    const want = c.xDomain ? padXDomain(c.xDomain, c.view.xScale === "log") : c.view.xLim;
    expect(canvasXRange(c)).toEqual(want);
  });

  it("the requests carry the X step (so the export has something to cover)", () => {
    for (const c of CASES) expect(request(c).waterfall_x_offsets?.length).toBeGreaterThan(0);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.WATERFALL_X_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
