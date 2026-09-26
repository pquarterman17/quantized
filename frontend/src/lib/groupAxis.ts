// Category-axis accounting for the categorical plot family (box / violin /
// strip / bar): which slots the axis carries, how many usable rows each one
// has, and why the rest were dropped. PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 2,
// "missing levels and unbalanced groups are explicit".
//
// THE DEFECT THIS EXISTS FOR. Every grouping path used to build its category
// list from the rows that happened to survive: `statschooser.groupsByCategory`
// kept a level only if it had a finite value (`parts.has(level)`),
// `nestedCells` dropped a cell with no points, `categoryLevels` never saw a
// level declared in `cat_levels` that no row uses, and a level whose rows were
// all EXCLUDED was pruned out of the analysis view before any of them looked.
// All four closed the axis up silently: a missing wafer read as "there is no
// wafer 3", not "wafer 3 has no data". Nothing on screen or in the export said
// how many rows each group stood on, beyond an `n=` caption the export lacked.
//
// WHAT THIS MODULE DOES, and deliberately does not:
//   * It builds the axis from the level UNIVERSE: every code declared in the
//     channel's level table plus every code any row of the FULL dataset
//     carries (excluded rows included), in the user's display order
//     (`categorical.orderLevels`, the one implementation of what an order
//     means). Nested: the full cross product of the two universes.
//   * It counts, per slot, the usable rows (`n`), the rows whose value is not
//     finite, and the rows dropped by exclusion (#50) or the Data Filter (#53).
//   * It does NOT compute groups. The plotted groups still come from
//     `lib/statstage.resolveGroups` / `lib/barlayout.buildBarMatrix`, exactly
//     as before, and `alignSlots` threads them onto the axis BY ORDER: the
//     slots with `n > 0`, in axis order, are exactly those groups in theirs
//     (`orderLevels` restricted to a subset preserves relative order, so the
//     two walks cannot disagree). The slot labels (ONE resolution over the
//     universe) then name the groups too. A stale draw is refused upstream
//     (the stage keys each draw to its inputs); a count mismatch returns null
//     and the caller keeps the old, closed-up axis rather than mislabel a box.
//
// THE SLOT CAP (`MAX_AXIS_SLOTS`). Showing every declared level and every
// nested combination is the right default until it is absurd: 30 lots x 25
// wafers is 750 slots, most of them combinations that never occur. Rule: when
// the axis would exceed the cap, slots that NO row of the dataset carries
// (a declared-only level, a never-occurring combination) are left off and
// counted in `hiddenAbsent`, which the notice reports. Slots that DO occur but
// have no usable value (all NaN, all excluded) always stay — those are the
// informative ones. The axis can still exceed the cap if that many levels
// genuinely occur; that is the data, not padding.
//
// KNOWN COST of the rule, accepted deliberately: below the cap a genuinely
// NESTED design (wafer IDs unique per lot: 5 lots x 25 wafer codes = 125
// slots, 25 occurring) shows every lot x wafer pair, most of them n=0. The
// brief is that a never-occurring combination is shown, not silently closed
// up; "empty levels" off (persisted per plot) hides them in one click, and the
// notice counts them either way. The same holds per facet panel, which shares
// the whole-plot axis so panels line up.

import { resolveCategoryLabels } from "./barlayout";
import { categoricalLevels, columnOf, levelOrderFor, levelsOf, orderLevels } from "./categorical";
import { plural } from "./plural";
import { NESTED_LABEL_SEP, columnDisplayName } from "./statschooser";
import type { DataStruct } from "./types";

/** Above this many slots, never-occurring slots are left off (see header). */
export const MAX_AXIS_SLOTS = 200;
/** min(n)/max(n) below this among the non-empty groups reads as unbalanced. */
export const UNBALANCED_RATIO = 0.2;
/** A non-empty group with fewer rows than this gets the small-n caveat. */
export const SMALL_N = 3;

export interface AxisSlot {
  /** Tick label — ONE resolution over the whole level universe, used for the
   *  slot AND (after `alignSlots`) for the plotted group that fills it. */
  label: string;
  /** Index into the plotted (non-empty) groups; null = an EMPTY slot. */
  group: number | null;
  /** Usable rows: kept in the analysis view with a finite value. */
  n: number;
  /** Rows at this level, kept, whose value is not finite. */
  nonFinite: number;
  /** Rows at this level dropped by exclusion (#50) or the Data Filter (#53). */
  excluded: number;
  /** No row of the whole dataset carries this level / combination. */
  absent: boolean;
  /** Set by `visibleSlots` when HIDDEN empty slots sit just before this one:
   *  the connect-means line must still lift here (it would otherwise bridge
   *  the missing level), on screen and in the export. */
  gapBefore?: boolean;
}

export interface GroupAxis {
  /** Every slot, in axis order (`group` still unassigned: see `alignSlots`). */
  slots: AxisSlot[];
  /** Never-occurring slots left off by the cap. */
  hiddenAbsent: number;
  /** Counted rows that carry no level at all (a non-finite factor code). */
  unassigned: number;
}

/** The whole-dataset half of an axis — the level universe, its ONE label
 *  resolution, the cap, and the key of every slot. Computed once and shared
 *  by the flat axis and every facet panel (`countGroupAxis`), so a faceted
 *  plot does not redo universe / label / co-occurrence work per panel. */
export interface AxisPlan {
  groupCol: number | null;
  group2Col: number | null;
  /** No `groupCol`: the channels, one slot each. */
  fallbackCols: readonly number[];
  labels: string[];
  absent: boolean[];
  /** Slot key (`"a"` or `"a|b"`) -> slot index. */
  index: Map<string, number>;
  hiddenAbsent: number;
}

export interface AxisInput {
  /** Where the level UNIVERSE comes from — the dataset's full rows. */
  levels: DataStruct;
  /** The rows to count: the full rows (with `dropped`), or one facet slice of
   *  the analysis view (with an empty `dropped`). */
  rows: DataStruct;
  /** Indices into `rows` dropped from analysis. */
  dropped: ReadonlySet<number>;
  groupCol: number | null;
  group2Col: number | null;
  /** A row is usable when ANY of these is finite (box: the value column;
   *  bar: every plotted bar channel). Unused without `groupCol`. */
  valueCols: readonly number[];
  /** No `groupCol`: one slot per channel (the per-plotted-channel fallback). */
  fallbackCols: readonly number[];
  /** `lot = A` labels (box family) rather than bare `A` (bar). */
  prefixed: boolean;
}

/** A channel's level universe: declared codes ∪ codes any row carries, in the
 *  user's display order. */
export function levelUniverse(data: DataStruct, col: number): number[] {
  const declared = (categoricalLevels(data, col) ?? []).map((_, code) => code);
  return orderLevels(levelsOf([...declared, ...columnOf(data, col)]), levelOrderFor(data, col));
}

/** Code -> display text over the WHOLE universe in one resolution (a
 *  per-subset resolution can name one code two ways — nestedLevels' H1). */
function levelText(data: DataStruct, col: number, codes: readonly number[]): Map<number, string> {
  const texts = resolveCategoryLabels(data, col, codes);
  return new Map(codes.map((code, i) => [code, texts[i]]));
}

const key2 = (a: number, b: number) => `${a}|${b}`;

/** Plan the axis once (see `AxisPlan`). */
export function planGroupAxis(
  levels: DataStruct,
  groupCol: number | null,
  group2Col: number | null,
  fallbackCols: readonly number[],
  prefixed: boolean,
): AxisPlan {
  const base = { groupCol, group2Col, fallbackCols };
  if (groupCol == null) {
    return {
      ...base,
      labels: fallbackCols.map((c) => columnDisplayName(levels, c)),
      absent: fallbackCols.map(() => false),
      index: new Map(),
      hiddenAbsent: 0,
    };
  }
  const name = (col: number, text: string) => (prefixed ? `${columnDisplayName(levels, col)} = ${text}` : text);
  const aCodes = levelUniverse(levels, groupCol);
  const aText = levelText(levels, groupCol, aCodes);
  const aAll = columnOf(levels, groupCol);
  const aName = (a: number) => name(groupCol, aText.get(a) ?? String(a));

  if (group2Col == null) {
    const seen = new Set(aAll);
    const keep = aCodes.length > MAX_AXIS_SLOTS ? aCodes.filter((code) => seen.has(code)) : aCodes;
    return {
      ...base,
      labels: keep.map(aName),
      absent: keep.map((code) => !seen.has(code)),
      index: new Map(keep.map((code, i) => [String(code), i])),
      hiddenAbsent: aCodes.length - keep.length,
    };
  }

  const bCodes = levelUniverse(levels, group2Col);
  const bText = levelText(levels, group2Col, bCodes);
  const bAll = columnOf(levels, group2Col);
  const cross = aCodes.length * bCodes.length;
  // Over the cap the axis is built from the combinations that OCCUR, walked
  // per A level and put in B's display order — never by materializing the
  // whole product (two ID-like factors can make it millions of pairs).
  const bRank = new Map(bCodes.map((b, i) => [b, i]));
  const byA = new Map<number, Set<number>>();
  aAll.forEach((a, r) => {
    if (!bRank.has(bAll[r])) return;
    const bs = byA.get(a) ?? new Set<number>();
    byA.set(a, bs.add(bAll[r]));
  });
  const keep: (readonly [number, number])[] =
    cross <= MAX_AXIS_SLOTS
      ? aCodes.flatMap((a) => bCodes.map((b) => [a, b] as const))
      : aCodes.flatMap((a) =>
          [...(byA.get(a) ?? [])]
            .sort((x, y) => (bRank.get(x) ?? 0) - (bRank.get(y) ?? 0))
            .map((b) => [a, b] as const),
        );
  return {
    ...base,
    labels: keep.map(([a, b]) => `${aName(a)}${NESTED_LABEL_SEP}${name(group2Col, bText.get(b) ?? String(b))}`),
    absent: keep.map(([a, b]) => byA.get(a)?.has(b) !== true),
    index: new Map(keep.map(([a, b], i) => [key2(a, b), i])),
    hiddenAbsent: cross - keep.length,
  };
}

function countRow(slot: AxisSlot, dropped: boolean, usable: boolean): void {
  if (dropped) slot.excluded++;
  else if (usable) slot.n++;
  else slot.nonFinite++;
}

/** Count `rows` onto a planned axis: one walk over the rows. */
export function countGroupAxis(
  plan: AxisPlan,
  rows: DataStruct,
  dropped: ReadonlySet<number>,
  valueCols: readonly number[],
): GroupAxis {
  const slots: AxisSlot[] = plan.labels.map((label, i) => ({
    label, group: null, n: 0, nonFinite: 0, excluded: 0, absent: plan.absent[i],
  }));
  const nRows = rows.time.length;
  const { groupCol, group2Col } = plan;
  if (groupCol == null) {
    plan.fallbackCols.forEach((c, i) => {
      const col = columnOf(rows, c);
      for (let r = 0; r < nRows; r++) countRow(slots[i], dropped.has(r), Number.isFinite(col[r]));
    });
    return { slots, hiddenAbsent: 0, unassigned: 0 };
  }
  const vals = valueCols.map((c) => columnOf(rows, c));
  const aRows = columnOf(rows, groupCol);
  const bRows = group2Col == null ? null : columnOf(rows, group2Col);
  let unassigned = 0;
  for (let r = 0; r < nRows; r++) {
    const i = plan.index.get(bRows ? key2(aRows[r], bRows[r]) : String(aRows[r]));
    if (i === undefined) unassigned++;
    else countRow(slots[i], dropped.has(r), vals.some((col) => Number.isFinite(col[r])));
  }
  return { slots, hiddenAbsent: plan.hiddenAbsent, unassigned };
}

/** Plan + count in one call (the flat, single-use case). */
export function buildGroupAxis(input: AxisInput): GroupAxis {
  const plan = planGroupAxis(input.levels, input.groupCol, input.group2Col, input.fallbackCols, input.prefixed);
  return countGroupAxis(plan, input.rows, input.dropped, input.valueCols);
}

/** Thread the plotted groups onto the axis by ORDER (module header): the
 *  `n > 0` slots, in axis order, ARE the groups (`orderLevels` restricted to
 *  a subset keeps relative order), so a matching COUNT is the whole check and
 *  each filled slot takes the next group index. The slot keeps its own label,
 *  and the caller relabels the group to it — one label resolution for both,
 *  so a text sidecar that reads differently over the analysis view than over
 *  the whole column (an excluded row with inconsistent text) cannot make the
 *  two disagree. Null on a count mismatch; a STALE draw (computed for other
 *  picks) is the caller's to refuse before calling this — the stage keys each
 *  draw to the inputs it was computed from (`useStatStageDraws`). */
export function alignSlots(slots: readonly AxisSlot[], groupCount: number): AxisSlot[] | null {
  if (slots.filter((s) => s.n > 0).length !== groupCount) return null;
  let k = 0;
  return slots.map((s) => (s.n > 0 ? { ...s, group: k++ } : { ...s, group: null }));
}

/** The slots actually drawn: every slot, or only the filled ones when the
 *  user has chosen to hide empty levels — in which case a filled slot that
 *  had hidden empties before it (since the previous filled one) carries
 *  `gapBefore`, so the connect-means line still lifts across the hidden
 *  level. */
export function visibleSlots(slots: readonly AxisSlot[], hideEmpty: boolean): AxisSlot[] {
  if (!hideEmpty) return [...slots];
  const out: AxisSlot[] = [];
  let gap = false;
  for (const s of slots) {
    if (s.group === null) gap = true;
    else {
      out.push(gap && out.length > 0 ? { ...s, gapBefore: true } : s);
      gap = false;
    }
  }
  return out;
}

// ── Notice ─────────────────────────────────────────────────────────────────

/** One summary whose n matters for the caveat: a box/violin/strip group, or
 *  one bar (a category x series cell). */
export interface CountedGroup {
  label: string;
  n: number;
}

const count = (k: number, word: string) => `${k} ${word}${plural(k)}`;

/** The small-n / unbalanced caveat, or null. The ONE text both the screen's
 *  notice and the export's footnote carry (`calc.figure_group_notes`), so
 *  summary statistics and error bars never appear without it. ASCII only —
 *  it is typeset by matplotlib into PDF/SVG. */
export function balanceCaveat(groups: readonly CountedGroup[]): string | null {
  const filled = groups.filter((g) => g.n > 0);
  const parts: string[] = [];
  const small = filled.filter((g) => g.n < SMALL_N);
  if (small.length) parts.push(`n < ${SMALL_N} in ${count(small.length, "group")}`);
  if (filled.length >= 2) {
    const ns = filled.map((g) => g.n);
    const lo = Math.min(...ns);
    const hi = Math.max(...ns);
    if (lo / hi < UNBALANCED_RATIO) parts.push(`unbalanced groups (n ${lo}-${hi})`);
  }
  return parts.length ? `Caveat: ${parts.join("; ")} - summaries and intervals are unreliable` : null;
}

export interface GroupNotice {
  /** One line for the stage's status area. */
  line: string;
  /** Per-level breakdown for its tooltip. */
  detail: string;
  /** `balanceCaveat` — also sent to the export as its footnote. */
  caveat: string | null;
}

export interface NoticeInput {
  /** The flat axis (aligned), for empty-level and dropped-row accounting. */
  slots: readonly AxisSlot[];
  /** The drawn summaries (all panels when faceted), for the caveat. */
  counted: readonly CountedGroup[];
  hideEmpty: boolean;
  hiddenAbsent: number;
  unassigned: number;
  /** Facet levels (declared or carried by any row) with no panel on screen —
   *  every row excluded / filtered, or no usable value. Named in the tooltip. */
  missingPanels?: readonly string[];
}

const DETAIL_LINES = 30;

/** Everything the stage must say about its groups, or null when there is
 *  nothing to say (every level present, balanced, nothing dropped). */
export function groupNotice(input: NoticeInput): GroupNotice | null {
  const { slots, counted, hideEmpty, hiddenAbsent, unassigned, missingPanels = [] } = input;
  const caveat = balanceCaveat(counted);
  const parts: string[] = caveat ? [caveat.replace(/ - .*$/, "")] : [];
  const empty = slots.filter((s) => s.n === 0).length;
  if (empty) parts.push(hideEmpty ? `${count(empty, "empty level")} hidden` : `${count(empty, "empty level")} (n=0)`);
  const nonFinite = slots.reduce((a, s) => a + s.nonFinite, 0);
  const excluded = slots.reduce((a, s) => a + s.excluded, 0);
  if (nonFinite || excluded) {
    parts.push(`${count(nonFinite + excluded, "row")} dropped (${nonFinite} non-finite, ${excluded} excluded/filtered)`);
  }
  if (unassigned) parts.push(`${count(unassigned, "row")} with no level`);
  if (hiddenAbsent) parts.push(`${count(hiddenAbsent, "never-occurring level")} not shown (over ${MAX_AXIS_SLOTS} slots)`);
  if (missingPanels.length) parts.push(`${count(missingPanels.length, "facet level")} with no usable data not shown`);
  if (!parts.length) return null;
  const rows = slots
    .filter((s) => s.n === 0 || s.nonFinite > 0 || s.excluded > 0)
    .map((s) => {
      const why = [s.nonFinite ? `${s.nonFinite} non-finite` : "", s.excluded ? `${s.excluded} excluded/filtered` : ""];
      const tail = why.filter(Boolean).join(", ");
      return `${s.label}: n=${s.n}${tail ? `, ${tail}` : ""}${s.absent ? " (never occurs)" : ""}`;
    });
  const shown = rows.slice(0, DETAIL_LINES);
  if (rows.length > DETAIL_LINES) shown.push(`... and ${rows.length - DETAIL_LINES} more`);
  const small = counted.filter((g) => g.n > 0 && g.n < SMALL_N).map((g) => `${g.label}: n=${g.n}`);
  const facets = missingPanels.length ? [`no panel (no usable data): ${missingPanels.slice(0, 10).join("; ")}`] : [];
  const detail = [...(small.length ? [`small groups: ${small.slice(0, 10).join("; ")}`] : []), ...facets, ...shown].join("\n");
  return { line: parts.join(" · "), detail, caveat };
}

/** Where a grouped bar's `n=` caption sits, in value units: above its upper
 *  error whisker, never below the zero baseline, and AT the baseline for a
 *  missing (NaN) bar — `calc.figure_categorical._label_bar_counts`' rule. */
export function barCountAnchor(mean: number, sem: number): number {
  if (!Number.isFinite(mean)) return 0;
  return Math.max(Number.isFinite(sem) ? mean + sem : mean, 0);
}
