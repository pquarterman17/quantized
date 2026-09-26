// P2.5 review finding 5 — the bounded live preview (lib/transformPreviewCompute.ts):
// a big input's preview computes only a handful of rows, but its WARNINGS
// still reflect the full data, and a small input's preview is byte-for-byte
// what the full compute would give (the parity every existing workshop test
// already assumes).

import { describe, expect, it } from "vitest";

import { computeTransformPreview, PREVIEW_CAP } from "./transformPreviewCompute";
import { computeTransform } from "./transformRun";
import type { DataStruct, Dataset } from "./types";

const big = (n: number, label = "v"): DataStruct => ({
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, (_, i) => [i % 3, i]),
  labels: ["key", label],
  units: ["", ""],
  metadata: {},
});

describe("computeTransformPreview — append/stack/unstack truncate the INPUT (finding 5)", () => {
  it("append: a big input previews on only its first rows, but the warning counts the real total", async () => {
    const primary: Dataset = { id: "p", name: "p.dat", data: big(50_000, "a") };
    const other: Dataset = { id: "o", name: "o.dat", data: big(30_000, "a") };
    const t0 = performance.now();
    const out = await computeTransformPreview({ op: "merge", with: [{ id: "o", name: "o.dat" }] }, primary, [other]);
    expect(performance.now() - t0).toBeLessThan(200); // materializing 80,000 rows would not be this fast
    expect(out.data.time.length).toBeLessThanOrEqual(2 * PREVIEW_CAP);
    expect(out.preview.previewCapped).toBe(true);
    // The row-count warning reads the FULL inputs — never the truncated ones.
    expect(out.preview.inputs).toEqual([{ name: "p.dat", rows: 50_000, cols: 2 }, { name: "o.dat", rows: 30_000, cols: 2 }]);
  });

  it("stack: warnings (unit mismatch) still see every row of the real input", async () => {
    const wide: DataStruct = {
      time: Array.from({ length: 10_000 }, (_, i) => i),
      values: Array.from({ length: 10_000 }, (_, i) => [i, i]),
      labels: ["M", "T"],
      units: ["emu", "K"],
      metadata: {},
    };
    const primary: Dataset = { id: "w", name: "w.dat", data: wide };
    const out = await computeTransformPreview({ op: "stack", channels: [0, 1] }, primary, []);
    expect(out.data.time.length).toBe(PREVIEW_CAP * 2); // 2 channels x the capped rows
    expect(out.preview.warnings.some((x) => x.code === "unit-mismatch")).toBe(true);
    expect(out.preview.previewCapped).toBe(true);
  });

  it("unstack: a small input is under the cap, so the preview is EXACT — no note, identical to the full compute", async () => {
    const long: DataStruct = {
      time: [0, 0, 1, 1],
      values: [[5, 0, 10], [5, 1, 20], [6, 0, 30], [6, 1, 40]],
      labels: ["key", "cat", "val"],
      units: ["", "", "V"],
      metadata: {},
    };
    const primary: Dataset = { id: "l", name: "l.dat", data: long };
    const params = { op: "unstack" as const, key: 0, category: 1, value: 2, aggregate: "mean" as const };
    const full = await computeTransform(params, primary, []);
    const capped = await computeTransformPreview(params, primary, []);
    expect(capped.data).toEqual(full.data);
    expect(capped.preview.summary).toBe(full.preview.summary);
    expect(capped.preview.previewCapped).toBeUndefined();
  });
});

describe("computeTransformPreview — join caps the OUTPUT via joinWorksheets's own limit", () => {
  it("a big join previews only PREVIEW_CAP rows, but duplicate/unmatched warnings count every row", async () => {
    const n = 20_000;
    const primary: Dataset = { id: "l", name: "l.dat", data: big(n, "a") }; // key = i % 3 (many duplicates)
    const other: Dataset = { id: "r", name: "r.dat", data: big(n, "b") };
    const params = { op: "join" as const, leftKey: 0, rightKey: 0, mode: "inner" as const, keyMode: "text" as const, with: { id: "r", name: "r.dat" } };
    const out = await computeTransformPreview(params, primary, [other]);
    expect(out.data.time.length).toBeLessThanOrEqual(PREVIEW_CAP);
    // key = i % 3 -> only 3 distinct keys, so this join is NOT actually
    // truncated (its real output is <= 3 rows) — proves the cap only bites
    // when the real result is bigger than it, never claims truncation it
    // didn't do.
    expect(out.preview.previewCapped).toBeUndefined();
    expect(out.preview.warnings.some((x) => x.code === "duplicate-keys")).toBe(true);
  });

  it("a join whose real output exceeds the cap gets the disclaimer", async () => {
    const n = 200;
    // Distinct, unmatched-free numeric keys -> the join's real row count is n.
    const primary: Dataset = { id: "l", name: "l.dat", data: { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i]), labels: ["k"], units: [""], metadata: {} } };
    const other: Dataset = { id: "r", name: "r.dat", data: { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i * 2]), labels: ["k"], units: [""], metadata: {} } };
    const params = { op: "join" as const, leftKey: -1, rightKey: -1, mode: "inner" as const, keyMode: "text" as const, with: { id: "r", name: "r.dat" } };
    const out = await computeTransformPreview(params, primary, [other]);
    expect(out.data.time.length).toBe(PREVIEW_CAP);
    expect(out.preview.previewCapped).toBe(true);
  });
});
