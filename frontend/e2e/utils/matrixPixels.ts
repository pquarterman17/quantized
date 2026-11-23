// Pixel-level helpers for `regression-matrix-pixels.spec.ts` (PRIMARY_SOFTWARE_
// AUDIT_PLAN P4.2, "Visual (rendered-output) equivalence", screen half). The
// sibling `regression-matrix-screen.spec.ts` reads the canvas' DRAW CALLS; this
// layer reads the PAINTED PIXELS back (`getImageData`), at positions computed
// from the committed goldens' own axis limits and the live plotting rect, so a
// series that is configured and "drawn" but ends up off-screen, clipped, under
// another layer or in the wrong colour still fails.
//
// Why alpha: uPlot's canvas is transparent (the stage colour is DOM behind it),
// so `getImageData` returns the stroke colour with alpha = antialiasing
// coverage. "Painted in colour C" is therefore "a pixel with alpha >= MIN_ALPHA
// whose RGB is within a tolerance of C" - robust to 1 px lines at fractional
// positions, with no font- or platform-dependent threshold tuning.

import type { Page } from "@playwright/test";

import type { FigureDocument } from "../../src/lib/figureDocument";
import { matrixData, matrixFixture, type MatrixFixtureName } from "../../src/lib/regressionMatrixFixtures.testkit";
import { installCanvasRecorder } from "./canvasRecorder";
import { gotoApp } from "./harness";
import { openFixture, type Panel } from "./matrixScreen";

/** Minimum coverage (0-255) for a pixel to count as "painted". */
export const MIN_ALPHA = 96;
/** Max RGB distance for "this is colour C". The test palette is light and its
 *  nearest neighbours are > 60 apart, so this never conflates two series. */
export const COLOR_TOL = 40;

export const LABELS = matrixData().labels;

/** ONE load per test (a second `gotoApp` restores the first load's autosave). */
export async function loadFixture(page: Page, name: MatrixFixtureName, edit?: (d: FigureDocument) => void): Promise<FigureDocument> {
  await installCanvasRecorder(page);
  await gotoApp(page);
  const doc = matrixFixture(name);
  edit?.(doc);
  await openFixture(page, doc);
  return doc;
}

export interface Probe { panel: number; x: number; y: number; color: string; radius: number; what: string }

/** For each probe, the smallest RGB distance to `color` among the painted
 *  (alpha >= MIN_ALPHA) pixels within `radius` px of (x, y); Infinity if none. */
export function probe(page: Page, probes: Probe[]): Promise<number[]> {
  return page.evaluate(({ probes, minAlpha }) => {
    const canvases = [...document.querySelectorAll<HTMLElement>(".qzk-stage .uplot")].map((u) => u.querySelector("canvas")!);
    return probes.map((p) => {
      const canvas = canvases[p.panel];
      const side = 2 * p.radius + 1;
      const x0 = Math.round(p.x) - p.radius;
      const y0 = Math.round(p.y) - p.radius;
      if (x0 < 0 || y0 < 0 || x0 + side > canvas.width || y0 + side > canvas.height) return Infinity;
      const d = canvas.getContext("2d")!.getImageData(x0, y0, side, side).data;
      const w = [1, 3, 5].map((i) => parseInt(p.color.slice(i, i + 2), 16));
      let best = Infinity;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < minAlpha) continue;
        best = Math.min(best, Math.hypot(d[i] - w[0], d[i + 1] - w[1], d[i + 2] - w[2]));
      }
      return best;
    });
  }, { probes, minAlpha: MIN_ALPHA });
}

/** Number of painted pixels within `tol` of each colour, over the WHOLE canvas
 *  of `panel`. Used both ways: > 0 for a drawn colour, exactly 0 for a colour
 *  that must not appear (a hidden series, an unused palette slot). */
export function countColors(page: Page, panel: number, colors: string[], tol: number, minAlpha = 128): Promise<number[]> {
  return page.evaluate(({ panel, colors, tol, minAlpha }) => {
    const canvas = document.querySelectorAll<HTMLElement>(".qzk-stage .uplot")[panel].querySelector("canvas")!;
    const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const want = colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
    const n = colors.map(() => 0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < minAlpha) continue;
      want.forEach((w, k) => { if (Math.hypot(d[i] - w[0], d[i + 1] - w[1], d[i + 2] - w[2]) <= tol) n[k]++; });
    }
    return n;
  }, { panel, colors, tol, minAlpha });
}

export type Map1 = (v: number) => number;

/** value -> canvas px along an axis whose applied range is `[lo, hi]` and whose
 *  plotting rect spans `[a, b]` px (uPlot maps the scale range onto the rect). */
export const linMap = (lo: number, hi: number, a: number, b: number): Map1 => (v) => a + ((v - lo) * (b - a)) / (hi - lo);
export const xMap = (p: Panel, lim: [number, number]): Map1 => linMap(lim[0], lim[1], p.rect.left, p.rect.left + p.rect.width);
export const yMap = (p: Panel, lim: [number, number]): Map1 => linMap(lim[0], lim[1], p.rect.top + p.rect.height, p.rect.top);

/** Distance (px) from a point to the polyline `pts`. */
export function distToPolyline(pts: [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return best;
}
