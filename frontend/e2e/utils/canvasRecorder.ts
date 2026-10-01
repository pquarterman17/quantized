// A test-only DRAW-CALL RECORDER for 2-D canvases (PRIMARY_SOFTWARE_AUDIT_PLAN
// P4.2, screen-canvas half). uPlot paints everything that matters for a
// structural comparison — series strokes, tick labels, axis titles — onto a
// canvas, so the DOM alone cannot answer "which colour and dash did series 2
// draw with" or "which tick labels are on the right axis". Pixel snapshots
// could, but they are font- and platform-dependent; this records the drawing
// commands instead, read back at the moment each one executes:
//
//   stroke / fill  -> the live strokeStyle / fillStyle (canvas-normalised, so
//                     "#7FB3FF" and "rgb(127,179,255)" both read "#7fb3ff"),
//                     lineWidth, getLineDash(), and the path's points.
//   fillText       -> the text, its position, and whether it was rotated.
//
// Each canvas keeps only its LATEST frame: a full-canvas `clearRect` (uPlot's
// first act on every redraw) starts that canvas's log afresh. Installed with
// `page.addInitScript` BEFORE the app loads, so it sees every frame. Nothing in
// the app reads or depends on it.

import type { Page } from "@playwright/test";

/** One recorded drawing command. Points are canvas pixels (device pixels). */
export interface DrawOp {
  op: "stroke" | "fill" | "text";
  style: string;
  width: number;
  dash: number[];
  alpha: number;
  /** Every moveTo/lineTo vertex of the path drawn (stroke/fill only). */
  pts: [number, number][];
  /** Number of moveTo calls — one per sub-path (e.g. one per error whisker). */
  moves: number;
  text?: string;
  x?: number;
  y?: number;
  /** True when the text was drawn under a rotation (a vertical axis title). */
  rotated?: boolean;
}

/** The function `addInitScript` runs in the page. Self-contained: it is
 *  serialised, so it may not close over anything in this module. */
function installRecorder(): void {
  type Pt = [number, number];
  interface PathRec { pts: Pt[]; moves: number }
  const w = window as unknown as { __qzDraw?: unknown };
  if (w.__qzDraw) return;
  const logs = new WeakMap<HTMLCanvasElement, unknown[]>();
  const paths = new WeakMap<object, PathRec>();
  const current = new WeakMap<CanvasRenderingContext2D, PathRec>();
  const recOf = (map: WeakMap<object, PathRec>, key: object): PathRec => {
    let r = map.get(key);
    if (!r) { r = { pts: [], moves: 0 }; map.set(key, r); }
    return r;
  };
  const push = (ctx: CanvasRenderingContext2D, entry: unknown) => {
    const c = ctx.canvas;
    let a = logs.get(c);
    if (!a) { a = []; logs.set(c, a); }
    a.push(entry);
  };
  const C = CanvasRenderingContext2D.prototype;
  const P = Path2D.prototype;
  const wrapPath = <K extends "moveTo" | "lineTo">(proto: typeof C | typeof P, name: K, isCtx: boolean) => {
    const orig = proto[name] as (this: unknown, x: number, y: number) => void;
    (proto as unknown as Record<string, unknown>)[name] = function (this: object, x: number, y: number) {
      const rec = isCtx ? recOf(current as unknown as WeakMap<object, PathRec>, this) : recOf(paths, this);
      rec.pts.push([x, y]);
      if (name === "moveTo") rec.moves++;
      return orig.call(this, x, y);
    };
  };
  wrapPath(P, "moveTo", false);
  wrapPath(P, "lineTo", false);
  wrapPath(C, "moveTo", true);
  wrapPath(C, "lineTo", true);
  const corners = (x: number, y: number, rw: number, rh: number): Pt[] =>
    [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]];
  for (const [proto, isCtx] of [[P, false], [C, true]] as const) {
    const orig = proto.rect as (this: unknown, x: number, y: number, rw: number, rh: number) => void;
    (proto as unknown as Record<string, unknown>).rect = function (this: object, x: number, y: number, rw: number, rh: number) {
      const rec = isCtx ? recOf(current as unknown as WeakMap<object, PathRec>, this) : recOf(paths, this);
      rec.pts.push(...corners(x, y, rw, rh));
      rec.moves++;
      return orig.call(this, x, y, rw, rh);
    };
  }
  const origBegin = C.beginPath;
  C.beginPath = function (this: CanvasRenderingContext2D) {
    current.set(this, { pts: [], moves: 0 });
    return origBegin.call(this);
  };
  const origClear = C.clearRect;
  C.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number) {
    if (x <= 0 && y <= 0 && cw >= this.canvas.width && ch >= this.canvas.height) logs.set(this.canvas, []);
    return origClear.call(this, x, y, cw, ch);
  };
  const paint = (op: "stroke" | "fill") => {
    const orig = C[op] as (this: CanvasRenderingContext2D, ...a: unknown[]) => void;
    (C as unknown as Record<string, unknown>)[op] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const p = args[0];
      const rec = p instanceof Path2D ? paths.get(p) : current.get(this);
      push(this, {
        op,
        style: String(op === "stroke" ? this.strokeStyle : this.fillStyle),
        width: this.lineWidth,
        dash: this.getLineDash(),
        alpha: this.globalAlpha,
        pts: rec ? rec.pts.slice() : [],
        moves: rec ? rec.moves : 0,
      });
      return orig.apply(this, args);
    };
  };
  paint("stroke");
  paint("fill");
  for (const op of ["fillRect", "strokeRect"] as const) {
    const orig = C[op];
    C[op] = function (this: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number) {
      push(this, {
        op: op === "fillRect" ? "fill" : "stroke",
        style: String(op === "fillRect" ? this.fillStyle : this.strokeStyle),
        width: this.lineWidth, dash: this.getLineDash(), alpha: this.globalAlpha,
        pts: corners(x, y, rw, rh), moves: 1,
      });
      return orig.call(this, x, y, rw, rh);
    };
  }
  const origText = C.fillText;
  C.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    const m = this.getTransform();
    push(this, {
      op: "text", style: String(this.fillStyle), width: 0, dash: [], alpha: this.globalAlpha, pts: [], moves: 0,
      text: String(text), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, rotated: Math.abs(m.b) > 1e-6,
    });
    return maxWidth === undefined ? origText.call(this, text, x, y) : origText.call(this, text, x, y, maxWidth);
  };
  w.__qzDraw = { log: (c: HTMLCanvasElement) => (logs.get(c) ?? []).slice() };
}

export async function installCanvasRecorder(page: Page): Promise<void> {
  await page.addInitScript(installRecorder);
}
