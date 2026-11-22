// Where the significance brackets / compact letters go on a categorical draw
// (gap audit 8 lane SIG). Pure: turns a `StatComparisonsResult` (which pairs,
// which letters) and the draw (where each group sits, how high it reaches)
// into `ComparisonMarks` — brackets and letters in the plot's own units (axis
// slot, data-value y). The canvas paints that (`statDrawComparisons`) and the
// export posts it verbatim (`calc.figure_stat_comparisons` draws it), so the
// layout exists once and screen and figure cannot disagree.
//
// LAYOUT (all heights are fractions of the draw's own value span, taken from
// its value domain BEFORE comparisons are added, so adding them is not
// circular):
//   * every bracket sits `GAP` above the tallest group it spans; where it
//     overlaps (shares an axis slot with) an already placed bracket it goes
//     one `STEP` above that one. Shorter spans are placed first, so the
//     nested ones stay inside the wide ones;
//   * a bracket's label sits above its line (`TEXT` of headroom);
//   * letters sit `GAP` above their own group's top.
// The value domain grows to `top` (`statDrawMarks` folds it in), so nothing
// is ever clipped.

import {
  starsOf, bracketLabel, type ComparisonMarks, type StatComparisonsResult,
} from "../../lib/statComparisons";
import {
  barDomain, barErrorHalf, boxValueDomain, drawMarks, stripValueDomain, summaryExtents, violinValueDomain,
} from "./statDrawMarks";
import type { StatDrawData } from "./statRender";
import { slotPlan } from "./statRenderSlots";

export type CategoricalDraw = Extract<StatDrawData, { mode: "box" | "strip" | "violin" | "bar" }>;

const GAP = 0.03;
const STEP = 0.075;
const TEXT = 0.06;
const TICK = 0.02;

export function isCategorical(d: StatDrawData | null): d is CategoricalDraw {
  return !!d && (d.mode === "box" || d.mode === "strip" || d.mode === "violin" || d.mode === "bar");
}

/** The draw as it was before comparisons were added. */
function bare(d: CategoricalDraw): CategoricalDraw {
  return { ...d, comparisons: null } as CategoricalDraw;
}

/** One entry per DRAWN group (the draw's own group order): the highest value
 *  the group reaches, or NaN. */
export function groupTops(d: CategoricalDraw): number[] {
  const m = drawMarks(d);
  const max = (v: number[]) => Math.max(-Infinity, ...v.filter(Number.isFinite));
  const top = (v: number[]) => { const t = max(v); return t === -Infinity ? NaN : t; };
  if (d.mode === "box") return d.boxes.map((b) => top([b.whishi, ...b.fliers, ...summaryExtents(b, m)]));
  if (d.mode === "strip") {
    return d.points.map((g, i) => top([...g.points.map((p) => p.value), ...(d.boxes[i] ? summaryExtents(d.boxes[i], m) : [])]));
  }
  if (d.mode === "violin") {
    return d.violins.map((v, i) => top([v.x[v.x.length - 1] ?? NaN, ...(d.boxes?.[i] ? summaryExtents(d.boxes[i], m) : [])]));
  }
  return d.data.groups.map((g) => {
    const s = g.series[0];
    if (!s || !Number.isFinite(s.mean)) return NaN;
    return top([s.mean, s.mean + barErrorHalf(d, s, m), ...(s.raw && m.points !== "none" ? s.raw.points.map((p) => p.value) : [])]);
  });
}

/** The axis slot of each drawn group. */
export function groupSlots(d: CategoricalDraw): number[] {
  if (d.mode === "bar") return d.data.groups.map((_, i) => i);
  const labels = d.mode === "box" ? d.boxes.map((b) => b.label) : d.mode === "strip" ? d.points.map((g) => g.label) : d.violins.map((v) => v.label);
  return slotPlan(d.slots, labels).groupSlot;
}

/** The draw's value span before comparisons. */
function span(d: CategoricalDraw): number {
  const b = bare(d);
  const m = drawMarks(b);
  const [lo, hi] =
    b.mode === "box" ? boxValueDomain(b.boxes, m) : b.mode === "strip" ? stripValueDomain(b)
      : b.mode === "violin" ? violinValueDomain(b, m) : barDomain(b, m);
  return hi - lo;
}

function meanMatches(m: number, v: readonly number[]): boolean {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.abs(m - mean) <= 1e-9 * (1 + Math.abs(mean));
}

/** Which drawn group each COMPARED group is (`values.length` / label check
 *  against the draw), or null when the draw is not the one these statistics
 *  were computed for. Fail closed: a mismatch draws nothing. */
export function alignGroups(
  d: CategoricalDraw, groups: readonly { label: string; values: readonly number[] }[],
): number[] | null {
  if (d.mode !== "bar") {
    const ns = d.mode === "box" || d.mode === "strip" ? (d.mode === "box" ? d.boxes.map((b) => b.n) : d.points.map((g) => g.points.length))
      : d.violins.map((v) => v.n);
    // n AND mean (where the draw carries box stats) must agree group by group: a reordered or
    // different set of the same sizes is refused rather than marked on the wrong boxes.
    const means = d.mode === "violin" ? d.boxes?.map((b) => b.mean) : d.boxes.map((b) => b.mean);
    const ok = ns.length === groups.length && ns.every((n, i) => n === groups[i].values.length) &&
      (!means || means.every((m, i) => meanMatches(m, groups[i].values)));
    return ok ? groups.map((_, i) => i) : null;
  }
  // Bar category labels are the bar matrix's own ("A"), the tested groups' the
  // grouping's ("grp = A"), so match the non-empty categories IN ORDER on what
  // the two compute independently: n and mean. Any disagreement refuses.
  const drawn = d.data.groups.flatMap((x, i) => ((x.series[0]?.n ?? 0) > 0 ? [i] : []));
  if (drawn.length !== groups.length) return null;
  const same = drawn.every((at, k) => {
    const s = d.data.groups[at].series[0];
    return s.n === groups[k].values.length && meanMatches(s.mean, groups[k].values);
  });
  return same ? drawn : null;
}

/** Brackets / letters for `r`, `idx[g]` being compared group g's drawn-group index. */
export function layoutComparisons(d: CategoricalDraw, r: StatComparisonsResult, idx: readonly number[]): ComparisonMarks {
  const tops = groupTops(d);
  const slots = groupSlots(d);
  const s = span(d);
  const gap = GAP * s;
  const step = STEP * s;
  const textH = TEXT * s;
  const brackets: ComparisonMarks["brackets"] = [];
  const letters: ComparisonMarks["letters"] = [];
  let top = -Infinity;
  if (r.display === "brackets") {
    const sig = r.pairs
      .filter((p) => starsOf(p.p) !== "")
      .map((p) => ({ p: p.p, lo: Math.min(slots[idx[p.a]], slots[idx[p.b]]), hi: Math.max(slots[idx[p.a]], slots[idx[p.b]]) }))
      .filter((p, i, all) => p.lo !== p.hi && all.findIndex((q) => q.lo === p.lo && q.hi === p.hi) === i) // no flat or doubled brackets
      .sort((x, y) => x.hi - x.lo - (y.hi - y.lo) || x.lo - y.lo || x.hi - y.hi);
    const placed: { lo: number; hi: number; y: number }[] = [];
    for (const p of sig) {
      const spanned = slots.flatMap((sl, g) => (sl >= p.lo && sl <= p.hi && Number.isFinite(tops[g]) ? [tops[g]] : []));
      if (!spanned.length) continue;
      let y = Math.max(...spanned) + gap;
      for (const o of placed) if (o.lo <= p.hi && p.lo <= o.hi) y = Math.max(y, o.y + step);
      placed.push({ lo: p.lo, hi: p.hi, y });
      brackets.push({ a: p.lo, b: p.hi, y, label: bracketLabel(p.p, r.exact) });
      top = Math.max(top, y + textH);
    }
  } else if (r.letters) {
    r.letters.forEach((text, g) => {
      const t = tops[idx[g]];
      if (!Number.isFinite(t)) return;
      letters.push({ slot: slots[idx[g]], y: t + gap, text });
      top = Math.max(top, t + gap + textH);
    });
  }
  const none = r.display === "brackets" && !brackets.length ? "; no pair significant" : "";
  return { note: r.note + none, brackets, letters, tick: TICK * s, top: Number.isFinite(top) ? top : NaN };
}
