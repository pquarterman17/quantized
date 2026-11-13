// Waterfall legend order — screen == export, pinned as a SHARED wire fixture.
//
// A waterfall lifts series i by i steps, so the last staggered series is the
// TOP trace. The screen legend lists it first (figures audit #19); the export
// legend used to list handles in draw order, so one figure read "S1, S3, S4"
// in the PDF and "S4, S3, S1" on screen. Both halves are built here from ONE
// view — a hidden middle series (it keeps its stagger slot on screen and
// drops off the wire's `y_keys`) under a Y stagger:
//   * the SCREEN rows: `plotdata.composeDisplayPayload` (the canvas' own
//     composition), then the legend's `waterfallLegendOrder` over the rows the
//     payload says were staggered, minus the hidden row a static/exported
//     legend never lists;
//   * the REQUEST: `figureSpec.buildFigureSpecFromDocument`, whose
//     `waterfall_offsets` the backend reads the same count from
//     (`calc.figure_legend_order.waterfall_legend_rows`).
// Frozen in `tests/fixtures/wire/waterfall_legend.json`; the backend half
// (`tests/test_export_waterfall_legend.py`) posts the request to the real
// route and reads the matplotlib legend back against the screen rows.
//
// Regenerate only after a DELIBERATE rule change:
//   WATERFALL_LEGEND_FIXTURE_WRITE=1 npx vitest run src/lib/waterfallLegendWireFixture.test.ts

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
import { withUnit } from "./uplotOpts";
import { waterfallLegendOrder, waterfallStaggeredRows } from "./waterfallOffset";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "waterfall_legend.json",
);

const DATASET: Dataset = {
  id: "d1",
  name: "spectra",
  data: {
    time: [10, 12, 14, 16, 18],
    values: [
      [1, 5, 2, 3],
      [3, 6, 4, 5],
      [2, 9, 8, 4],
      [4, 7, 5, 6],
      [6, 8, 3, 2],
    ],
    labels: ["S1", "S2", "S3", "S4"],
    units: ["a.u.", "a.u.", "a.u.", "a.u."],
    metadata: {},
  },
};
const STAGGERED = { ...defaultPlotView(), yKeys: [0, 1, 2, 3], hiddenChannels: [1], waterfall: 0.25 };
const PLAIN = { ...STAGGERED, waterfall: 0 };
type View = typeof STAGGERED;

/** The legend rows the screen lists for `view`, top to bottom (hidden rows
 *  left out, as the export — which never receives them — lists none). */
function screenRows(view: View): string[] {
  const channels = effectiveChannels(DATASET.data, view.yKeys, view.xKey, DATASET.channelRoles, view.seriesOrder);
  const base = buildColumns(DATASET.data, null, view.xKey, channels);
  const shown = composeDisplayPayload(base, {
    id: DATASET.id, waterfall: view.waterfall, dropped: droppedRows(DATASET), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  return waterfallLegendOrder(shown.series.length, waterfallStaggeredRows(shown))
    .filter((row) => !view.hiddenChannels.includes(channels[row]))
    .map((row) => withUnit(shown.series[row].label, shown.series[row].unit));
}

function request(view: View) {
  const doc = createFigureDocument({ id: "w1", name: "Waterfall", datasetId: DATASET.id, view });
  return buildFigureSpecFromDocument(doc, DATASET, "waterfall", { fmt: "svg" });
}

describe("waterfall legend order — the shared screen/export wire fixture", () => {
  it("the screen lists the top trace first under a stagger, draw order without one", () => {
    expect(screenRows(STAGGERED)).toEqual(["S4 (a.u.)", "S3 (a.u.)", "S1 (a.u.)"]);
    expect(screenRows(PLAIN)).toEqual(["S1 (a.u.)", "S3 (a.u.)", "S4 (a.u.)"]);
  });

  it("the request carries the resolved offsets the export reads the order from", () => {
    // y-span 8 (1..9) x 0.25 = 2 per slot; the hidden slot 1 is skipped.
    expect(request(STAGGERED).waterfall_offsets).toEqual([0, 4, 6]);
    expect(request(PLAIN).waterfall_offsets).toBeUndefined();
  });

  it("matches the committed fixture the backend half reads", () => {
    const fresh = {
      staggered: { request: request(STAGGERED), legend: screenRows(STAGGERED) },
      plain: { request: request(PLAIN), legend: screenRows(PLAIN) },
    };
    if (process.env.WATERFALL_LEGEND_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
