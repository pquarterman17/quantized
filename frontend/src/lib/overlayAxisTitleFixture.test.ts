// Gap audit 6 lane K (B2): a fitted graph's Y title is the SAME on screen and
// in the export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/overlay_axis_title.json`).
//
// The canvas titles its Y axis from the plotted channels alone
// (`sharedAxisTitle.drawnOnAxis` skips overlays and band edges), but the export
// request carried the fit, its band edges, the baseline and the peaks as
// ordinary series, so the backend's auto title read "signal, fit, 95% CI low,
// … (V)". Each case states the title the canvas draws: the canvas half reads it
// out of the real `buildOpts` over the composed display payload; the request
// half asserts the exact request the Stage export sends (now marking its
// overlay series, `analysis_overlays`); the backend half
// (`tests/test_export_overlay_axis_title.py`) asserts matplotlib's Y title.
//
// Regenerate only after a DELIBERATE rule change:
//   OVERLAY_AXIS_TITLE_FIXTURE_WRITE=1 npx vitest run src/lib/overlayAxisTitleFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { BaselineOverlay, Dataset, FitOverlay, PeakOverlay } from "./types";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "overlay_axis_title.json",
);

const DS: Dataset = {
  id: "d1",
  name: "decay.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[10, 9], [6, 5.5], [3.5, 3.1], [2, 1.8]],
    labels: ["signal", "reference"],
    units: ["V", "V"],
    metadata: {},
  },
};
const ON_0 = { yKey: 0, xKey: null };
const FIT: FitOverlay = {
  datasetId: "d1", binding: ON_0, y: [9.9, 6.1, 3.6, 2.1],
  band: [
    { label: "95% CI low", y: [9.5, 5.8, 3.3, 1.8], legend: "95% confidence band" },
    { label: "95% CI high", y: [10.3, 6.4, 3.9, 2.4], legend: "" },
  ],
};
const BASELINE: BaselineOverlay = { datasetId: "d1", binding: ON_0, y: [1, 1, 1, 1] };
const PEAKS: PeakOverlay = { datasetId: "d1", binding: ON_0, y: [10, null, null, null] };

interface Case {
  name: string;
  view: Partial<PlotView>;
  fit: FitOverlay | null;
  baseline: BaselineOverlay | null;
  peaks: PeakOverlay | null;
}

const CASES: Case[] = [
  { name: "one channel, fit with its band", view: { yKeys: [0] }, fit: FIT, baseline: null, peaks: null },
  { name: "one channel, fit, baseline and peaks", view: { yKeys: [0] }, fit: FIT, baseline: BASELINE, peaks: PEAKS },
  { name: "two channels sharing a unit, with a fit", view: { yKeys: [0, 1] }, fit: FIT, baseline: null, peaks: null },
];

/** The Y title the canvas draws: real `buildOpts` over the composed payload. */
function screenTitle(c: Case): string | undefined {
  const view = { ...defaultPlotView(), ...c.view };
  const channels = effectiveChannels(DS.data, view.yKeys, view.xKey, undefined, view.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(DS.data, view.y2Keys, view.xKey, channels), {
    id: "d1", waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: c.fit, baselineOverlay: c.baseline, peakOverlay: c.peaks, derivOverlay: null, selection: null,
  });
  const opts = buildOpts(payload, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "cursor", onReadout: () => {},
    plotted: channels, fontSize: 12,
  });
  const label = opts.axes?.[1]?.label;
  return typeof label === "string" ? label : undefined;
}

/** The request the Stage export sends for the same view and overlays. */
function request(c: Case): FigureSpec {
  const view = { ...defaultPlotView(), ...c.view };
  const document = createFigureDocument({ id: "w1-doc", name: "Fit", datasetId: "d1", view });
  const get = (() => ({
    ...view,
    focusedWindowId: "w1",
    windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false, defaultTrace: "Line", defaultLineWidth: 1.5, excludedDisplay: "hide",
    fitOverlay: c.fit, baselineOverlay: c.baseline, peakOverlay: c.peaks,
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, DS, "decay", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });
}

const built = CASES.map((c) => ({ name: c.name, request: request(c), title: screenTitle(c) }));

describe("overlay axis title: screen == export (shared wire fixture)", () => {
  if (process.env.OVERLAY_AXIS_TITLE_FIXTURE_WRITE) {
    writeFileSync(FIXTURE, `${JSON.stringify({
      about: "Gap audit 6 lane K: a fitted graph's auto Y title on screen (`title`) and the Stage export request (`request`, overlays marked by `analysis_overlays`). Legs: frontend/src/lib/overlayAxisTitleFixture.test.ts and tests/test_export_overlay_axis_title.py.",
      cases: built,
    }, null, 2)}\n`);
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: typeof built };

  it.each(built.map((b, i) => [b.name, i] as const))("%s: the canvas titles the axis from the channels alone", (_name, i) => {
    expect(built[i].title).toBe(fixture.cases[i].title);
    expect(built[i].title).not.toMatch(/fit|CI|baseline|peaks/);
  });

  it.each(built.map((b, i) => [b.name, i] as const))("%s: the export request is the fixture's, overlays marked", (_name, i) => {
    expect(JSON.parse(JSON.stringify(built[i].request))).toEqual(fixture.cases[i].request);
    const req = built[i].request;
    const flags = req.analysis_overlays ?? [];
    expect(flags).toHaveLength(req.y_keys!.length);
    // Exactly the appended columns past the dataset's own are flagged.
    expect(req.y_keys!.map((k) => (k as number) >= DS.data.labels.length)).toEqual(flags);
  });
});
