import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceCsv,
  acceptanceDashboardHtml,
  approxEq,
  buildAcceptanceRows,
  compareFigureToState,
  fitNormalizedLayoutRects,
  normalizedRectsMatch,
  screenshotReview,
  summarizeCorpusReports,
  summarizeAcceptanceRows,
  summarizeFigureFamily,
  summarizeRuntimeErrors,
} from "./origin_acceptance.mjs";

test("family summary preserves decoded curve order and reports worst fidelity", () => {
  const family = [
    { figure: {
      curves: [{ book: "BookB", x: "A", y: "B", style: "line" }],
      fidelity: { status: "exact", recovered: ["axes"], omissions: [] },
      saved_preview: { confidence: "exact_page" },
    } },
    { figure: {
      curves: [{ book: "BookA", x: "E", y: "F" }, { book: "BookB", x: "C", y: "D" }],
      fidelity: { status: "best_effort", recovered: ["axes"], omissions: ["connect_mode"] },
    } },
  ];
  assert.deepEqual(summarizeFigureFamily(family), {
    source_books: ["BookB", "BookA"],
    curves: [
      { book: "BookB", x: "A", y: "B", style: "line" },
      { book: "BookA", x: "E", y: "F" },
      { book: "BookB", x: "C", y: "D" },
    ],
    fidelity: { status: "best_effort", recovered: ["axes"], omissions: ["connect_mode"] },
    preview: { available: true, confidence: ["exact_page"] },
  });
});

test("review state is explicit for partial, complete, and mismatched review", () => {
  assert.equal(screenshotReview(null, "Graph1").status, "unreviewed");
  assert.equal(screenshotReview({ figures: { Graph1: { scales: "ok" } } }, "Graph1").status, "partial");
  const complete = Object.fromEntries(["scales", "ticks", "legend", "colours", "markers", "annotations", "panels"].map((key) => [key, "ok"]));
  assert.equal(screenshotReview({ figures: { Graph1: complete } }, "Graph1").status, "reviewed");
  complete.legend = "bad";
  assert.deepEqual(screenshotReview({ figures: { Graph1: complete } }, "Graph1").mismatch_checks, ["legend"]);
});

test("runtime errors are deduplicated, ordered, and bounded", () => {
  const first = new Error("uPlot failed");
  assert.deepEqual(summarizeRuntimeErrors([
    first,
    "plain failure",
    first,
  ], 1), {
    count: 2,
    errors: [first.stack],
    truncated: true,
  });
});

test("normalized frame comparison tolerates pixel rounding but rejects flattening", () => {
  const expected = [
    { left: 0, top: 0, width: 0.48, height: 0.45 },
    { left: 0.52, top: 0, width: 0.48, height: 0.45 },
    { left: 0, top: 0.55, width: 1, height: 0.45 },
  ];
  const rounded = expected.map((rect) => Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [key, value + 0.001]),
  ));
  assert.equal(normalizedRectsMatch(expected, rounded), true);
  const flattened = expected.map((_, index) => ({
    left: (index % 2) * 0.5, top: Math.floor(index / 2) * 0.5, width: 0.5, height: 0.5,
  }));
  assert.equal(normalizedRectsMatch(expected, flattened), false);
  assert.equal(normalizedRectsMatch(expected, expected.slice(1)), false);
});

test("layout frames are independently transformed through host letterboxing", () => {
  assert.deepEqual(fitNormalizedLayoutRects([
    { left: 0.1, top: 0.2, width: 0.8, height: 0.6 },
  ], 2, 1000, 800), [
    { left: 0.1, top: 0.3125, width: 0.8, height: 0.375 },
  ]);
  assert.deepEqual(fitNormalizedLayoutRects([
    { left: 0, top: 0, width: 1, height: 1 },
  ], 0.5, 1000, 500), [
    { left: 0.375, top: 0, width: 0.25, height: 1 },
  ]);
});

test("acceptance rows retain unpaired graphs and structural failures", () => {
  const rows = buildAcceptanceRows(
    "Moke",
    { graphs: { Graph1: { status: "ok", file: "Graph1.png" }, OriginOnly: { status: "ok", file: "only.png" } } },
    { figures: { Graph1: { resolved: true, file: "quantized/Graph1.png", source_books: ["Book2"], curves: [{ book: "Book2", x: "A", y: "B" }], layers: 1, mode: "single", fidelity: { status: "best_effort", omissions: ["dash"] }, preview: { available: false, confidence: [] } } } },
    { figures: [{ name: "Graph1", pass: false, checks: [{ name: "x_range", pass: true }, { name: "y_range", pass: false }] }] },
    null,
  );
  assert.deepEqual(rows.map((row) => row.graph), ["Graph1", "OriginOnly"]);
  assert.equal(rows[0].paired_screenshots, true);
  assert.deepEqual(rows[0].structural_failures, ["y_range"]);
  assert.equal(rows[0].runtime_error_count, 0);
  assert.equal(rows[1].quantized_render_status, "missing");
  assert.match(acceptanceCsv(rows), /"\[""Book2""\]"/);
});

test("corpus summary separates unresolved graphs from strict renderer failures", () => {
  const summary = summarizeCorpusReports([
    { project: "Moke", report: { figures: [
      { name: "Graph1", resolved: true, pass: true, checks: [] },
      { name: "Internal", resolved: false, pass: false, checks: [] },
    ] } },
    { project: "PNR", report: { figures: [
      { name: "Graph40", resolved: true, pass: false, checks: [
        { name: "decoded_frame_geometry", pass: false },
        { name: "painted_canvases", pass: true },
      ] },
    ] } },
  ]);
  assert.deepEqual(summary.totals, {
    projects: 2, graphs: 3, resolved: 2, unresolved: 1, renderer_failures: 1, process_failures: 0,
  });
  assert.equal(summary.projects[0].strict_pass, true);
  assert.deepEqual(summary.projects[1].failures, [
    { graph: "Graph40", checks: ["decoded_frame_geometry"] },
  ]);
  assert.equal(summary.strict_pass, false);
});

test("acceptance evidence ledger ranks omissions deterministically", () => {
  const rows = [
    { project: "B", fidelity_status: "best_effort", fidelity_omissions: ["ticks", "graphics"], layout_mode: "single", structural_failures: [], quantized_render_status: "rendered", runtime_error_count: 0, screenshot_review_status: "unreviewed", paired_screenshots: true, structural_pass: true },
    { project: "A", fidelity_status: "best_effort", fidelity_omissions: ["graphics"], layout_mode: "multiPanel", structural_failures: ["canvas"], quantized_render_status: "rendered", runtime_error_count: 1, screenshot_review_status: "mismatch", paired_screenshots: false, structural_pass: false },
    { project: "A", fidelity_status: "unreported", fidelity_omissions: [], layout_mode: null, structural_failures: [], quantized_render_status: "unresolved", runtime_error_count: 0, screenshot_review_status: "unreviewed", paired_screenshots: false, structural_pass: false },
  ];
  const totals = summarizeAcceptanceRows(rows);
  assert.equal(totals.projects, 2);
  assert.equal(totals.runtime_error_graphs, 1);
  assert.equal(totals.unresolved_graphs, 1);
  assert.equal(totals.structural_mismatches, 1);
  assert.deepEqual(totals.rankings.fidelity_omissions, [
    { value: "graphics", count: 2 },
    { value: "ticks", count: 1 },
  ]);
  assert.deepEqual(totals.rankings.unresolved_projects, [{ value: "A", count: 1 }]);
});

test("review dashboard escapes labels and links directly to paired graph anchors", () => {
  const rows = [{
    project: "Moke & Co", graph: "Graph <1>", paired_screenshots: true,
    screenshot_review_status: "unreviewed", quantized_render_status: "rendered", layout_mode: "single",
  }];
  const html = acceptanceDashboardHtml(rows, {
    graphs: 1, paired_screenshots: 1, visually_reviewed: 0, unresolved_graphs: 0,
  });
  assert.match(html, /Moke &amp; Co/);
  assert.match(html, /Graph &lt;1&gt;/);
  assert.match(html, /Moke%20%26%20Co\/gallery\.html#fig-Graph%20%3C1%3E/);
  assert.doesNotMatch(html, /Graph <1>/);
});

// ---- compareFigureToState (structural-report regression, 2026-08-21) -----
//
// A RockingCurve.opju Graph3-shaped family: 3 layers, no decoded frame
// geometry (ordinal stack), one layer log-scale on Y with a decoded tick
// step -- every family member resolves a dataset + channel selection, so
// the real `applyOriginFigure` takes the spatial multi-panel branch and
// writes each layer's own decoded range/log/step onto ITS OWN panel (see
// `frontend/src/store/useApp.test.ts`'s matching store-level test). The
// panel shape below is exactly what the harness-exposed `spatialPanelsOf`
// accessor returns for that apply.
const rockingCurveFamily = [
  { id: "fig-nb", figure: { name: "Graph3", layer: 1, x_from: 0, x_to: 10, x_log: false, y_from: 1, y_to: 100, y_log: true, x_step: 2, y_step: 1 } },
  { id: "fig-nbal", figure: { name: "Graph3", layer: 2, x_from: 0, x_to: 10, x_log: false, y_from: 0, y_to: 50, y_log: false, x_step: 5, y_step: 10 } },
  { id: "fig-nbau", figure: { name: "Graph3", layer: 3, x_from: 0, x_to: 10, x_log: false, y_from: 0, y_to: 30, y_log: false, x_step: null, y_step: null } },
];
const rockingCurvePanels = rockingCurveFamily.map((entry) => ({
  sourceFigureIds: [entry.id],
  xLim: [entry.figure.x_from, entry.figure.x_to],
  yLim: [entry.figure.y_from, entry.figure.y_to],
  xLog: entry.figure.x_log,
  yLog: entry.figure.y_log,
  xStep: entry.figure.x_step,
  yStep: entry.figure.y_step,
}));

test("compareFigureToState: a resolved ordinal multi-panel apply (RockingCurve Graph3 shape) classifies as multiPanel and every per-panel range/log/step check passes", () => {
  const applied = {
    stackMode: true,
    spatialPanels: rockingCurvePanels, // real shape: spatialPanelsOf(state.composition)
    canvasCount: 3,
  };
  const { mode, checks } = compareFigureToState(rockingCurveFamily, rockingCurveFamily[0], applied);
  assert.equal(mode, "multiPanel");
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  assert.deepEqual(failed, []);
  assert.ok(checks.some((c) => c.name === "panel_0_ylog" && c.pass));
});

// The exact regression (root cause): `origin_figures.mjs` used to build
// `applied.spatialPanels` from a raw `state.spatialPanels` store field that
// no longer exists (collapsed into `composition` by commit 5cdc7303,
// 2026-07-19 -- see frontend/src/store/useApp.ts's `composition` field doc
// and frontend/src/lib/composition.ts). Reading that missing field off the
// live store yields `undefined`, so `applied.spatialPanels` here reproduces
// exactly what every REAL multi-panel apply looked like to the structural
// report before the fix -- not a hypothetical.
test("compareFigureToState: a stale/missing spatialPanels field (the pre-fix regression) misclassifies the SAME multi-panel apply as single and fails range/step/log against the wrong record", () => {
  const applied = {
    stackMode: true, // the app DID take the spatial branch and set this
    spatialPanels: undefined, // `state.spatialPanels` -- does not exist post-#54
    canvasCount: 3,
    // Top-level singleton axis fields the spatial branch never writes to
    // (real per-panel state lives on composition.panels, not here) --
    // whatever they were left at by a prior apply/the initial store state.
    xLim: null,
    yLim: null,
    xLog: false,
    yLog: false,
    xStep: null,
    yStep: null,
  };
  const { mode, checks } = compareFigureToState(rockingCurveFamily, rockingCurveFamily[0], applied);
  assert.equal(mode, "single"); // misclassified -- a real 3-panel apply read back as single
  const byName = Object.fromEntries(checks.map((c) => [c.name, c.pass]));
  // x/y range + step always fail: compared against layer 1's OWN decoded
  // figure while `applied.xLim`/`yLim`/`xStep`/`yStep` sit at the untouched
  // default -- exactly the reported symptom pattern.
  assert.deepEqual(
    { x_range: byName.x_range, y_range: byName.y_range, x_step: byName.x_step, y_step: byName.y_step },
    { x_range: false, y_range: false, x_step: false, y_step: false },
  );
  // y_log fails ONLY because layer 1 (the representative) is genuinely
  // log-scale (y_log: true) while the stale top-level default reads false --
  // the exact "y_log fails iff the true axis was log-scale" pattern in the
  // bug report. x_log passes here by coincidence (both linear).
  assert.equal(byName.x_log, true);
  assert.equal(byName.y_log, false);
});

test("approxEq treats null/undefined/NaN as exact, not numeric-tolerant", () => {
  assert.equal(approxEq(null, null), true);
  assert.equal(approxEq(null, 0), false);
  assert.equal(approxEq(undefined, undefined), true);
  assert.equal(approxEq(NaN, NaN), true);
  assert.equal(approxEq(1.0000001, 1.0000002), true);
  assert.equal(approxEq(1, 2), false);
});
