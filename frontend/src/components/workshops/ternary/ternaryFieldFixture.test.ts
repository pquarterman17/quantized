// A ternary composition map, screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/ternary_field.json`; backend half:
// `tests/test_ternary_field_wire.py`).
//
// The workshop's preview IS the export route's own render, so "same picture"
// reduces to two things this test holds: (1) the request the workshop builds
// from a dataset is exactly the body the fixture says the backend rendered, and
// (2) what the backend drew follows rules that can be re-derived here WITHOUT
// the backend's code: the triangulation is a valid Delaunay triangulation of the
// kept points that tiles their convex hull, Z is linear on each triangle and
// absent outside the hull, the levels are equal bands over Z's range, and each
// band's colour is the colormap at the band's midpoint (the canvas's stops
// against matplotlib's table, within the measured stop-interpolation error (16 of 255)).
//
// Regenerate only after a DELIBERATE rule change (see the backend test header).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { colormap, type ColormapName } from "../../../lib/colormap";
import { TERNARY_MPL_CMAP, type TernaryField, type TernaryPicksSaved } from "../../../lib/ternaryProject";
import type { DataStruct } from "../../../lib/types";
import { buildTernaryRequest } from "./ternaryRequest";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "ternary_field.json");

interface Case {
  name: string;
  input: { dataset: DataStruct; picks: TernaryPicksSaved; title: string; filename: string; field: TernaryField };
  request: { data: number[][]; values: number[]; cmap: string; levels: number; kind: string; contour_lines: boolean };
  expected: {
    xy: [number, number][];
    triangles: [number, number, number][];
    bounds: number[];
    line_levels: number[];
    fractions: number[];
    band_rgb: [number, number, number][];
    probes: { xy: [number, number]; z: number | null }[];
  };
}

const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;
const SQRT3_2 = Math.sqrt(3) / 2;

/** Cartesian ternary coordinates of a composition row, normalised to sum 1. */
function xyOf(row: number[]): [number, number] {
  const s = row[0] + row[1] + row[2];
  return [row[2] / s + 0.5 * (row[0] / s), SQRT3_2 * (row[0] / s)];
}

const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function hullArea(pts: [number, number][]): number {
  const p = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const build = (seq: [number, number][]) => {
    const h: [number, number][] = [];
    for (const q of seq) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  const hull = [...build(p), ...build([...p].reverse())];
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i];
    const [x1, y1] = hull[(i + 1) % hull.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** True when `q` lies strictly inside the circumcircle of the triangle abc. */
function inCircumcircle(a: [number, number], b: [number, number], c: [number, number], q: [number, number]): boolean {
  const orient = cross(a, b, c) > 0 ? 1 : -1;
  const m = [a, b, c].map(([x, y]) => [x - q[0], y - q[1]]);
  const det =
    (m[0][0] ** 2 + m[0][1] ** 2) * (m[1][0] * m[2][1] - m[2][0] * m[1][1]) -
    (m[1][0] ** 2 + m[1][1] ** 2) * (m[0][0] * m[2][1] - m[2][0] * m[0][1]) +
    (m[2][0] ** 2 + m[2][1] ** 2) * (m[0][0] * m[1][1] - m[1][0] * m[0][1]);
  return orient * det > 1e-12;
}

/** Linear interpolation on the pinned triangles; null outside every triangle. */
function interpolate(c: Case, xy: [number, number][], q: [number, number]): number | null {
  for (const [i, j, k] of c.expected.triangles) {
    const [a, b, d] = [xy[i], xy[j], xy[k]];
    const area = cross(a, b, d);
    const wa = cross(q, b, d) / area;
    const wb = cross(a, q, d) / area;
    const wc = cross(a, b, q) / area;
    if (wa >= -1e-12 && wb >= -1e-12 && wc >= -1e-12) {
      return wa * c.request.values[i] + wb * c.request.values[j] + wc * c.request.values[k];
    }
  }
  return null;
}

describe.each(CASES)("ternary map fixture: $name", (c) => {
  const xy = c.request.data.map(xyOf);

  it("the workshop builds exactly the request the backend rendered", () => {
    const { dataset, picks, title, filename, field } = c.input;
    const built = buildTernaryRequest(dataset, picks, { title, filename, field });
    expect(built.spec).toEqual(c.request);
    expect(built.dropped).toBe(2); // the negative and the all-zero row
  });

  it("the triangulation is Delaunay and tiles the convex hull", () => {
    expect(xy.map(([x, y]) => [x, y])).toEqual(c.expected.xy.map(([x, y]) => [expect.closeTo(x, 12), expect.closeTo(y, 12)]));
    const tris = c.expected.triangles;
    let area = 0;
    for (const [i, j, k] of tris) {
      area += Math.abs(cross(xy[i], xy[j], xy[k])) / 2;
      xy.forEach((q, n) => {
        if (n !== i && n !== j && n !== k) expect(inCircumcircle(xy[i], xy[j], xy[k], q)).toBe(false);
      });
    }
    expect(area).toBeCloseTo(hullArea(xy), 10);
    // Every point is a vertex of some triangle (none dropped from the mesh).
    expect(new Set(tris.flat()).size).toBe(xy.length);
  });

  it("Z is linear on each triangle and absent outside the hull", () => {
    for (const p of c.expected.probes) {
      const z = interpolate(c, xy, p.xy);
      if (p.z === null) expect(z).toBeNull();
      else expect(z).toBeCloseTo(p.z, 9);
    }
    // At a vertex the surface is the data value.
    expect(interpolate(c, xy, xy[0])).toBeCloseTo(c.request.values[0], 9);
  });

  it("levels are equal bands over Z's range; lines sit on the interior edges", () => {
    const lo = Math.min(...c.request.values);
    const hi = Math.max(...c.request.values);
    const n = c.expected.bounds.length - 1;
    expect(n).toBe(c.request.kind === "heatmap" ? 1 : c.request.levels);
    c.expected.bounds.forEach((b, i) => expect(b).toBeCloseTo(lo + ((hi - lo) * i) / n, 9));
    expect(c.expected.line_levels).toEqual(c.request.contour_lines ? c.expected.bounds.slice(1, -1) : []);
  });

  it("band colours are the colormap at each band's midpoint", () => {
    const name = (Object.keys(TERNARY_MPL_CMAP) as ColormapName[]).find((k) => TERNARY_MPL_CMAP[k] === c.request.cmap)!;
    const n = c.expected.fractions.length;
    c.expected.fractions.forEach((f, i) => {
      expect(f).toBeCloseTo((i + 0.5) / n, 12);
      const rgb = colormap(name, f);
      // The canvas interpolates 8-11 anchor stops; matplotlib has 256. Measured
      // worst case over these fixtures is 14 of 255 (viridis, band 1).
      rgb.forEach((v, ch) => expect(Math.abs(v - c.expected.band_rgb[i][ch])).toBeLessThanOrEqual(16));
    });
  });
});
