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
  connectMeansBreaks,
  connectMeansSeries,
  finiteDomain,
  type BoxStat,
  type CategorySlot,
} from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";
import {
  drawCategoryAxis,
  drawValueAxis,
  type BoxPointsGroup,
  type Rect,
  type StatDrawData,
} from "./statRender";
import { drawEmptySlotMarkers, drawSlotCounts, slotPlan, type SlotPlan } from "./statRenderSlots";

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
export function drawConnectMeansLine(
  ctx: CanvasRenderingContext2D,
  boxes: readonly BoxStat[],
  slots: readonly CategorySlot[],
  rect: Rect,
  vy: (v: number) => number,
  ink: string,
  /** P2.6 box 2: true where an EMPTY axis slot (shown or hidden) sits before
   *  box i — the line lifts there too (`SlotPlan.gaps`; export:
   *  `calc.figure_group_notes.connect_segments`). */
  gaps: readonly boolean[] = [],
) {
  const means = connectMeansSeries(boxes);
  // Review finding 2: under NESTED grouping the line must not run across an
  // outer-factor boundary — see `connectMeansBreaks` for why that reading is
  // wrong. Non-nested plots get exactly one segment, as before.
  const breaks = connectMeansBreaks(boxes).map((b, i) => b || gaps[i] === true);
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
    if (started && !breaks[i]) ctx.lineTo(cx, cy);
    else ctx.moveTo(cx, cy);
    started = true;
  });
  ctx.stroke();
  ctx.restore();
}

/** The category axis, the empty-slot markers and the optional `n=` captions
 *  for a box/strip draw — one call so both modes lay out identically. The
 *  returned plan's `slots[groupSlot[i]]` is group i's slot. */
function drawGroupAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "box" | "strip" }>,
  labels: readonly string[],
  groupN: readonly number[],
  ink: string,
  muted: string,
): SlotPlan {
  const plan = slotPlan(d.slots, labels);
  drawCategoryAxis(ctx, rect, plan.slots, plan.labels, d.groupLabel, ink, muted);
  drawEmptySlotMarkers(ctx, rect, plan.slots, plan.empty, muted);
  if (d.showN !== false) drawSlotCounts(ctx, rect, plan, groupN, muted);
  return plan;
}

// ── Box (+ optional points / mean-CI overlays) ──────────────────────────────

/** Value domain for box mode: whiskers union fliers spans every raw data
 *  point (Tukey's own definition), so the points overlay never needs its own
 *  domain contribution. The mean-CI marker is NOT a data point, though: at
 *  small n the t-based interval extends far past the whiskers
 *  (t(0.975,1)=12.7) and nothing clips the canvas to the plot rect -- so
 *  fold the CI extents in when the marker is shown, exactly as drawStrip
 *  does. Exported pure so the jsdom suite can pin it (raster tests can't). */
export function boxValueDomain(
  boxes: readonly BoxStat[],
  showMeanCI: boolean | undefined,
): [number, number] {
  const ciExtents = showMeanCI
    ? boxes.flatMap((b) => [b.ciLo, b.ciHi]).filter((v): v is number => Number.isFinite(v))
    : [];
  return finiteDomain([...boxes.map((b) => [b.whislo, b.whishi, ...b.fliers]), ciExtents]);
}

export function drawBoxesWithMarks(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "box" }>,
  ink: string,
  muted: string,
) {
  if (!d.boxes.length) return;
  const domain = boxValueDomain(d.boxes, d.showMeanCI);
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const plan = drawGroupAxis(ctx, rect, d, d.boxes.map((b) => b.label), d.boxes.map((b) => b.n), ink, muted);
  const slots = plan.groupSlot.map((i) => plan.slots[i]);

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
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of
  // every box glyph.
  if (d.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink, plan.gaps);
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
  const plan = drawGroupAxis(
    ctx, rect, d, d.points.map((g) => g.label), d.points.map((g) => g.points.length), ink, muted,
  );
  const slots = plan.groupSlot.map((i) => plan.slots[i]);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.points.forEach((g, i) => {
    const slot = slots[i];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = seriesColor(i);

    drawJitteredPoints(ctx, g, cx, hw, vy, color, 0.85);
    const b = d.boxes[i];
    if (d.showMeanCI && b) drawMeanCIMarker(ctx, cx, b, vy, ink);
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of the
  // jittered points.
  if (d.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink, plan.gaps);
}
