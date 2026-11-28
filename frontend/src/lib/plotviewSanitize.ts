// Field sanitizers for a persisted PlotView, moved out of `lib/plotview.ts`
// (P2.6 box 2) when the Stat Stage's two persisted display options
// (`statHideEmptyLevels`/`statShowGroupN`) became PlotView fields: that module
// sits on a line pin, and it and this one are both in the EAGER bundle, which
// has almost no headroom. So the move had to fund bytes as well as lines:
//
//   * `sanitizeRegionShades` — moved whole (lines only). The `.dwk` loader
//     (`plotview.sanitizePlotView`) and the recipe importer (`plotRecipeIO.ts`)
//     both call it, so the two can never disagree about a well-formed shade.
//   * `boolViewFields` — the plain-boolean fields in ONE loop instead of one
//     `boolOrDefault(o.x, fb.x)` per field. Each field now costs its key
//     string once rather than three times, which is what paid for the two new
//     fields' eager bytes (measured with `scripts/profile-eager-bundle.mjs`).

import type { PlotView } from "./plotview";
import { sanitizeRugPick, type CdfY, type RugPick } from "./statCdf";
import type { StatMode } from "./statstage";
import type { RegionShade } from "./types";

export { uniqueIds } from "./uniqueIds";

/** Persisted legend pixel dimensions. Clamp edited/stale workspaces to a
 * useful range while preserving the user's exact size inside it. */
export function sanitizeLegendSize(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  if (!v.every(Number.isFinite)) return null; // Number.isFinite is false for non-numbers too
  return [Math.min(2000, Math.max(96, v[0])), Math.min(2000, Math.max(40, v[1]))];
}

/** P2.6 box 1 — the Stat Stage's categorical-plot marks, persisted SPARSE on
 *  `PlotView.statMarks` (absent = the mode's default; `lib/statMarks.
 *  resolveStatMarks` owns the defaults and the meaning of every field). */
export type StatPointsMode = "all" | "outliers" | "none";
export type StatSummaryMark = "none" | "mean" | "median";
/** "column" (bar mode only): each whisker is the value of the bar's bound
 *  error COLUMN (`lib/barMatrix.withColumnErrors`), not a statistic. */
export type StatErrorBars = "none" | "sd" | "se" | "ci95" | "column";
export interface StatMarks {
  points?: StatPointsMode;
  jitter?: boolean;
  /** Fraction of the glyph half-width, (0, 1]. */
  jitterWidth?: number;
  summary?: StatSummaryMark;
  errorBars?: StatErrorBars;
  connectMeans?: boolean;
  labelRotation?: 0 | 45 | 90;
  labelWrap?: boolean;
  /** Significance brackets / compact letters over the groups (opt-in; absent =
   *  "off"). See `lib/statComparisons`. */
  comparisons?: "off" | "brackets" | "letters";
  compareMethod?: "tukey" | "dunnett";
  /** Dunnett's control group, by LABEL (absent = the first group). */
  compareControl?: string;
  /** Show the exact adjusted p beside the stars. */
  compareExact?: boolean;
  /** Significance marks from supplied p-values (plan item 23). Held as saved; `lib/sigMarks.normalizeSig`
   *  validates it where it is read (lazy), so the eager sanitizer stays small. */
  sig?: unknown;
}

const STAT_MARK_VALUES: Record<string, readonly unknown[]> = {
  points: ["all", "outliers", "none"], jitter: [true, false], summary: ["none", "mean", "median"],
  errorBars: ["none", "sd", "se", "ci95", "column"], connectMeans: [true, false], labelRotation: [0, 45, 90],
  labelWrap: [true, false], comparisons: ["off", "brackets", "letters"], compareMethod: ["tukey", "dunnett"],
  compareExact: [true, false],
};

/** A persisted `statMarks`, keeping only well-formed fields (an unknown or
 *  out-of-range value falls back to the mode default by being dropped).
 *  Never throws. */
export function sanitizeStatMarks(v: unknown): StatMarks {
  const out: Record<string, unknown> = {};
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    for (const k in STAT_MARK_VALUES) if (STAT_MARK_VALUES[k].includes(o[k])) out[k] = o[k];
    if (typeof o.jitterWidth === "number" && o.jitterWidth > 0 && o.jitterWidth <= 1) out.jitterWidth = o.jitterWidth;
    if (typeof o.compareControl === "string" && o.compareControl) out.compareControl = o.compareControl;
    if (typeof o.sig === "object" && o.sig) out.sig = o.sig;
  }
  return out as StatMarks;
}

/** Review finding 6: the categorical modes `statMarks` can carry a
 *  per-mode choice for — every mode a Stat Stage draw can be, MINUS qq/
 *  histogram, which take no marks at all (`statStageMarks.stamp`'s own
 *  narrowing). */
export type StatMarksMode = "box" | "violin" | "strip" | "bar";
const STAT_MARKS_MODES: readonly StatMarksMode[] = ["box", "violin", "strip", "bar"];

/** P2.6 box 1 (review finding 6): `PlotView.statMarks`'s ACTUAL persisted
 *  shape — one sparse `StatMarks` per mode, never one shared object. A
 *  single flat object let a choice in one mode silently become another
 *  mode's default (box's CI error bars leaking into bar's SE default,
 *  strip's `points: "none"` hiding box's fliers) purely because the two
 *  modes' resolvers both read the SAME stored fields. */
export type StatMarksByMode = { [K in StatMarksMode]?: StatMarks };

/** Every flat `StatMarks` field name, for detecting the PRE-migration shape
 *  below (a mode key never collides with one of these: `"box"`/`"violin"`/
 *  `"strip"`/`"bar"` are not `StatMarks` fields, and no `StatMarks` field
 *  names a mode). */
const FLAT_MARK_KEYS = [...Object.keys(STAT_MARK_VALUES), "jitterWidth"];

/** A persisted `PlotView.statMarks`, old (flat, pre-P2.6-review-finding-6)
 *  or new (per-mode) shape alike -- never throws.
 *
 *  MIGRATION (documented, per the review's own two options — "the mode
 *  active when saved" is not this one): a file with the flat shape predates
 *  `PlotView.statPicks` (the mode is persisted only since 2026-10-01), so
 *  there is no durable record of which mode a flat `statMarks` was last
 *  edited under, so that option is not available here. The safe fallback
 *  the review names instead — "to all only where safe" — is what this
 *  does: a legacy flat object is applied to EVERY mode's bucket. That is
 *  deliberately the ONE-TIME choice, not a general rule: before this fix,
 *  the single flat object already affected every mode identically (that
 *  read IS the bug), so broadcasting it once at migration is the only
 *  choice that changes nothing about how an already-saved plot looks the
 *  moment it is loaded under the new shape. Every edit FROM THEN ON goes
 *  through `setStatMarks(mode, patch)`, which never touches another mode's
 *  bucket again — the isolation this finding asks for holds for every
 *  write after migration, and the migration itself does not (need to)
 *  reproduce it. */
export function sanitizeStatMarksByMode(v: unknown): StatMarksByMode {
  if (typeof v !== "object" || v === null) return {};
  const o = v as Record<string, unknown>;
  const hasModeKey = STAT_MARKS_MODES.some((m) => m in o);
  const hasFlatKey = FLAT_MARK_KEYS.some((k) => k in o);
  if (!hasModeKey && hasFlatKey) {
    const flat = sanitizeStatMarks(o);
    const out: StatMarksByMode = {};
    for (const m of STAT_MARKS_MODES) out[m] = { ...flat };
    return out;
  }
  const out: StatMarksByMode = {};
  for (const m of STAT_MARKS_MODES) if (m in o) out[m] = sanitizeStatMarks(o[m]);
  return out;
}

/** The Q-Q / histogram-fit distributions and the histogram bin rules the Stat
 *  Stage offers (its pickers' option lists, re-exported by `useStatStage`). */
export const DISTRIBUTIONS = ["norm", "logistic", "laplace", "uniform"] as const;
export const BIN_RULES = ["fd", "sturges", "scott", "rice", "sqrt", "auto"] as const;
/** The marginal plot's strips, and the ridgeline's row overlap and KDE bandwidth
 *  (a rule, or scipy's numeric factor as text) — the Stat Stage's option lists. */
export const MARGINAL_KINDS = ["histogram", "box", "rug"] as const;
export const RIDGE_OVERLAPS = [0.8, 1, 1.5, 2, 3] as const;
export const RIDGE_BWS = ["scott", "silverman", "0.15", "0.3", "0.6"] as const;
/** Half / split violin, paired and lollipop options (item 20). */
/** "half" is the right half, "left" its mirror, "split" two levels back to back. */
export const VIOLIN_SIDES = ["half", "left", "split"] as const;
export const VIOLIN_MARKS = ["none", "median", "quartiles", "both"] as const;
export const LOLLIPOP_STATS = ["mean", "median"] as const;
export const LOLLIPOP_SORTS = ["none", "asc", "desc"] as const;
export const LOLLIPOP_WHISKERS = ["none", "sd", "sem", "ci"] as const;

/** A Stat Stage column pick as saved: `[channel index, its label]`, so a
 *  reopen can tell whether the column is still there (`lib/statPicks`). */
export type StatColRef = [number, string];
export interface StatPickCols {
  group: StatColRef | null;
  group2: StatColRef | null;
  value: StatColRef;
  facet: StatColRef | null;
  color: StatColRef | null;
}
/** The Stat Stage's picks, persisted SPARSE on `PlotView.statPicks` (absent =
 *  default; `cols` absent = the dataset's default columns). They were React
 *  state until 2026-10-01, so an older file simply has none. */
export interface StatPicks {
  mode?: StatMode;
  dist?: string;
  bins?: string;
  fit?: string | null;
  barStack?: boolean;
  /** A stacked bar chart normalised to 100 % per category (Origin's 100 %
   *  stacked column, `originFigureSelection.figureBarState`). */
  barPercent?: boolean;
  /** The bar chart's value-axis range (an Origin layer's decoded Y range);
   *  absent = autoscale. */
  valueRange?: [number, number];
  cols?: StatPickCols;
  /** Extra columns a histogram bins with the value column (one graph, shared
   *  bin edges); absent = the value column alone. */
  histCols?: number[];
  /** CDF plot (item 20): Y as a proportion (default) or a count; the DKW band.
   *  The fitted CDF reuses `fit`, further columns reuse `histCols`. */
  cdfY?: CdfY;
  cdfBand?: boolean;
  /** Rug ticks along X, histogram and CDF; absent = off (`lib/statCdf`). */
  rug?: RugPick;
  /** Marginal plot (item 20): what the strips draw (the Y column is `histCols[0]`,
   *  the bin rule reuses `bins`). A marginal save always carries it. */
  marginal?: (typeof MARGINAL_KINDS)[number];
  /** Ridgeline (item 20): row overlap (any number in (0, 5]) and KDE bandwidth ("scott", "silverman"
   *  or a positive factor as text); a ridgeline save always carries both. `ridgeEach` scales every
   *  ridge to its own peak (absent = one shared scale). `marginalColor` / `marginalSize`: the
   *  marginal plot's colour-by and size-by columns (absent = none). */
  ridgeOverlap?: number;
  ridgeBw?: string;
  ridgeEach?: boolean;
  marginalSize?: number;
  marginalColor?: number;
  /** Half / split violin, paired CI, lollipop and stacked histogram (item 20); each mode's save
   *  carries its own (`MODE_SEED`). The half / split violin reuses `ridgeBw`. */
  violinSide?: (typeof VIOLIN_SIDES)[number];
  pairedCi?: boolean;
  lollipopStat?: (typeof LOLLIPOP_STATS)[number];
  lollipopSort?: (typeof LOLLIPOP_SORTS)[number];
  histStack?: boolean;
  /** Item 20 variants: inner median / quartile lines, lines coloured by direction, categories on Y,
   *  and the histogram split (stacked) by the "group by" column. */
  violinMarks?: (typeof VIOLIN_MARKS)[number];
  pairedDirection?: boolean;
  lollipopHoriz?: boolean;
  histSplit?: boolean;
  /** Item 20 extras: a mean marker and raincloud points on the violin, the paired "no change" tolerance
   *  (absolute, 0 = exact equality), a 100 % split histogram, whiskers on the mean lollipop. */
  violinMean?: boolean;
  violinRain?: boolean;
  pairedTol?: number;
  histPercent?: boolean;
  lollipopWhisker?: (typeof LOLLIPOP_WHISKERS)[number];
}

const STAT_PICK_VALUES: Record<string, readonly unknown[]> = {
  mode: ["box", "violin", "qq", "histogram", "bar", "strip", "cdf", "marginal", "ridgeline", "sideviolin", "paired", "lollipop"], dist: DISTRIBUTIONS, bins: BIN_RULES,
  fit: [null, ...DISTRIBUTIONS], barStack: [true, false], barPercent: [true, false],
  cdfY: ["proportion", "count"], cdfBand: [true, false],
  marginal: MARGINAL_KINDS, ridgeEach: [true, false],
  violinSide: VIOLIN_SIDES, pairedCi: [true, false], lollipopStat: LOLLIPOP_STATS, lollipopSort: LOLLIPOP_SORTS, histStack: [true, false],
  violinMarks: VIOLIN_MARKS, pairedDirection: [true, false], lollipopHoriz: [true, false], histSplit: [true, false],
  violinMean: [true, false], violinRain: [true, false], histPercent: [true, false], lollipopWhisker: LOLLIPOP_WHISKERS,
};
const isColRef = (r: unknown): r is StatColRef =>
  Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && typeof r[1] === "string";

/** A persisted `statPicks`: each well-formed field kept, the rest dropped (=
 *  default). The five column refs are kept or dropped TOGETHER — a partial
 *  set would pair a saved column with a default one. Never throws. */
export function sanitizeStatPicks(v: unknown): StatPicks {
  const out: Record<string, unknown> = {};
  if (typeof v !== "object" || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const k in STAT_PICK_VALUES) if (STAT_PICK_VALUES[k].includes(o[k])) out[k] = o[k];
  const ov = o.ridgeOverlap;
  if (typeof ov === "number" && ov > 0 && ov <= 5) out.ridgeOverlap = ov;
  const bw = o.ridgeBw;
  if (bw === "scott" || bw === "silverman" || (typeof bw === "string" && Number(bw) > 0 && Number(bw) < Infinity)) out.ridgeBw = bw;
  for (const k of ["marginalColor", "marginalSize"]) if (Number.isInteger(o[k]) && (o[k] as number) >= 0) out[k] = o[k];
  if (typeof o.pairedTol === "number" && Number.isFinite(o.pairedTol) && o.pairedTol >= 0) out.pairedTol = o.pairedTol;
  const r = o.valueRange;
  if (Array.isArray(r) && r.length === 2 && r[0] < r[1] && r.every(Number.isFinite)) out.valueRange = r;
  if (Array.isArray(o.histCols) && o.histCols.length <= 64 && o.histCols.every((i) => Number.isInteger(i) && i >= 0)) {
    out.histCols = [...new Set(o.histCols as number[])];
  }
  const rug = sanitizeRugPick(o.rug);
  if (rug) out.rug = rug;
  const c = o.cols as Record<string, unknown> | null;
  const keys = ["group", "group2", "value", "facet", "color"];
  if (typeof c === "object" && c && isColRef(c.value) && keys.every((k) => c[k] === null || isColRef(c[k]))) {
    out.cols = Object.fromEntries(keys.map((k) => [k, c[k]]));
  }
  return out;
}

/** The PlotView fields that are plain booleans: every key whose type is
 *  `boolean`, derived from the interface, so a new boolean field is covered
 *  the moment it is declared, with no list to keep in step. */
export type BoolViewKey = { [K in keyof PlotView]-?: PlotView[K] extends boolean ? K : never }[keyof PlotView];

/** Each boolean field from a persisted view, or the fallback view's value when
 *  missing or not a boolean — the per-field-fallback discipline
 *  `sanitizePlotView` applies to every other field. The fallback view (a full
 *  `defaultPlotView()`) is the runtime key list: exactly its boolean-valued
 *  entries, the same set `BoolViewKey` names — no literal list of names (P2.6
 *  box 4 leftover: what funded `statShowSummary`'s eager bytes). Never throws. */
export function boolViewFields(o: Record<string, unknown>, fb: PlotView): Pick<PlotView, BoolViewKey> {
  const out = {} as Record<string, boolean>;
  for (const k in fb) {
    const d = fb[k as keyof PlotView];
    if (typeof d === "boolean") out[k] = typeof o[k] === "boolean" ? (o[k] as boolean) : d;
  }
  return out as Pick<PlotView, BoolViewKey>;
}

/** Validate a persisted region-shade list (F2.3j — decoded film-stack shades
 *  became editable plot objects, not immutable provenance; previously this
 *  field was a bare `Array.isArray` cast). The `RegionShade` analogue of
 *  `sanitizeShapes` above: an entry missing its required `id`/finite
 *  `x1..y2`/string `fill` is dropped (nothing sane to fall back to for a
 *  single list entry); `axis` keeps only 0/1, same "drop the bad value, keep
 *  the entry" shape as an unrecognized annotation anchor. Region shades are
 *  always data-anchored (unlike `Shape`, there is no page-fraction variant),
 *  so coordinates are never clamped — same "never clamp DATA coords"
 *  convention `sanitizeShapes` already uses for a data-anchored shape. Never
 *  throws. */
export function sanitizeRegionShades(v: unknown): RegionShade[] {
  if (!Array.isArray(v)) return [];
  const out: RegionShade[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.fill !== "string") continue;
    const coords = [o.x1, o.y1, o.x2, o.y2];
    if (!coords.every((n): n is number => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({
      id: o.id,
      x1: o.x1 as number,
      y1: o.y1 as number,
      x2: o.x2 as number,
      y2: o.y2 as number,
      fill: o.fill,
      ...(o.axis === 0 || o.axis === 1 ? { axis: o.axis } : {}),
      ...(o.fullHeight === true && { fullHeight: true }),
    });
  }
  return out;
}
