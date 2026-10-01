// Waterfall X offset — screen == export, pinned as a SHARED wire fixture.
//
// The canvas (`plotdata.composeDisplayPayload` then `waterfallX.
// expandWaterfallX`, the order `Stage/usePlotPayload` runs them) and the
// export request (`figureSpec.buildFigureSpecFromDocument`, which resolves
// `waterfall_offsets` + `waterfall_x_offsets` through `waterfallOffset.
// waterfallWire`) are built here from ONE view: Y and X steps both set, a
// hidden middle series (it keeps its slot on screen and drops off the wire's
// `y_keys`, so positions are [0, 2]) and an excluded row (nulled on screen,
// pruned from the wire `dataset`). The points each DRAWN series puts on screen
// are frozen beside the request in `tests/fixtures/wire/waterfall_x_offset.json`;
// the backend half (`tests/test_export_waterfall_x.py`) posts the request to
// the real route and reads every matplotlib line back against them.
//
// Regenerate only after a DELIBERATE rule change:
//   WATERFALL_X_FIXTURE_WRITE=1 npx vitest run src/lib/waterfallXWireFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView } from "./plotview";
import { droppedRows } from "./rowstate";
import type { Dataset } from "./types";
import { expandWaterfallX } from "./waterfallX";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "waterfall_x_offset.json",
);

const DATASET: Dataset = {
  id: "d1",
  name: "spectra",
  data: {
    time: [10, 12, 14, 16, 18],
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
  excludedRows: [3],
};
const VIEW = { ...defaultPlotView(), yKeys: [0, 1, 2], hiddenChannels: [1], waterfall: 0.25, waterfallDx: 0.125 };

interface ScreenSeries { label: string; x: number[]; y: number[] }

/** What each DRAWN series puts on the canvas: its finite (x, y) points. */
function screen(): ScreenSeries[] {
  const channels = effectiveChannels(DATASET.data, VIEW.yKeys, VIEW.xKey, DATASET.channelRoles, VIEW.seriesOrder);
  const base = buildColumns(DATASET.data, null, VIEW.xKey, channels);
  const composed = composeDisplayPayload(base, {
    id: DATASET.id, waterfall: VIEW.waterfall, dropped: droppedRows(DATASET), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const none = new Map();
  const shown = expandWaterfallX(composed, channels.length, VIEW.waterfallDx, {
    errorBars: none, errorSpans: none, colorByColumns: none,
  }).displayPayload;
  const [x, ...ys] = shown.data as unknown as (number | null)[][];
  return channels.flatMap((ch, s) => {
    if (VIEW.hiddenChannels.includes(ch)) return [];
    const pts = x.flatMap((xv, r) => (xv != null && ys[s][r] != null ? [[xv, ys[s][r] as number]] : []));
    return [{ label: shown.series[s].label, x: pts.map((p) => p[0]), y: pts.map((p) => p[1]) }];
  });
}

function request() {
  const doc = createFigureDocument({ id: "w1", name: "Waterfall", datasetId: DATASET.id, view: VIEW });
  return buildFigureSpecFromDocument(doc, DATASET, "waterfall", { fmt: "svg" });
}

describe("waterfall X offset — the shared screen/export wire fixture", () => {
  it("the request carries both resolved halves, aligned to the visible series' slots", () => {
    const req = request();
    expect(req.y_keys).toEqual([0, 2]);
    // x-span 8 (10..18) · 0.125 = 1 per slot; y-span 8 (1..9) · 0.25 = 2 per slot.
    expect(req.waterfall_x_offsets).toEqual([0, 2]);
    expect(req.waterfall_offsets).toEqual([0, 4]);
    expect(req.dataset?.time).toEqual([10, 12, 14, 18]); // the excluded row is pruned
  });

  it("the screen draws each visible series at its own shifted x", () => {
    expect(screen()).toEqual([
      { label: "S1", x: [10, 12, 14, 18], y: [1, 3, 2, 6] },
      { label: "S3", x: [12, 14, 16, 20], y: [6, 8, 12, 7] },
    ]);
  });

  it("matches the committed fixture the backend half reads", () => {
    const fresh = { request: request(), screen: screen() };
    if (process.env.WATERFALL_X_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
