// Overlays on a turned plot (an Origin horizontal bar graph): every overlay
// that places itself along X or Y lands where the turned plot shows that
// value. The REAL overlay plugins run through `orientPlugins` against a fake
// turned uPlot and a recording canvas that tracks the transform, so each
// assertion is in canvas pixels, as the user sees it.
import { beforeAll, describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { regionDecorSettled } from "./regionDecorLoader";
import {
  annotationPlugin, colorScatterPlugin, errorBarsPlugin, errorSpansPlugin, refLinePlugin, regionShadePlugin,
} from "./uplotOverlays";
import { orientArgs, orientPlugins, orientTurnSettled, TURNED_TOOLS } from "./uplotOrient";
import { uprightView } from "./uplotTurn";
import { readoutPlugin } from "./uplotPointerTools";
import type { ColorScatterSpec } from "./colorscatter";

beforeAll(async () => {
  await regionDecorSettled; // shades and off-scale markers draw from this chunk
  await orientTurnSettled; // the upright view of a turned plot (lib/uplotTurn.ts)
});

// Turned plot: X 0..10 runs UP the canvas (x=0 at pixel 350, x=10 at 50);
// Y 0..100 runs across it (y=0 at pixel 100, y=100 at 500).
const LEFT = 100, TOP = 50, W = 400, H = 300;
const dx = (y: number) => LEFT + (y / 100) * W;
const dy = (x: number) => TOP + H - (x / 10) * H;

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A canvas that records what it draws in DEVICE pixels, with the transform. */
function recordingCtx() {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const props: [string, string][] = [];
  const segs: [number, number, number, number][] = [];
  const rects: [number, number, number, number][] = [];
  const points: [number, number][] = [];
  const texts: { s: string; at: [number, number]; upright: boolean; align: string; baseline: string }[] = [];
  let pen: [number, number] = [0, 0];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const ctx = {
    font: "12px sans-serif", fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic",
    save() { stack.push(m); props.push([this.textAlign, this.textBaseline]); },
    restore() { m = stack.pop() ?? m; [this.textAlign, this.textBaseline] = props.pop() ?? [this.textAlign, this.textBaseline]; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => void (m = mul(m, [a, b, c, d, e, f])),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void (m = [a, b, c, d, e, f]),
    moveTo: (x: number, y: number) => void (pen = apply(m, x, y)),
    lineTo: (x: number, y: number) => {
      const p = apply(m, x, y);
      segs.push([r(pen[0]), r(pen[1]), r(p[0]), r(p[1])]);
      pen = p;
    },
    rect: (x: number, y: number, w: number, h: number) => {
      const [a, b] = apply(m, x, y);
      const [c, d] = apply(m, x + w, y + h);
      rects.push([r(Math.min(a, c)), r(Math.min(b, d)), r(Math.abs(c - a)), r(Math.abs(d - b))]);
    },
    fillRect(x: number, y: number, w: number, h: number) { this.rect(x, y, w, h); },
    arc: (x: number, y: number) => void points.push(apply(m, x, y).map(r) as [number, number]),
    fillText(s: string, x: number, y: number) {
      const upright = m[0] > 0 && m[3] > 0 && m[1] === 0 && m[2] === 0;
      texts.push({ s, at: apply(m, x, y).map(r) as [number, number], upright, align: this.textAlign, baseline: this.textBaseline });
    },
    measureText: (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }),
  };
  const noop = () => undefined;
  const proxied = new Proxy(ctx as Record<string, unknown>, {
    get: (t, p) => (p in t ? t[p as string] : noop),
    set: (t, p, v) => ((t[p as string] = v), true),
  });
  return { ctx: proxied as unknown as CanvasRenderingContext2D, segs, rects, points, texts };
}

function turnedPlot(data: (number | null)[][] = [[2, 5, 8], [20, 50, 80]]) {
  const rec = recordingCtx();
  const u = {
    ctx: rec.ctx,
    bbox: { left: LEFT, top: TOP, width: W, height: H },
    scales: { x: { ori: 1, min: 0, max: 10 }, y: { ori: 0, min: 0, max: 100 } },
    data,
    series: [{}, { scale: "y", show: true, stroke: () => "#f00" }],
    cursor: { idx: 1 },
    over: document.createElement("div"),
    root: document.createElement("div"),
    valToPos: (v: number, key: string, canvas?: boolean) =>
      key === "x" ? (canvas ? dy(v) : dy(v) - TOP) : (canvas ? dx(v) : dx(v) - LEFT),
    posToVal: (p: number, key: string, canvas?: boolean) =>
      key === "x" ? ((TOP + H - (canvas ? p : p + TOP)) / H) * 10 : (((canvas ? p : p + LEFT) - LEFT) / W) * 100,
  } as unknown as uPlot;
  return { u, rec };
}

const TURNED = [{ bars: "horizontal" as const }];
const draw = (plugin: uPlot.Plugin, u: uPlot) => {
  const [p] = orientPlugins([plugin], TURNED);
  for (const name of ["drawClear", "draw"] as const) {
    const hook = p.hooks[name];
    if (typeof hook === "function") (hook as (u: uPlot) => void)(u);
  }
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const undirected = ([a, b, c, d]: number[]) => (a < c || (a === c && b <= d) ? [a, b, c, d] : [c, d, a, b]);

describe("orientPlugins on a turned plot", () => {
  it("leaves the plugins of an upright plot untouched", () => {
    const plugins = [refLinePlugin([], "#000")];
    expect(orientPlugins(plugins, [{ bars: true }])).toBe(plugins);
  });

  it("an X reference line runs ACROSS the plot at its X, a Y line runs up it; labels upright", () => {
    const { u, rec } = turnedPlot();
    draw(refLinePlugin([
      { id: "a", axis: "x", value: 5, label: "x5" },
      { id: "b", axis: "y", value: 25, label: "y25" },
    ] as never, "#000"), u);
    expect(rec.segs.map(undirected)).toContainEqual([LEFT, dy(5), LEFT + W, dy(5)]); // across, at x = 5
    expect(rec.segs.map(undirected)).toContainEqual([dx(25), TOP, dx(25), TOP + H]); // up, at y = 25
    expect(rec.texts.map((t) => t.s)).toEqual(["x5", "y25"]);
    expect(rec.texts.every((t) => t.upright)).toBe(true);
  });

  it("an off-scale X line is marked inside the plot at the end its value is off, arrow turned", () => {
    for (const [value, arrow, nearTop] of [[14, "▴", true], [-3, "▾", false]] as const) {
      const { u, rec } = turnedPlot();
      draw(refLinePlugin([{ id: "a", axis: "x", value }] as never, "#000"), u);
      const t = rec.texts.find((x) => x.s.includes("off-scale"));
      expect(t?.s).toContain(arrow);
      expect(t!.upright).toBe(true);
      expect(Math.abs(t!.at[1] - (nearTop ? TOP : TOP + H))).toBeLessThan(8); // that end of X
      expect(t!.at[0]).toBeLessThan(LEFT + 8); // along the X axis, on the left
      expect(t!.align).toBe("left"); // so the label reads INTO the plot
      expect(t!.baseline).toBe(nearTop ? "top" : "bottom");
      expect(rec.segs.some((s) => near(s[1], dy(value)))).toBe(false); // no line off-scale
    }
  });

  it("a region shade covers its X band across the plot and its Y band up it", () => {
    const { u, rec } = turnedPlot();
    draw(regionShadePlugin([{ id: "s", x1: 2, x2: 4, y1: 10, y2: 30, fill: "#00ff00" }]), u);
    expect(rec.rects).toContainEqual([dx(10), dy(4), dx(30) - dx(10), dy(2) - dy(4)]);
  });

  it("error bars on a bar's value run along the value axis", () => {
    const { u, rec } = turnedPlot();
    draw(errorBarsPlugin(new Map([[1, [5, 5, 5]]]), "#000"), u);
    expect(rec.segs).toContainEqual([dx(15), dy(2), dx(25), dy(2)]); // 20 ± 5 at x = 2, horizontal
  });

  it("asymmetric Y spans run along the value axis and X spans up it", () => {
    const { u, rec } = turnedPlot();
    const spans = [
      { axis: "y" as const, plus: [6, null, null], minus: [2, null, null] },
      { axis: "x" as const, plus: [null, 1, null], minus: [null, 0.5, null] },
    ];
    draw(errorSpansPlugin(new Map([[1, spans]]), "#000"), u);
    const segs = rec.segs.map(undirected);
    expect(segs).toContainEqual([dx(18), dy(2), dx(26), dy(2)]); // 20 -2/+6 at x = 2
    expect(segs).toContainEqual([dx(50), dy(6), dx(50), dy(4.5)]); // x = 5 -0.5/+1 at y = 50
  });

  it("a colour-mapped series puts each point at (its value across, its X up)", () => {
    const { u, rec } = turnedPlot();
    const spec = { channel: 1, z: [0, 0.5, 1], colormap: "viridis", lo: 0, hi: 1 } as ColorScatterSpec;
    draw(colorScatterPlugin(new Map([[1, spec]])), u);
    const drawn = [...rec.points, ...rec.rects.map((q) => [q[0] + q[2] / 2, q[1] + q[3] / 2] as [number, number])];
    for (const [x, y] of [[2, 20], [5, 50], [8, 80]]) {
      expect(drawn.some(([px, py]) => Math.abs(px - dx(y)) < 1 && Math.abs(py - dy(x)) < 1)).toBe(true);
    }
  });

  it("an annotation's text is drawn upright next to its (X, Y) anchor", () => {
    const { u, rec } = turnedPlot();
    draw(annotationPlugin([{ id: "n", x: 5, y: 50, text: "Peak" }], "#000", "12px sans-serif"), u);
    const t = rec.texts.find((x) => x.s.includes("Peak"));
    expect(t).toBeDefined();
    expect(t!.upright).toBe(true);
    expect(Math.abs(t!.at[0] - dx(50))).toBeLessThan(60);
    expect(Math.abs(t!.at[1] - dy(5))).toBeLessThan(60);
  });

  it("the cursor readout reads the data index, unchanged by the turn", () => {
    const { u } = turnedPlot();
    let got: unknown = null;
    const [p] = orientPlugins([readoutPlugin((r) => (got = r))], TURNED);
    (p.hooks.setCursor as (u: uPlot) => void)(u);
    expect(got).toEqual({ x: 5, rows: [{ label: "", y: 50 }] });
  });
});

describe("uprightView", () => {
  it("shows X left to right and Y bottom to top over the turned size, both ways", () => {
    const { u } = turnedPlot();
    const v = uprightView(u);
    expect(v.bbox).toEqual({ left: LEFT, top: TOP, width: H, height: W });
    expect(v.valToPos(8, "x", true)).toBeGreaterThan(v.valToPos(2, "x", true));
    expect(v.valToPos(80, "y", true)).toBeLessThan(v.valToPos(20, "y", true));
    expect(v.posToVal(v.valToPos(7, "x", true), "x", true)).toBeCloseTo(7);
    expect(v.posToVal(v.valToPos(30, "y"), "y")).toBeCloseTo(30);
  });
});

describe("orientArgs (pointer tools on a turned plot)", () => {
  const args = { tool: "measure" as const, wheelZoom: true, annotationEdit: {}, shapeEdit: {}, onRefLineMove: () => {} };
  it("falls back to zoom and switches drag editing and wheel zoom off", () => {
    const out = orientArgs({ ...args, seriesStyles: TURNED });
    expect(out).toMatchObject({ tool: "zoom", wheelZoom: false, annotationEdit: null, shapeEdit: null });
    expect(out.onRefLineMove).toBeUndefined();
    for (const tool of TURNED_TOOLS) expect(orientArgs({ ...args, tool, seriesStyles: TURNED }).tool).toBe(tool);
  });
  it("leaves an upright plot's args as they are", () => {
    const upright = { ...args, seriesStyles: [{ bars: true }] };
    expect(orientArgs(upright)).toBe(upright);
  });
});
