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
import type { RegionShade } from "./types";

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
export type StatErrorBars = "none" | "sd" | "se" | "ci95";
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
}

const STAT_MARK_VALUES: Record<string, readonly unknown[]> = {
  points: ["all", "outliers", "none"], jitter: [true, false], summary: ["none", "mean", "median"],
  errorBars: ["none", "sd", "se", "ci95"], connectMeans: [true, false], labelRotation: [0, 45, 90],
  labelWrap: [true, false],
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
 *  active when saved" is not this one): `useStatStagePicks`'s `mode` is
 *  plain component state, never itself persisted on `PlotView` / `.dwk` —
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

/** The PlotView fields that are plain booleans: every key whose type is
 *  `boolean`, derived from the interface, so a new boolean field is covered
 *  the moment it is declared, with no list to keep in step. */
export type BoolViewKey = { [K in keyof PlotView]: PlotView[K] extends boolean ? K : never }[keyof PlotView];

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
    });
  }
  return out;
}
