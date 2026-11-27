// Ternary line and vector plots, screen == export, pinned as a SHARED wire
// fixture (`tests/fixtures/wire/ternary_paths.json`; backend half:
// `tests/test_ternary_paths_wire.py`).
//
// The preview IS the export route's own render, so "same picture" reduces to
// what this test holds: (1) the request the workshop builds from a dataset is
// exactly the body the backend rendered, and (2) the geometry the backend drew
// can be re-derived here WITHOUT its code: the triangle (x, y) of every
// composition (x = c + a/2, y = sqrt(3)/2 a, rows divided by their sum), the
// runs of a line between gaps, and each arrow's endpoints and length.
//
// Regenerate only after a DELIBERATE rule change (see the backend test header).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { TernaryField, TernaryPicksSaved } from "../../../lib/ternaryProject";
import type { DataStruct } from "../../../lib/types";
import { buildTernaryPathsRequest, type TernaryLineSpec, type TernaryPathsSpec, type TernaryVectorSpec } from "./ternaryPathsRequest";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "ternary_paths.json");

interface Case {
  name: string;
  input: { dataset: DataStruct; picks: TernaryPicksSaved; title: string; filename: string; field: TernaryField };
  request: TernaryPathsSpec;
  expected: {
    series?: { name: string; x: (number | null)[]; y: (number | null)[]; runs: [number, number][] }[];
    arrows?: { start: [number, number]; end: [number, number] }[];
    zero_length?: number[];
  };
}

const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;
const SQRT3_2 = Math.sqrt(3) / 2;

/** Cartesian ternary coordinates of a composition row, normalised to sum 1. */
function xyOf(row: (number | null)[]): [number, number] | null {
  if (row.some((v) => v === null)) return null;
  const [a, b, c] = row as number[];
  const s = a + b + c;
  return [c / s + 0.5 * (a / s), SQRT3_2 * (a / s)];
}

describe.each(CASES)("ternary paths fixture: $name", (c) => {
  it("the workshop builds exactly the request the backend rendered", () => {
    const { dataset, picks, title, filename, field } = c.input;
    const built = buildTernaryPathsRequest(dataset, picks, { title, filename, field });
    expect(built.spec).toEqual(c.request);
  });

  it("the pinned geometry follows the triangle's own transform", () => {
    if (c.request.kind === "line") {
      const spec = c.request as TernaryLineSpec;
      spec.series.forEach((s, i) => {
        const exp = c.expected.series![i];
        expect(exp.name).toBe(s.name);
        const pts = s.rows.map(xyOf);
        pts.forEach((p, k) => {
          expect(exp.x[k] === null).toBe(p === null);
          if (p) {
            expect(exp.x[k]).toBeCloseTo(p[0], 12);
            expect(exp.y[k]).toBeCloseTo(p[1], 12);
          }
        });
        // Runs: maximal stretches of rows that are not gaps.
        const runs: [number, number][] = [];
        let from = -1;
        pts.forEach((p, k) => {
          if (p && from < 0) from = k;
          if (!p && from >= 0) {
            runs.push([from, k]);
            from = -1;
          }
        });
        if (from >= 0) runs.push([from, pts.length]);
        expect(exp.runs).toEqual(runs);
      });
    } else {
      const spec = c.request as TernaryVectorSpec;
      expect(spec.start).toHaveLength(spec.end.length);
      spec.start.forEach((s, k) => {
        const a = c.expected.arrows![k];
        const [x0, y0] = xyOf(s)!;
        const [x1, y1] = xyOf(spec.end[k])!;
        expect(a.start[0]).toBeCloseTo(x0, 12);
        expect(a.start[1]).toBeCloseTo(y0, 12);
        expect(a.end[0]).toBeCloseTo(x1, 12);
        expect(a.end[1]).toBeCloseTo(y1, 12);
        // A zero-length arrow is exactly where start and end coincide.
        expect(c.expected.zero_length!.includes(k)).toBe(Math.hypot(x1 - x0, y1 - y0) < 1e-12);
      });
    }
  });
});

describe("ternary paths request rules", () => {
  const data = (rows: number[][]): DataStruct => ({
    time: rows.map((_, i) => i),
    values: rows,
    labels: ["a", "b", "c", "g"],
    units: ["", "", "", ""],
    metadata: {},
  });
  const field = (kind: "line" | "vector"): TernaryField => ({ kind, cmap: "viridis", levels: 8, lines: true, labels: false });
  const opts = (kind: "line" | "vector") => ({ title: "", filename: "f", field: field(kind) });

  it("a NaN row breaks the line: it is sent as a gap, never joined across", () => {
    const d = data([
      [1, 1, 1, 0],
      [Number.NaN, 1, 1, 0],
      [2, 1, 1, 0],
    ]);
    const b = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, colorBy: null }, opts("line"));
    const rows = (b.spec as TernaryLineSpec).series[0].rows;
    expect(rows[1]).toEqual([null, null, null]);
    expect(b.dropped).toBe(1);
  });

  it("a series with no drawable row is left out; none at all means no spec", () => {
    const d = data([
      [1, 1, 1, 7],
      [0, 0, 0, 8],
    ]);
    const b = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, colorBy: 3 }, opts("line"));
    expect((b.spec as TernaryLineSpec).series.map((s) => s.name)).toEqual(["g = 7"]);
    expect(buildTernaryPathsRequest(data([[0, 0, 0, 1]]), { a: 0, b: 1, c: 2, colorBy: null }, opts("line")).spec).toBeNull();
  });

  it("a fixed colour is not sent for several series", () => {
    const d = data([
      [1, 1, 1, 7],
      [1, 2, 1, 8],
    ]);
    const f = { ...field("line"), path: { color: "#ff0000" } };
    const many = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, colorBy: 3 }, { ...opts("line"), field: f });
    expect((many.spec as TernaryLineSpec).color).toBeUndefined();
    const one = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, colorBy: null }, { ...opts("line"), field: f });
    expect((one.spec as TernaryLineSpec).color).toBe("#ff0000");
  });

  it("a malformed saved style reads as the default", () => {
    const f = { ...field("line"), path: { width: "wide", dash: "zigzag", color: "red", markers: 1 } };
    const b = buildTernaryPathsRequest(data([[1, 1, 1, 0]]), { a: 0, b: 1, c: 2, colorBy: null }, { ...opts("line"), field: f });
    expect(b.spec).toMatchObject({ width: 1.5, dash: "solid", markers: false });
    expect((b.spec as TernaryLineSpec).color).toBeUndefined();
  });

  it("a vector row unusable at either end is left out and counted", () => {
    const d = data([
      [1, 1, 1, 0],
      [1, 1, 1, 0],
    ]);
    // start = columns 0-2, end = columns 3,3,3: row values 0 -> all-zero end.
    const b = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, ea: 0, eb: 1, ec: 3, colorBy: null }, opts("vector"));
    expect((b.spec as TernaryVectorSpec).start).toHaveLength(2);
    const bad = buildTernaryPathsRequest(d, { a: 0, b: 1, c: 2, ea: 3, eb: 3, ec: 3, colorBy: null }, opts("vector"));
    expect(bad.spec).toBeNull();
    expect(bad.dropped).toBe(2);
  });
});
