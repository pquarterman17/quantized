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
//     two walks cannot disagree). A count OR label mismatch (e.g. a stale
//     draw mid-recompute) returns null and the caller
//     keeps the old, closed-up axis rather than mislabel a box.
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
import { NESTED_LABEL_SEP, columnDisplayName } from "./statschooser";
import type { DataStruct } from "./types";

/** Above this many slots, never-occurring slots are left off (see header). */
export const MAX_AXIS_SLOTS = 200;
/** min(n)/max(n) below this among the non-empty groups reads as unbalanced. */
export const UNBALANCED_RATIO = 0.2;
/** A non-empty group with fewer rows than this gets the small-n caveat. */
export const SMALL_N = 3;

export interface AxisSlot {
  /** Tick label. For a filled slot, the plotted group's own label. */
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
}

export interface GroupAxis {
  /** Every slot, in axis order (`group` still unassigned: see `alignSlots`). */
  slots: AxisSlot[];
  /** Never-occurring slots left off by the cap. */
  hiddenAbsent: number;
  /** Counted rows that carry no level at all (a non-finite factor code). */
  unassigned: number;
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
function universe(data: DataStruct, col: number): number[] {
  const declared = (categoricalLevels(data, col) ?? []).map((_, code) => code);
  return orderLevels(levelsOf([...declared, ...columnOf(data, col)]), levelOrderFor(data, col));
}

/** Code -> display text over the WHOLE universe in one resolution (a
 *  per-subset resolution can name one code two ways — nestedLevels' H1). */
function levelText(data: DataStruct, col: number, codes: readonly number[]): Map<number, string> {
  const texts = resolveCategoryLabels(data, col, codes);
  return new Map(codes.map((code, i) => [code, texts[i]]));
}

const emptySlot = (label: string, absent: boolean): AxisSlot => ({
  label, group: null, n: 0, nonFinite: 0, excluded: 0, absent,
});

function countRow(slot: AxisSlot, dropped: boolean, usable: boolean): void {
  if (dropped) slot.excluded++;
  else if (usable) slot.n++;
  else slot.nonFinite++;
}

/** Build the axis (see the module header). Pure; allocates one slot per axis
 *  position and walks the rows once. */
export function buildGroupAxis(input: AxisInput): GroupAxis {
  const { levels, rows, dropped, groupCol, group2Col, valueCols, prefixed } = input;
  const nRows = rows.time.length;
  if (groupCol == null) {
    const slots = input.fallbackCols.map((c) => emptySlot(columnDisplayName(levels, c), false));
    input.fallbackCols.forEach((c, i) => {
      const col = columnOf(rows, c);
      for (let r = 0; r < nRows; r++) countRow(slots[i], dropped.has(r), Number.isFinite(col[r]));
    });
    return { slots, hiddenAbsent: 0, unassigned: 0 };
  }

  const vals = valueCols.map((c) => columnOf(rows, c));
  const usable = (r: number) => vals.some((col) => Number.isFinite(col[r]));
  const name = (col: number, text: string) => (prefixed ? `${columnDisplayName(levels, col)} = ${text}` : text);
  const aCodes = universe(levels, groupCol);
  const aText = levelText(levels, groupCol, aCodes);
  const aAll = columnOf(levels, groupCol);
  const aRows = columnOf(rows, groupCol);

  if (group2Col == null) {
    const seen = new Set(aAll);
    let keep = aCodes;
    if (aCodes.length > MAX_AXIS_SLOTS) keep = aCodes.filter((code) => seen.has(code));
    const index = new Map(keep.map((code, i) => [code, i]));
    const slots = keep.map((code) => emptySlot(name(groupCol, aText.get(code) ?? String(code)), !seen.has(code)));
    let unassigned = 0;
    for (let r = 0; r < nRows; r++) {
      const i = index.get(aRows[r]);
      if (i === undefined) unassigned++;
      else countRow(slots[i], dropped.has(r), usable(r));
    }
    return { slots, hiddenAbsent: aCodes.length - keep.length, unassigned };
  }

  const bCodes = universe(levels, group2Col);
  const bText = levelText(levels, group2Col, bCodes);
  const bAll = columnOf(levels, group2Col);
  const key = (a: number, b: number) => `${a}|${b}`;
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
  const occursUnder = (a: number, b: number) => byA.get(a)?.has(b) === true;
  const keep: (readonly [number, number])[] =
    cross <= MAX_AXIS_SLOTS
      ? aCodes.flatMap((a) => bCodes.map((b) => [a, b] as const))
      : aCodes.flatMap((a) =>
          [...(byA.get(a) ?? [])]
            .sort((x, y) => (bRank.get(x) ?? 0) - (bRank.get(y) ?? 0))
            .map((b) => [a, b] as const),
        );
  const index = new Map(keep.map(([a, b], i) => [key(a, b), i]));
  const slots = keep.map(([a, b]) =>
    emptySlot(
      `${name(groupCol, aText.get(a) ?? String(a))}${NESTED_LABEL_SEP}${name(group2Col, bText.get(b) ?? String(b))}`,
      !occursUnder(a, b),
    ),
  );
  const bRows = columnOf(rows, group2Col);
  let unassigned = 0;
  for (let r = 0; r < nRows; r++) {
    const i = index.get(key(aRows[r], bRows[r]));
    if (i === undefined) unassigned++;
    else countRow(slots[i], dropped.has(r), usable(r));
  }
  return { slots, hiddenAbsent: cross - keep.length, unassigned };
}

/** Thread the plotted groups onto the axis by ORDER (module header): the
 *  `n > 0` slots, in axis order, must be exactly the groups — same count AND
 *  the same label, slot for slot — and then take their indices; the rest stay
 *  empty. Null otherwise, and the caller keeps its old closed-up axis rather
 *  than risk putting a box over the wrong tick. The label check is what
 *  catches a STALE draw (the async compute still holding the previous
 *  grouping while the axis already describes the new one); a count alone
 *  cannot tell two groupings with the same number of levels apart. */
export function alignSlots(slots: readonly AxisSlot[], groupLabels: readonly string[]): AxisSlot[] | null {
  const filled = slots.filter((s) => s.n > 0);
  if (filled.length !== groupLabels.length || filled.some((s, i) => s.label !== groupLabels[i])) return null;
  let k = 0;
  return slots.map((s) => (s.n > 0 ? { ...s, group: k++ } : { ...s, group: null }));
}

/** The slots actually drawn: every slot, or only the filled ones when the
 *  user has chosen to hide empty levels. */
export function visibleSlots(slots: readonly AxisSlot[], hideEmpty: boolean): AxisSlot[] {
  return hideEmpty ? slots.filter((s) => s.group !== null) : [...slots];
}

// ── Notice ─────────────────────────────────────────────────────────────────

/** One summary whose n matters for the caveat: a box/violin/strip group, or
 *  one bar (a category x series cell). */
export interface CountedGroup {
  label: string;
  n: number;
}

const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** The small-n / unbalanced caveat, or null. The ONE text both the screen's
 *  notice and the export's footnote carry (`calc.figure_group_notes`), so
 *  summary statistics and error bars never appear without it. ASCII only —
 *  it is typeset by matplotlib into PDF/SVG. */
export function balanceCaveat(groups: readonly CountedGroup[]): string | null {
  const filled = groups.filter((g) => g.n > 0);
  const parts: string[] = [];
  const small = filled.filter((g) => g.n < SMALL_N);
  if (small.length) parts.push(`n < ${SMALL_N} in ${plural(small.length, "group")}`);
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
  /** Facet panels left out because they had nothing to draw. */
  droppedPanels?: number;
}

const DETAIL_LINES = 30;

/** Everything the stage must say about its groups, or null when there is
 *  nothing to say (every level present, balanced, nothing dropped). */
export function groupNotice(input: NoticeInput): GroupNotice | null {
  const { slots, counted, hideEmpty, hiddenAbsent, unassigned, droppedPanels = 0 } = input;
  const caveat = balanceCaveat(counted);
  const parts: string[] = caveat ? [caveat.replace(/ - .*$/, "")] : [];
  const empty = slots.filter((s) => s.n === 0).length;
  if (empty) parts.push(hideEmpty ? `${plural(empty, "empty level")} hidden` : `${plural(empty, "empty level")} (n=0)`);
  const nonFinite = slots.reduce((a, s) => a + s.nonFinite, 0);
  const excluded = slots.reduce((a, s) => a + s.excluded, 0);
  if (nonFinite || excluded) {
    parts.push(`${plural(nonFinite + excluded, "row")} dropped (${nonFinite} non-finite, ${excluded} excluded/filtered)`);
  }
  if (unassigned) parts.push(`${plural(unassigned, "row")} with no level`);
  if (hiddenAbsent) parts.push(`${plural(hiddenAbsent, "never-occurring level")} not shown (over ${MAX_AXIS_SLOTS} slots)`);
  if (droppedPanels) parts.push(`${plural(droppedPanels, "facet panel")} with no data not shown`);
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
  const detail = [...(small.length ? [`small groups: ${small.slice(0, 10).join("; ")}`] : []), ...shown].join("\n");
  return { line: parts.join(" · "), detail, caveat };
}

/** Where a grouped bar's `n=` caption sits, in value units: above its upper
 *  error whisker, never below the zero baseline, and AT the baseline for a
 *  missing (NaN) bar — `calc.figure_categorical._label_bar_counts`' rule. */
export function barCountAnchor(mean: number, sem: number): number {
  if (!Number.isFinite(mean)) return 0;
  return Math.max(Number.isFinite(sem) ? mean + sem : mean, 0);
}
