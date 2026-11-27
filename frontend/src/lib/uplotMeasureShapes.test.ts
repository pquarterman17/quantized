// The measurement shapes' canvas half: what the draw gesture snaps to, which
// label each kind prints (log axes included), and the hit-test / handle
// geometry of the kinds that differ from a plain line.
import { describe, expect, it } from "vitest";

import { hitTestShapeBody, shapeHandles, shapeReshapeFields } from "./shapeHit";
import { drawMeasureShape, snapDraw } from "./uplotMeasureShapes";
import type { Shape } from "./types";

/** A uPlot stand-in with linear 10 px per unit axes (log when asked). */
function fakeU(log = false) {
  const pos = (v: number, sc: string) => (log && sc === "x" ? Math.log10(v) * 100 : v * 10);
  return {
    valToPos: (v: number, sc: string) => pos(v, sc),
    posToVal: (p: number, sc: string) => (log && sc === "x" ? 10 ** (p / 100) : p / 10),
    scales: { x: { distr: log ? 3 : 1 }, y: { distr: log ? 3 : 1 } },
  };
}

function ctxStub() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k === "fillText" ? (s: string) => texts.push(s) : k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const style = { stroke: "#000", opacity: 1, width: 1.5, dash: [] as number[] };
const px = (u: ReturnType<typeof fakeU>, s: Shape) => ({
  x1: u.valToPos(s.x1, "x"), y1: u.valToPos(s.y1, "y"), x2: u.valToPos(s.x2, "x"), y2: u.valToPos(s.y2, "y"),
  ...(s.x3 !== undefined && s.y3 !== undefined ? { x3: u.valToPos(s.x3, "x"), y3: u.valToPos(s.y3, "y") } : {}),
});

describe("snapDraw", () => {
  it("snaps a scale bar to the horizontal or the vertical, whichever the drag is nearer", () => {
    const u = fakeU();
    expect(snapDraw(u as never, "scalebar", 1, 1, 6, 2)).toEqual({ x2: 6, y2: 1 });
    expect(snapDraw(u as never, "scalebar", 1, 1, 2, 6)).toEqual({ x2: 1, y2: 6 });
  });
  it("starts an angle's second arm along the horizontal, as long as the first", () => {
    const r = snapDraw(fakeU() as never, "angle", 0, 0, 3, 4);
    expect(r).toMatchObject({ x2: 3, y2: 4, y3: 0 });
    expect(r.x3).toBeCloseTo(5);
  });
  it("leaves the other kinds alone", () => {
    expect(snapDraw(fakeU() as never, "slope", 0, 0, 3, 4)).toEqual({ x2: 3, y2: 4 });
  });
});

describe("drawMeasureShape labels", () => {
  const draw = (s: Shape, log = false) => {
    const u = fakeU(log);
    const { ctx, texts } = ctxStub();
    drawMeasureShape(u as never, ctx, s, px(u, s), style, "11px monospace");
    return texts;
  };
  it("prints the exponent on log axes and the plain slope on linear ones", () => {
    const s: Shape = { id: "a", kind: "slope", x1: 1, y1: 1, x2: 10, y2: 100 };
    expect(draw(s, true)).toEqual(["n = 2"]); // d log10 y / d log10 x
    expect(draw(s, false)).toEqual(["slope = 11"]); // 99 / 9
  });
  it("prints distance with its components, an angle in degrees, a scale bar's text", () => {
    expect(draw({ id: "d", kind: "distance", x1: 0, y1: 0, x2: 3, y2: 4 })).toEqual(["d = 5 (\u0394x = 3, \u0394y = 4)"]);
    expect(draw({ id: "g", kind: "angle", x1: 0, y1: 0, x2: 1, y2: 0, x3: 0, y3: 1 })).toEqual(["\u03b8 = 90.0\u00b0"]);
    expect(draw({ id: "b", kind: "scalebar", x1: 0, y1: 0, x2: 200, y2: 0, length: 200, orient: "h", text: "200 nm" })).toEqual(["200 nm"]);
  });
});

/** A canvas stand-in that records every call and the line width each stroke ran at. */
function recordingCtx() {
  const calls: { name: string; args: unknown[]; lineWidth?: unknown }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k === "measureText" ? () => undefined : k in t ? t[k] : (...args: unknown[]) => { calls.push({ name: k, args, lineWidth: t.lineWidth }); }),
    set: (t, k: string, v) => ((t[k] = v), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("angle arc", () => {
  const angle: Shape = { id: "g", kind: "angle", x1: 0, y1: 0, x2: 10, y2: 0, x3: 0, y3: 5 }; // arms 100 px and 50 px
  const draw = (s: Shape) => {
    const u = fakeU();
    const { ctx, calls } = recordingCtx();
    drawMeasureShape(u as never, ctx, s, px(u, s), style, "11px monospace");
    return calls;
  };
  it("is off unless asked: the same calls as before the option existed", () => {
    expect(draw(angle).some((c) => c.name === "arc" && c.args.length === 6 && c.args[2] !== 3)).toBe(false);
    expect(draw({ ...angle, arc: false })).toEqual(draw(angle));
  });
  it("strokes a circle of 0.3 x the shorter arm, from the first arm to the second, the smaller way round", () => {
    const arcs = draw({ ...angle, arc: true }).filter((c) => c.name === "arc" && c.args[2] !== 3); // 3 = the vertex dot
    expect(arcs).toHaveLength(1);
    const [cx, cy, r, from, to, anticlockwise] = arcs[0].args as number[];
    expect([cx, cy]).toEqual([0, 0]);
    expect(r).toBeCloseTo(15); // 0.3 * 50 px
    expect(from).toBeCloseTo(0); // along the first arm (+x)
    expect(to).toBeCloseTo(Math.PI / 2); // to the second, straight down the screen
    expect(anticlockwise).toBe(false);
    expect(arcs[0].lineWidth).toBeCloseTo(1.5 * 0.7);
  });
  it("sweeps anticlockwise when the second arm lies the other way", () => {
    const flipped: Shape = { ...angle, x2: 0, y2: 10, x3: 10, y3: 0, arc: true };
    const arc = draw(flipped).find((c) => c.name === "arc" && c.args[2] !== 3)!;
    expect(arc.args[5]).toBe(true);
    expect((arc.args[4] as number) - (arc.args[3] as number)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("hit-testing and handles", () => {
  it("an angle is hit on either arm and has three handles; reshape maps the third to x3/y3", () => {
    const g = { id: "g", kind: "angle" as const, x1: 0, y1: 0, x2: 100, y2: 0, x3: 0, y3: 100 };
    expect(hitTestShapeBody([g], { x: 50, y: 2 })).toBe("g");
    expect(hitTestShapeBody([g], { x: 2, y: 50 })).toBe("g");
    expect(hitTestShapeBody([g], { x: 80, y: 80 })).toBeNull();
    expect(shapeHandles("angle", g)).toHaveLength(3);
    expect(shapeReshapeFields("angle", 2)).toEqual({ xField: "x3", yField: "y3" });
  });
  it("a scale bar is hit along its segment and has no reshape handles", () => {
    const g = { id: "b", kind: "scalebar" as const, x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(hitTestShapeBody([g], { x: 40, y: 3 })).toBe("b");
    expect(shapeHandles("scalebar", g)).toEqual([]);
  });
  it("slope and distance keep the two end handles of a line", () => {
    expect(shapeHandles("slope", { x1: 0, y1: 0, x2: 5, y2: 5 })).toHaveLength(2);
    expect(shapeReshapeFields("distance", 1)).toEqual({ xField: "x2", yField: "y2" });
  });
});
