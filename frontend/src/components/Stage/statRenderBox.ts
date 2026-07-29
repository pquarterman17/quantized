// Box-family Canvas2D marks (JMP_GAP J5): the box/whisker glyph plus its two
// new optional overlays (raw jittered points #1, mean+-95% CI marker #2),
// and the new points-only "strip" mode (#3). Split out of statRender.ts to
// keep that dispatcher from re-growing past the god-module ceiling (the same
// MapStage/mapRender.ts split precedent statRender.ts's own header cites) --
// this module owns everything box/strip-shaped, statRender.ts owns the
// dispatcher + the other modes (violin/qq/histogram/bar) + shared axes.
//
// The jitter offset uses the SAME deterministic (rowIndex, category) hash
// (lib/jitter.ts) the matplotlib export (`calc.figure_statplots`) computes
// bit-for-bit identically in Python -- a point sits in the same relative
// spot on screen and in the exported figure.

import { deterministicJitter } from "../../lib/jitter";
import {
  categorySlots,
  connectMeansSeries,
  finiteDomain,
  type BoxStat,
  type CategorySlot,
} from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";
import {
  drawCategoryAxis,
  drawCountLabel,
  drawValueAxis,
  type BoxPointsGroup,
  type Rect,
  type StatDrawData,
} from "./statRender";

/** Jittered raw-point overlay for one category slot (JMP_GAP J5 #1): each
 *  point's horizontal offset is `deterministicJitter(rowIndex, category) *
 *  halfWidth * jitterFrac` -- pure/deterministic, so re-rendering (or
 *  excluding a DIFFERENT row elsewhere, #50) never reshuffles a still-
 *  visible point. */
function drawJitteredPoints(
  ctx: CanvasRenderingContext2D,
  group: BoxPointsGroup,
  cx: number,
  halfWidth: number,
  vy: (v: number) => number,
  color: string,
  jitterFrac = 0.7,
) {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (const p of group.points) {
    const j = deterministicJitter(p.rowIndex, group.label);
    const px = cx + j * halfWidth * jitterFrac;
    ctx.beginPath();
    ctx.arc(px, vy(p.value), 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Mean +/- 95% CI marker (JMP_GAP J5 #2): a diamond at the mean with a
 *  vertical CI whisker + caps (mirrors the box glyph's own whisker/cap
 *  drawing), always in `ink` so it reads against any series color. Skips
 *  the whisker (but still draws the diamond) when the CI is undefined
 *  (n<2 -- `ciLo`/`ciHi` both fall back to the mean itself, so drawing them
 *  would just be a zero-length line; still guard on finiteness directly). */
function drawMeanCIMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  b: BoxStat,
  vy: (v: number) => number,
  ink: string,
) {
  if (!Number.isFinite(b.mean)) return;
  const ciLo = b.ciLo;
  const ciHi = b.ciHi;
  if (Number.isFinite(ciLo) && Number.isFinite(ciHi) && ciLo !== ciHi) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, vy(ciLo as number));
    ctx.lineTo(cx, vy(ciHi as number));
    ctx.stroke();
    const capW = 4;
    ctx.beginPath();
    ctx.moveTo(cx - capW, vy(ciLo as number));
    ctx.lineTo(cx + capW, vy(ciLo as number));
    ctx.moveTo(cx - capW, vy(ciHi as number));
    ctx.lineTo(cx + capW, vy(ciHi as number));
    ctx.stroke();
  }
  const r = 4;
  const my = vy(b.mean);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(cx, my - r);
  ctx.lineTo(cx + r, my);
  ctx.lineTo(cx, my + r);
  ctx.lineTo(cx - r, my);
  ctx.closePath();
  ctx.fill();
}

/** Connect-group-means "interaction plot" line (JMP_GAP J5 residual): a
 *  dashed polyline through each category slot's mean, in on-screen axis
 *  order -- reads `connectMeansSeries` (the SAME `BoxStat.mean` the mean-CI
 *  diamond already shows, never a second computation). Breaks the line
 *  rather than drawing through a non-finite mean (shouldn't happen for a
 *  finite group, but matches the box glyph's own defensive finiteness
 *  checks). Always drawn in `ink` so it reads against every series color. */
function drawConnectMeansLine(
  ctx: CanvasRenderingContext2D,
  boxes: readonly BoxStat[],
  slots: readonly CategorySlot[],
  rect: Rect,
  vy: (v: number) => number,
  ink: string,
) {
  const means = connectMeansSeries(boxes);
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  let started = false;
  means.forEach((m, i) => {
    if (!Number.isFinite(m)) {
      started = false;
      return;
    }
    const cx = rect.x + slots[i].cx * rect.w;
    const cy = vy(m);
    if (started) ctx.lineTo(cx, cy);
    else ctx.moveTo(cx, cy);
    started = true;
  });
  ctx.stroke();
  ctx.restore();
}

// ── Box (+ optional points / mean-CI overlays) ──────────────────────────────

export function drawBoxesWithMarks(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "box" }>,
  ink: string,
  muted: string,
) {
  if (!d.boxes.length) return;
  // Every finite value already sits within [whislo, whishi] union fliers
  // (Tukey's own definition), so the points overlay never needs its own
  // domain contribution -- the box's domain already spans every raw point.
  const domain = finiteDomain(d.boxes.map((b) => [b.whislo, b.whishi, ...b.fliers]));
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const slots = categorySlots(d.boxes.length);
  drawCategoryAxis(ctx, rect, slots, d.boxes.map((b) => b.label), d.groupLabel, ink, muted);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.boxes.forEach((b, i) => {
    const slot = slots[i];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = seriesColor(i);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx, vy(b.whislo));
    ctx.lineTo(cx, vy(b.q1));
    ctx.moveTo(cx, vy(b.q3));
    ctx.lineTo(cx, vy(b.whishi));
    ctx.stroke();
    const capW = hw * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - capW, vy(b.whislo));
    ctx.lineTo(cx + capW, vy(b.whislo));
    ctx.moveTo(cx - capW, vy(b.whishi));
    ctx.lineTo(cx + capW, vy(b.whishi));
    ctx.stroke();

    const yTop = vy(b.q3);
    const yBot = vy(b.q1);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.fillRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.strokeRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));

    ctx.beginPath();
    ctx.moveTo(cx - hw, vy(b.median));
    ctx.lineTo(cx + hw, vy(b.median));
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color;
    for (const f of b.fliers) {
      ctx.beginPath();
      ctx.arc(cx, vy(f), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    const pointsGroup = d.points?.[i];
    if (pointsGroup) drawJitteredPoints(ctx, pointsGroup, cx, hw, vy, color);
    if (d.showMeanCI) drawMeanCIMarker(ctx, cx, b, vy, ink);

    drawCountLabel(ctx, cx, rect.y, b.n, muted);
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of
  // every box glyph.
  if (d.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink);
}

// ── Strip (points-only, JMP_GAP J5 #3) ──────────────────────────────────────

export function drawStrip(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "strip" }>,
  ink: string,
  muted: string,
) {
  if (!d.points.length) return;
  const valueLists = d.points.map((g) => g.points.map((p) => p.value));
  const ciExtents = d.showMeanCI
    ? d.boxes.flatMap((b) => [b.ciLo, b.ciHi]).filter((v): v is number => Number.isFinite(v))
    : [];
  const domain = finiteDomain([...valueLists, ciExtents]);
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const slots = categorySlots(d.points.length);
  drawCategoryAxis(ctx, rect, slots, d.points.map((g) => g.label), d.groupLabel, ink, muted);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.points.forEach((g, i) => {
    const slot = slots[i];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = seriesColor(i);

    drawJitteredPoints(ctx, g, cx, hw, vy, color, 0.85);
    const b = d.boxes[i];
    if (d.showMeanCI && b) drawMeanCIMarker(ctx, cx, b, vy, ink);

    drawCountLabel(ctx, cx, rect.y, g.points.length, muted);
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of the
  // jittered points.
  if (d.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink);
}
