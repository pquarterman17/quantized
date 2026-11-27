// Plan item 24, screen == export: the canvas half of the SHARED wire fixture
// `tests/fixtures/wire/group_shapes.json` (written and asserted on the backend by
// `tests/test_export_group_shapes.py`). The backend computes the hull vertices, ellipse
// parameters and legend words once; here the canvas must DRAW exactly those vertices and
// say exactly those words in its key.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { drawOverlays, type OverlayResult, type SeriesOverlays } from "./plotOverlaysDraw";

interface Fixture {
  x: number[];
  series: { label: string; y: (number | null)[] }[];
  cases: Record<string, { spec: Record<string, unknown>; expected: SeriesOverlays[] }>;
}
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "group_shapes.json");
const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

type Op = ["M" | "L", number, number] | ["Z"];
class RecPath {
  ops: Op[] = [];
  addPath(p: RecPath) { this.ops.push(...p.ops); }
  moveTo(x: number, y: number) { this.ops.push(["M", x, y]); }
  lineTo(x: number, y: number) { this.ops.push(["L", x, y]); }
  closePath() { this.ops.push(["Z"]); }
}
const verts = (p: RecPath): [number, number][] => p.ops.filter((o): o is ["M" | "L", number, number] => o[0] !== "Z").map((o) => [o[1], o[2]]);

function canvas() {
  const texts: string[] = [];
  const strokes: { path: RecPath; dash: number[] }[] = [];
  const fills: RecPath[] = [];
  let dash: number[] = [];
  const ctx = new Proxy(
    {
      fillText: (t: string) => texts.push(t),
      measureText: () => ({ width: 50 }),
      setLineDash: (d: number[]) => { dash = d; },
      stroke: (p?: RecPath) => { if (p) strokes.push({ path: p, dash }); },
      fill: (p?: RecPath) => { if (p) fills.push(p); },
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => ((t[k as string] = v), true) },
  );
  const u = {
    ctx,
    bbox: { left: 0, top: 0, width: 400, height: 300 },
    series: [{}, ...fx.series.map(() => ({ stroke: "#336699" }))],
    valToPos: (v: number) => v, // identity: a drawn vertex IS the fixture's data value
  };
  return { u: u as never, texts, strokes, fills };
}

const results = (c: string): OverlayResult[] => fx.cases[c]!.expected.map((res, i) => ({ col: i + 1, res }));
const xy = (c: { x: (number | null)[]; y: (number | null)[] }): [number, number][] => c.x.map((x, i) => [x as number, c.y[i] as number]);

beforeEach(() => {
  (globalThis as unknown as { Path2D: unknown }).Path2D = RecPath;
});

describe("group shapes on the canvas match the wire fixture", () => {
  it("draws each hull ring, ellipse outline and centroid at the fixture's coordinates", () => {
    const { u, strokes, fills } = canvas();
    drawOverlays(u, results("hull_centroid_mean_ellipse"), null);
    const drawn = strokes.map((s) => verts(s.path));
    for (const { res } of results("hull_centroid_mean_ellipse")) {
      if (res.hull) expect(drawn).toContainEqual(xy(res.hull));
      if (res.ellipse) {
        const e = drawn.find((d) => d.length === res.ellipse!.x.length && d.every((p, i) => Math.abs(p[0] - (res.ellipse!.x[i] as number)) < 1e-9));
        expect(e).toBeDefined();
        expect(e).toEqual(xy(res.ellipse));
      }
    }
    // A closed hull is also filled; the degenerate (two-point) one is only a stroked segment.
    const hulls = fx.cases.hull_centroid_mean_ellipse!.expected.filter((r) => r.hull);
    const solid = hulls.filter((r) => !r.hull!.degenerate).map((r) => xy(r.hull!));
    for (const ring of solid) expect(fills.map(verts)).toContainEqual(ring);
    expect(fills.map(verts)).not.toContainEqual(xy(hulls.find((r) => r.hull!.degenerate)!.hull!));
    // The centroid is a cross centred on the fixture's centroid (the horizontal arm's midpoint).
    for (const { res } of results("hull_centroid_mean_ellipse")) {
      if (!res.centroid) continue;
      const [cx, cy] = [res.centroid.x[0] as number, res.centroid.y[0] as number];
      const arm = drawn.find((d) => d.length === 4 && d[0]![1] === cy && d[1]![1] === cy && Math.abs((d[0]![0] + d[1]![0]) / 2 - cx) < 1e-9);
      expect(arm).toBeDefined();
    }
  });

  it("its key says exactly the fixture's words, and why a shape was not drawn", () => {
    for (const name of Object.keys(fx.cases)) {
      const { u, texts } = canvas();
      drawOverlays(u, results(name), null);
      const want: string[] = [];
      for (const r of fx.cases[name]!.expected) {
        const pre = `${r.label}: `; // several groups drawn: each line names its group
        if (r.hull) want.push(pre + r.hull.label);
        if (r.ellipse) want.push(pre + r.ellipse.label);
        if (r.centroid) want.push(pre + r.centroid.label);
        for (const [k, why] of Object.entries(r.refused)) want.push(`${pre}${k} not drawn: ${why}`);
      }
      expect(texts.sort()).toEqual(want.sort());
    }
  });

  it("styles the two ellipses apart (data dotted, mean dashed) and the degenerate hull is named", () => {
    const mean = canvas();
    drawOverlays(mean.u, results("hull_centroid_mean_ellipse"), null);
    expect(mean.strokes.some((s) => s.dash.join() === "6,3")).toBe(true);
    const data = canvas();
    drawOverlays(data.u, results("data_ellipse_99"), null);
    expect(data.strokes.some((s) => s.dash.join() === "2,3")).toBe(true);
    expect(data.strokes.some((s) => s.dash.join() === "6,3")).toBe(false);
    const line = fx.cases.hull_centroid_mean_ellipse!.expected[4]!;
    expect(line.hull!.degenerate).toBe(true);
    expect(line.hull!.label).toContain("degenerate");
  });
});

describe("the key goes where it hides the fewest points", () => {
  it("moves off a crowded bottom-right corner, and stays there on a tie", () => {
    const draw = (data: (number | null)[][]) => {
      const rects: number[][] = [];
      const c = canvas();
      const ctx = (c.u as unknown as { ctx: Record<string, unknown> }).ctx;
      ctx.fillRect = (...a: number[]) => rects.push(a);
      (c.u as unknown as { data: unknown }).data = data;
      drawOverlays(c.u, results("data_ellipse_99").slice(0, 1), null);
      return rects[0]!;
    };
    // Points crowd the bottom-right of the 400 x 300 plot (valToPos is the identity): the key leaves it.
    const crowded = draw([[380, 385, 390], [280, 285, 290]]);
    expect(crowded[0]).toBeLessThan(200);
    // No points at all: the first choice, bottom-right.
    const empty = draw([[], []]);
    expect(empty[0]).toBeGreaterThan(200);
  });
});
