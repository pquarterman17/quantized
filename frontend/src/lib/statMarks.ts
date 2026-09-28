// Categorical-plot marks (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 1): raw-point
// visibility, jitter, the summary marker and its error bars, and the category
// labels (rotation / wrapping / the two-tier nested axis). Pure — no DOM, no
// store — so the Canvas stage, the export spec and the tests all read ONE
// resolution of the persisted `PlotView.statMarks` (sanitized on load by
// `lib/plotviewSanitize.sanitizeStatMarks`, whose types this re-exports).
//
// THE CONVENTIONS, pinned once and held to the backend by shared fixtures
// (`tests/fixtures/wire/stat_error_bars.json`, `stat_label_wrap.json`, read by
// both `statMarks.test.ts` and `tests/test_calc_figure_stat_marks.py`):
//   * SD   = sample standard deviation, n-1 denominator;
//   * SE   = SD / sqrt(n);
//   * 95% CI = mean -/+ t(0.975, n-1) * SE (two-sided Student t);
//   * every error bar is about the MEAN and needs n >= 2 (none below);
//   * "outliers" = values outside the Tukey 1.5 IQR whiskers (`BoxStat.
//     whislo/whishi`), the rule the box's own fliers use.
// The backend twin is `calc.statplots.error_bar_bounds` +
// `calc.figure_stat_marks` + `calc.figure_category_axis`.
//
// Lazy-only on purpose: the eager bundle carries just the sanitizer.

import type { StatMarks, StatErrorBars, StatPointsMode, StatSummaryMark } from "./plotviewSanitize";
import type { BoxStat, StatMode } from "./statstage";
import { NESTED_LABEL_SEP } from "./statschooser";
import { tCritical95 } from "./tdist";

export type { StatMarks, StatErrorBars, StatPointsMode, StatSummaryMark } from "./plotviewSanitize";

/** Every option resolved for one mode — what the renderer and the export read. */
export interface ResolvedStatMarks {
  points: StatPointsMode;
  /** Jitter half-spread as a fraction of the glyph half-width; 0 = no jitter. */
  jitterWidth: number;
  summary: StatSummaryMark;
  errorBars: StatErrorBars;
  connectMeans: boolean;
  labelRotation: 0 | 45 | 90;
  labelWrap: boolean;
}

/** Characters per line when category labels wrap (screen and export). With
 *  wrapping off a label is drawn WHOLE on one line on both sides — the screen
 *  cuts it only when the canvas cannot hold a rotated label at all
 *  (`Stage/statRenderAxes.categoryAxisLayout`'s cap). */
export const LABEL_WRAP_WIDTH = 12;
/** Wrapped labels keep at most this many lines (the last one ellipsized). */
export const MAX_WRAP_LINES = 3;

/** The jitter width each mode shows unless the user picks one — the values
 *  the box / strip overlays have always used. */
export function defaultJitterWidth(mode: StatMode): number {
  return mode === "strip" ? 0.85 : 0.7;
}

/** The raw points each mode shows by default: box its outliers (fliers),
 *  strip every point (it has no other glyph), violin none. */
export function defaultPoints(mode: StatMode): StatPointsMode {
  return mode === "strip" ? "all" : mode === "box" ? "outliers" : "none";
}

/** Resolve the persisted (sparse) marks for `mode`. Bar's error bars
 *  default to SE (its long-standing mean +/- SEM); box / strip's to the 95% CI
 *  (the mean marker's long-standing interval). */
export function resolveStatMarks(mode: StatMode, m: StatMarks | null | undefined): ResolvedStatMarks {
  const marks = m ?? {};
  return {
    points: marks.points ?? defaultPoints(mode),
    jitterWidth: marks.jitter === false ? 0 : (marks.jitterWidth ?? defaultJitterWidth(mode)),
    summary: marks.summary ?? "none",
    errorBars: marks.errorBars ?? (mode === "bar" ? "se" : "ci95"),
    connectMeans: marks.connectMeans ?? false,
    labelRotation: marks.labelRotation ?? 0,
    labelWrap: marks.labelWrap ?? false,
  };
}

/** Error-bar half-width about the mean from (SE, n): `se` itself, `sd` =
 *  SE*sqrt(n), `ci95` = t(0.975, n-1)*SE. NaN = no bar (kind "none", n < 2,
 *  or a non-finite SE). Bar mode's per-series stats carry exactly (mean, SE,
 *  n), so this is the one formula both its screen and its export use. */
export function errorHalfWidth(kind: StatErrorBars, sem: number, n: number): number {
  if (kind === "none" || n < 2 || !Number.isFinite(sem)) return NaN;
  if (kind === "se") return sem;
  if (kind === "sd") return sem * Math.sqrt(n);
  return tCritical95(n - 1) * sem;
}

/** A group's error bar `[lo, hi]` about its mean, or null (none to draw).
 *  Reads the box stats' own `sd` / `sem` / `ciLo` / `ciHi` when present (the
 *  backend's numbers), deriving from the SE otherwise. */
export function errorBounds(b: BoxStat, kind: StatErrorBars): [number, number] | null {
  if (kind === "none" || b.n < 2 || !Number.isFinite(b.mean)) return null;
  if (kind === "ci95" && Number.isFinite(b.ciLo) && Number.isFinite(b.ciHi)) {
    return [b.ciLo as number, b.ciHi as number];
  }
  const sem = b.sem ?? NaN;
  const half = kind === "sd" && Number.isFinite(b.sd) ? (b.sd as number) : errorHalfWidth(kind, sem, b.n);
  return Number.isFinite(half) ? [b.mean - half, b.mean + half] : null;
}

const ERROR_BAR_NOTES: Record<Exclude<StatErrorBars, "none">, string> = {
  sd: "Error bars: SD",
  se: "Error bars: SE of the mean",
  ci95: "Error bars: 95% CI of the mean",
};

/** The footnote naming which error bar a figure draws, or null for "none".
 *  ONE text: the stage shows it under the plot and posts it verbatim as the
 *  export's `error_note` (`calc.figure_group_notes.footnote_text` stacks it
 *  above the caveat), so screen and figure cannot word it differently. ASCII
 *  only, like `groupAxis.balanceCaveat` — matplotlib typesets it. */
export function errorBarNote(kind: StatErrorBars): string | null {
  return kind === "none" ? null : ERROR_BAR_NOTES[kind];
}

/** Whether a value is outside the group's Tukey whiskers (a box flier). */
export function isOutlier(v: number, b: Pick<BoxStat, "whislo" | "whishi">): boolean {
  return v < b.whislo || v > b.whishi;
}

/** Greedy word wrap to `width` code points (a longer word hard-split), at
 *  most `maxLines` lines with the last ellipsized. The line-for-line twin of
 *  `calc.figure_category_axis.wrap_label`. */
export function wrapLabel(text: string, width = LABEL_WRAP_WIDTH, maxLines = MAX_WRAP_LINES): string[] {
  const w = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  let cur: string[] = [];
  for (const raw of text.split(" ")) {
    let word = Array.from(raw);
    if (!word.length) continue;
    while (word.length > w) {
      if (cur.length) lines.push(cur.join(""));
      cur = [];
      lines.push(word.slice(0, w).join(""));
      word = word.slice(w);
    }
    if (!word.length) continue;
    if (!cur.length) cur = word;
    else if (cur.length + 1 + word.length <= w) cur = [...cur, " ", ...word];
    else {
      lines.push(cur.join(""));
      cur = word;
    }
  }
  if (cur.length) lines.push(cur.join(""));
  if (!lines.length) return [""];
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = Array.from(kept[maxLines - 1]);
    kept[maxLines - 1] = (last.length >= w ? last.slice(0, w - 1).join("") : last.join("")) + "…";
    return kept;
  }
  return lines;
}

/** One maximal run of equal outer levels on a nested axis. */
export interface TierRun {
  label: string;
  first: number;
  last: number;
}

/** A nested axis's [outer, inner] pair, and its split into tiers — `inner`
 *  and `runs` (the consecutive equal outer halves) — or null.
 *
 *  Review finding 4: whether an axis IS nested is a STRUCTURAL fact (a nest
 *  column is active — the caller's `nestLabel`, `null` outside box/violin/
 *  strip with a second factor picked), never something read off the label
 *  TEXT. Sniffing for `NESTED_LABEL_SEP` in the string, as this used to,
 *  misreads a FLAT category value that happens to contain " / " (e.g.
 *  "Co / Pt") as a nested tick. `nestLabel` is the nest column's own display
 *  name, which also fixes the split ITSELF: a genuinely nested label is cut
 *  at ITS marker (`" / {nestLabel} = "`), not the first `NESTED_LABEL_SEP`
 *  in the string — so a NESTED outer level whose own text contains " / "
 *  (e.g. an alloy composition) groups correctly instead of being split
 *  inside its own name. The twin of `calc.figure_category_axis.
 *  nested_tiers`, which takes the pairs straight off the wire's
 *  `axis_style.tiers` rather than re-deriving them. */
export function nestedTiers(
  labels: readonly string[],
  nestLabel: string | null | undefined,
): { pairs: [string, string][]; inner: string[]; runs: TierRun[] } | null {
  if (!nestLabel || !labels.length) return null;
  const marker = `${NESTED_LABEL_SEP}${nestLabel} = `;
  const pairs: [string, string][] = [];
  const inner: string[] = [];
  const runs: TierRun[] = [];
  for (let i = 0; i < labels.length; i++) {
    const cut = labels[i].lastIndexOf(marker);
    if (cut < 0) return null;
    const outer = labels[i].slice(0, cut);
    const inr = labels[i].slice(cut + NESTED_LABEL_SEP.length);
    pairs.push([outer, inr]);
    inner.push(inr);
    const prev = runs[runs.length - 1];
    if (prev && prev.label === outer) prev.last = i;
    else runs.push({ label: outer, first: i, last: i });
  }
  return { pairs, inner, runs };
}

/** The export's `axis_style` for these marks, labels and nest column:
 *  `tiered` exactly when `nestLabel` says the axis IS nested (never sniffed
 *  off the label text — see `nestedTiers`), and `tiers` carries the actual
 *  [outer, inner] pairs so the backend never re-splits the composite string
 *  either. Null when nothing is set, so an untouched plot posts the request
 *  it always did. */
export function axisStyleWire(
  r: ResolvedStatMarks,
  labels: readonly string[],
  nestLabel: string | null | undefined,
): { rotation: 0 | 45 | 90; wrap: number | null; tiered: boolean; tiers?: [string, string][] } | null {
  const tiers = nestedTiers(labels, nestLabel);
  const tiered = tiers !== null;
  if (!tiered && !r.labelWrap && r.labelRotation === 0) return null;
  return {
    rotation: r.labelRotation, wrap: r.labelWrap ? LABEL_WRAP_WIDTH : null, tiered,
    ...(tiers ? { tiers: tiers.pairs } : {}),
  };
}
