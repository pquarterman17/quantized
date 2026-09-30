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
import { isOutlier, type ResolvedStatMarks, type StatPointsMode } from "../../lib/statMarks";
import {
  boxStatsClient,
  connectMeansBreaks,
  connectMeansSeries,
  type BoxStat,
  type CategorySlot,
} from "../../lib/statstage";
import { glyphColor } from "../../lib/statColor";
import {
  axisStyleOf,
  boxValueDomain,
  drawMarks,
  stripValueDomain,
  summaryErrorBounds,
} from "./statDrawMarks";
import {
  cssVar,
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
 *  visible point. `jitterFrac` 0 puts every point on the centre line.
 *  `which` (P2.6 box 1): "outliers" draws only the values outside the Tukey
 *  whiskers — `fences` when given (the backend's box stats), else the
 *  group's own (`boxStatsClient`, the same algorithm); the export's
 *  `calc.figure_stat_marks.scatter_points` applies the same rule. */
export function drawJitteredPoints(
  ctx: CanvasRenderingContext2D,
  group: BoxPointsGroup,
  cx: number,
  halfWidth: number,
  vy: (v: number) => number,
  color: string,
  jitterFrac = 0.7,
  /** P2.6 box 4: rows of the linked selection (original dataset rows, the
   *  points' own `rowIndex` space) — drawn opaque with an accent ring, after
   *  the rest. */
  selected?: ReadonlySet<number> | null,
  which: StatPointsMode = "all",
  fences?: Pick<BoxStat, "whislo" | "whishi">,
) {
  if (which === "none" || !group.points.length) return;
  const f = which === "outliers" ? (fences ?? boxStatsClient(group.points.map((p) => p.value))) : null;
  const shown = f ? group.points.filter((p) => isOutlier(p.value, f)) : group.points;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  const at = (p: { rowIndex: number }) => cx + deterministicJitter(p.rowIndex, group.label) * halfWidth * jitterFrac;
  for (const p of shown) {
    ctx.beginPath();
    ctx.arc(at(p), vy(p.value), 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (!selected?.size) return;
  ctx.strokeStyle = cssVar("--accent", color);
  ctx.lineWidth = 1.5;
  for (const p of shown) {
    if (!selected.has(p.rowIndex)) continue;
    ctx.beginPath();
    ctx.arc(at(p), vy(p.value), 3.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

/** The summary glyph alone, in `ink`: a diamond (mean) or a 7-px square
 *  (median) centred on (`cx`, `y`). Shared by the box family's marker below
 *  and the grouped bars' (`statRenderBar.drawBarCellMarks`), so one glyph
 *  means one statistic everywhere. */
export function drawSummaryGlyph(
  ctx: CanvasRenderingContext2D, cx: number, y: number, kind: "mean" | "median", ink: string,
) {
  ctx.fillStyle = ink;
  if (kind === "median") {
    ctx.fillRect(cx - 3.5, y - 3.5, 7, 7);
    return;
  }
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(cx, y - r);
  ctx.lineTo(cx + r, y);
  ctx.lineTo(cx, y + r);
  ctx.lineTo(cx - r, y);
  ctx.closePath();
  ctx.fill();
}

/** The summary marker (JMP_GAP J5 #2, generalised by P2.6 box 1): a diamond
 *  at the mean with its error bar (SD / SE / 95% CI, `statDrawMarks.
 *  summaryErrorBounds` — none below n=2) or a square at the median, always
 *  in `ink` so it reads against any series color. The export draws the same
 *  glyphs from the same box stats (`calc.figure_stat_marks.overlay_summary`).
 *  Box, strip and (P2.6 box 1, second pass) violin. */
export function drawSummaryMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  b: BoxStat,
  vy: (v: number) => number,
  ink: string,
  m: ResolvedStatMarks,
) {
  if (m.summary === "none") return;
  const centre = m.summary === "mean" ? b.mean : b.median;
  if (!Number.isFinite(centre)) return;
  const bounds = m.summary === "mean" ? summaryErrorBounds(b, m) : null;
  if (bounds && bounds[0] !== bounds[1]) {
    const [lo, hi] = bounds;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, vy(lo));
    ctx.lineTo(cx, vy(hi));
    const capW = 4;
    ctx.moveTo(cx - capW, vy(lo));
    ctx.lineTo(cx + capW, vy(lo));
    ctx.moveTo(cx - capW, vy(hi));
    ctx.lineTo(cx + capW, vy(hi));
    ctx.stroke();
  }
  drawSummaryGlyph(ctx, cx, vy(centre), m.summary, ink);
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
  /** Review finding 4: the STRUCTURAL nesting signal (`StatDrawData.
   *  nestLabel`) `connectMeansBreaks` needs — never read off `boxes[i].
   *  label`'s own text. */
  nestLabel: string | null | undefined = null,
) {
  const means = connectMeansSeries(boxes);
  // Review finding 2: under NESTED grouping the line must not run across an
  // outer-factor boundary — see `connectMeansBreaks` for why that reading is
  // wrong. Non-nested plots get exactly one segment, as before.
  const breaks = connectMeansBreaks(boxes, nestLabel).map((b, i) => b || gaps[i] === true);
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
  drawCategoryAxis(ctx, rect, plan.slots, plan.labels, d.groupLabel, ink, muted, axisStyleOf(d));
  drawEmptySlotMarkers(ctx, rect, plan.slots, plan.empty, muted);
  if (d.showN !== false) drawSlotCounts(ctx, rect, plan, groupN, muted);
  return plan;
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
  const m = drawMarks(d);
  const domain = boxValueDomain(d.boxes, m);
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const plan = drawGroupAxis(ctx, rect, d, d.boxes.map((b) => b.label), d.boxes.map((b) => b.n), ink, muted);
  const slots = plan.groupSlot.map((i) => plan.slots[i]);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.boxes.forEach((b, i) => {
    const slot = slots[i];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = glyphColor(d.colorLevels, i);

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

    // Fliers ARE the "outliers" points (P2.6 box 1): drawn at the centre
    // line, as matplotlib's boxplot does. "all" draws every point jittered
    // instead (a flier is one of them), "none" neither.
    if (m.points === "outliers" || m.legacyFliers) {
      ctx.fillStyle = color;
      for (const f of b.fliers) {
        ctx.beginPath();
        ctx.arc(cx, vy(f), 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    const pointsGroup = d.points?.[i];
    if (pointsGroup && m.points === "all") {
      drawJitteredPoints(ctx, pointsGroup, cx, hw, vy, color, m.jitterWidth, d.selectedRows);
    }
    drawSummaryMarker(ctx, cx, b, vy, ink, m);
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of
  // every box glyph.
  if (m.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink, plan.gaps, d.nestLabel);
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
  const m = drawMarks(d);
  const domain = stripValueDomain(d);
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
    const color = glyphColor(d.colorLevels, i);

    const b = d.boxes[i];
    drawJitteredPoints(ctx, g, cx, hw, vy, color, m.jitterWidth, d.selectedRows, m.points, b);
    if (b) drawSummaryMarker(ctx, cx, b, vy, ink, m);
  });

  // Connect-means line last (JMP_GAP J5 residual) so it draws on top of the
  // jittered points.
  if (m.connectMeans) drawConnectMeansLine(ctx, d.boxes, slots, rect, vy, ink, plan.gaps, d.nestLabel);
}
