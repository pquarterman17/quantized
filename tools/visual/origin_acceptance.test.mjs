import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceCsv,
  acceptanceDashboardHtml,
  buildAcceptanceRows,
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
