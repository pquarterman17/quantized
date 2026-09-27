// What a categorical stat draw SHOWS (P2.6 box 1) — its resolved marks, its
// category-axis label options, and the value domain / error extents that
// follow from them. Pure, and shared by every consumer that must agree with
// the painter: the renderers (`statRenderBox`, `statRenderBar`, `statRender`),
// the click hit-test (`statRenderSelection`, which used to keep a private copy
// of each domain rule), and the plot rect's bottom margin.
//
// A draw built by the stage carries `marks` (`lib/statMarks.resolveStatMarks`
// over the persisted `PlotView.statMarks`), which is ALWAYS the case in
// production (`statStageMarks.withMarks` stamps it on every non-qq/histogram
// draw unconditionally). A draw without one — a test that builds a minimal
// `StatDrawData` by hand — falls back to the mode's own plain defaults
// (review finding 9: the pre-P2.6-box-1 legacy flags `showMeanCI`/
// `connectMeans` this used to sniff for are gone from the type entirely;
// every test that needs non-default behaviour sets `marks` directly now).

import type { BarSeriesStat } from "../../lib/barlayout";
import { stackedTotal } from "../../lib/barlayout";
import { resolveStatMarks, errorBounds, errorHalfWidth, type ResolvedStatMarks } from "../../lib/statMarks";
import { finiteDomain, type BoxStat } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import type { CategoryAxisStyle } from "./statRenderAxes";
import { slotPlan } from "./statRenderSlots";

type Categorical = Extract<StatDrawData, { mode: "box" | "strip" | "violin" | "bar" }>;

/** `legacyFliers` is always false now (review finding 9) — kept on the type
 *  rather than removed so every existing `DrawMarks` consumer (comparisons,
 *  destructuring) stays byte-identical; a later pass can drop the field
 *  itself once nothing reads it. */
export interface DrawMarks extends ResolvedStatMarks {
  legacyFliers: boolean;
}

/** The marks `d` is drawn with. */
export function drawMarks(d: Categorical): DrawMarks {
  if (d.marks) return { ...d.marks, legacyFliers: false };
  return { ...resolveStatMarks(d.mode, null), legacyFliers: false };
}

/** The category-axis label options `d` is drawn with. */
export function axisStyleOf(d: StatDrawData | null): CategoryAxisStyle {
  const nestLabel = d && "nestLabel" in d ? d.nestLabel : null;
  if (!d || !("marks" in d) || !d.marks) return { nestLabel };
  return { rotation: d.marks.labelRotation, wrap: d.marks.labelWrap, nestLabel };
}

/** The tick labels `d` draws, one per AXIS slot (empty slots included). */
export function axisLabelsOf(d: StatDrawData | null): string[] {
  if (!d) return [];
  if (d.mode === "bar") return d.data.groups.map((g) => g.label);
  if (d.mode === "box") return slotPlan(d.slots, d.boxes.map((b) => b.label)).labels;
  if (d.mode === "strip") return slotPlan(d.slots, d.points.map((g) => g.label)).labels;
  if (d.mode === "violin") return slotPlan(d.slots, d.violins.map((v) => v.label)).labels;
  return [];
}

/** The summary marker's error bar for one group, or null. */
export function summaryErrorBounds(b: BoxStat, m: ResolvedStatMarks): [number, number] | null {
  return m.summary === "mean" ? errorBounds(b, m.errorBars) : null;
}

/** Every value the summary marker reaches for one group (its centre and its
 *  error bar) — folded into the value domain, since at small n a t-based CI
 *  reaches far past the whiskers and nothing clips the canvas. */
export function summaryExtents(b: BoxStat, m: ResolvedStatMarks): number[] {
  if (m.summary === "none") return [];
  const centre = m.summary === "mean" ? b.mean : b.median;
  return [centre, ...(summaryErrorBounds(b, m) ?? [])].filter((v) => Number.isFinite(v));
}

/** Box mode's value domain: whiskers and fliers span every raw datum
 *  (Tukey's definition), so the points overlay adds nothing; the summary
 *  marker is folded in when shown. */
export function boxValueDomain(boxes: readonly BoxStat[], m: ResolvedStatMarks): [number, number] {
  return finiteDomain([...boxes.map((b) => [b.whislo, b.whishi, ...b.fliers]), boxes.flatMap((b) => summaryExtents(b, m))]);
}

/** Strip mode's value domain: every point (drawn or not, so hiding points
 *  never rescales the plot) plus the summary marker. */
export function stripValueDomain(d: Extract<StatDrawData, { mode: "strip" }>): [number, number] {
  const m = drawMarks(d);
  return finiteDomain([...d.points.map((g) => g.points.map((p) => p.value)), d.boxes.flatMap((b) => summaryExtents(b, m))]);
}

/** A bar's error-bar half-width under `d`'s error-bar kind (NaN: none).
 *  Review finding 10: takes the ALREADY-resolved marks (`m`) when the
 *  caller has one (a loop over many groups/series shares ONE `drawMarks(d)`
 *  rather than re-deriving it — cheap on its own, but re-allocated once per
 *  series/group otherwise); omitted, it resolves `d`'s own, byte-identical
 *  to before this fix. */
export function barErrorHalf(
  d: Extract<StatDrawData, { mode: "bar" }>, s: BarSeriesStat, m: DrawMarks = drawMarks(d),
): number {
  return errorHalfWidth(m.errorBars, s.sem, s.n);
}

/** Every extent bar mode draws (bar tops/bottoms, error whiskers, 0) — the
 *  candidates `barValueDomain` spans. Review finding 10: resolves `d`'s
 *  marks ONCE (or takes the caller's own, e.g. `statRenderBar.drawBar`'s,
 *  so the two never re-derive it separately) and shares it across every
 *  group/series' `barErrorHalf`, rather than once per call. */
export function barDomainCandidates(
  d: Extract<StatDrawData, { mode: "bar" }>, m: DrawMarks = drawMarks(d),
): number[] {
  const out: number[] = [0];
  for (const g of d.data.groups) {
    if (d.stacked) {
      const total = stackedTotal(g.series);
      out.push(total);
      const last = g.series[g.series.length - 1];
      const half = last ? barErrorHalf(d, last, m) : NaN;
      if (Number.isFinite(half)) out.push(total + half, total - half);
    } else {
      for (const s of g.series) {
        if (!Number.isFinite(s.mean)) continue;
        out.push(s.mean);
        const half = barErrorHalf(d, s, m);
        if (Number.isFinite(half)) out.push(s.mean + half, s.mean - half);
      }
    }
  }
  return out;
}
