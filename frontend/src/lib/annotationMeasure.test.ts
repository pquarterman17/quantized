// The measurement annotations' rules, against the table the export asserts too
// (tests/fixtures/wire/annotation_measures.json, tests/test_annotation_measure.py).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  angleDegrees, distanceParts, fmtSig, labelBelow, parseScaleBarInput, scalebarEnd, scalebarGeometry,
  shapeLabel, slopeMeasure, slopeTriangle,
} from "./annotationMeasure";
import type { Shape } from "./types";

const MEASURE_FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "annotation_measures.json"),
    "utf8",
  ),
);
const F = MEASURE_FIXTURE;

describe("fmtSig", () => {
  it.each<{ v: number; digits: number; text: string }>(F.fmt_sig)("$v @ $digits", (c) => {
    expect(fmtSig(c.v, c.digits)).toBe(c.text);
  });
});

describe("slope", () => {
  it.each<{ p: number[]; xlog: boolean; ylog: boolean; mode: string; value: number | null; label: string }>(F.slope)("$p log($xlog,$ylog)", (c) => {
    const m = slopeMeasure(c.p[0], c.p[1], c.p[2], c.p[3], c.xlog, c.ylog);
    expect(m.mode).toBe(c.mode);
    expect(m.label).toBe(c.label);
    if (c.value === null) expect(m.value).toBeNull();
    else expect(m.value).toBeCloseTo(c.value, 12);
  });

  it("is d log y / d log x on log-log axes, from known points", () => {
    const [x1, x2] = [2, 200];
    const y = (x: number) => 3 * x ** 1.7;
    expect(slopeMeasure(x1, y(x1), x2, y(x2), true, true).value).toBeCloseTo(1.7, 12);
    expect(slopeMeasure(x1, y(x1), x2, y(x2), false, false).value).toBeCloseTo((y(x2) - y(x1)) / (x2 - x1), 9);
  });
});

describe("distance, angle, scale bar", () => {
  it.each<{ p: number[]; d: number; dx: number; dy: number; label: string }>(F.distance)("distance $p", (c) => {
    const r = distanceParts(c.p[0], c.p[1], c.p[2], c.p[3]);
    expect(r.label).toBe(c.label);
    expect([r.d, r.dx, r.dy]).toEqual([expect.closeTo(c.d, 12), c.dx, c.dy]);
  });

  it.each<{ vertex: [number, number]; a: [number, number]; b: [number, number]; degrees: number | null; label: string }>(F.angle)("angle $b", (c) => {
    const deg = angleDegrees(c.vertex, c.a, c.b);
    if (c.degrees === null) expect(deg).toBeNull();
    else expect(deg).toBeCloseTo(c.degrees, 9);
    const s = { kind: "angle", x1: c.vertex[0], y1: c.vertex[1], x2: c.a[0], y2: c.a[1], x3: c.b[0], y3: c.b[1] } as const;
    expect(shapeLabel(s, false, false)).toBe(c.label);
  });

  it.each<{ x1: number; y1: number; orient: "h" | "v"; length: number; text: string | null; end: number[]; label: string }>(F.scalebar)("scale bar $orient $length", (c) => {
    expect(scalebarEnd(c.x1, c.y1, c.orient, c.length)).toEqual(c.end);
    const s = {
      kind: "scalebar" as const, x1: c.x1, y1: c.y1, x2: c.end[0], y2: c.end[1], length: c.length, orient: c.orient,
      ...(c.text ? { text: c.text } : {}),
    };
    expect(shapeLabel(s, false, false)).toBe(c.label);
  });

  it("derives a scale bar's length from its endpoints when none is stored", () => {
    expect(scalebarGeometry({ x1: 1, y1: 1, x2: 6, y2: 1 })).toMatchObject({ orient: "h", length: 5, ex: 6, ey: 1 });
    expect(scalebarGeometry({ x1: 1, y1: 1, x2: 1, y2: 4, orient: "v" })).toMatchObject({ length: 3, ex: 1, ey: 4 });
  });

  it("triangle vertices and label side", () => {
    for (const c of F.triangle as { p: number[]; vertices: number[][] }[]) {
      expect(slopeTriangle(c.p[0], c.p[1], c.p[2], c.p[3])).toEqual(c.vertices);
    }
    for (const c of F.label_below as { p: number[]; below: boolean }[]) {
      expect(labelBelow(c.p[0], c.p[1], c.p[2], c.p[3])).toBe(c.below);
    }
  });

  it("every wire shape in the table reads the same label", () => {
    for (const c of F.shapes as { shape: Shape; xlog: boolean; ylog: boolean; label: string }[]) {
      expect(shapeLabel(c.shape, c.xlog, c.ylog)).toBe(c.label);
    }
  });
});

describe("parseScaleBarInput", () => {
  it("takes a number with an optional unit", () => {
    expect(parseScaleBarInput("200 nm")).toEqual({ length: 200, text: "200 nm" });
    expect(parseScaleBarInput(" 0.5 ")).toEqual({ length: 0.5 });
    expect(parseScaleBarInput("1e3µm")).toEqual({ length: 1000, text: "1e3 µm" });
  });
  it("rejects non-positive and non-numeric entries", () => {
    for (const bad of ["", "abc", "0", "-5 nm"]) expect(parseScaleBarInput(bad)).toBeNull();
  });
});
