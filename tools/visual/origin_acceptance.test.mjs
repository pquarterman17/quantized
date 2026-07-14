import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceCsv,
  buildAcceptanceRows,
  fitNormalizedLayoutRects,
  normalizedRectsMatch,
  screenshotReview,
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
