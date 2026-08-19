// J2 Recode workshop (JMP_GAP_PLAN item 2) + P1.6b's cell-edit-guard "extend
// the level table" affordance: pure level-mapping logic for a categorical
// column. A recode is a set of GROUPS -- `{ newLabel, from: string[] }` --
// each naming the OLD level strings that fold into one NEW label. Multiple
// `from` entries = a merge; a single `from` entry whose text differs from
// `newLabel` = a rename; an old level named in NO group keeps its own string
// unchanged (identity) -- this is how "bin levels" (JMP's grouping-into-
// buckets sense; there is no numeric-range binning here, the source is
// always categorical) falls out of the SAME group shape as merge/rename,
// with no separate "bin" concept to build.
//
// Order (P1.4 ruling: the level tuple's own order, first-appearance from
// import): the resulting NEW level table's order is the FIRST-APPEARANCE
// order of each row's resolved new label while scanning the OLD levels in
// their existing order -- deterministic, and stays coherent with the P1.4
// contract when levels are merged/reordered (see `recodeColumnValues`'s
// invertibility argument below).
//
// INVERTIBILITY (P1.4 pin): a recode is intentionally LOSSY at the SEMANTIC
// level when it merges (two old levels collapsing to one new label can never
// be told apart again from the recoded column alone -- that IS the feature).
// What stays lossless+invertible is the recoded column's OWN code<->label
// pair, exactly like every other categorical column under the P1.4 contract:
// `levels[code]` always recovers the EXACT label that produced that code,
// because `levels` is built by de-duplicating in `buildRecodePreview` and
// `code` is that array's index -- a basic array-index invariant, pinned by
// this file's "invertibility" test group.

/** One old->new level group. `from` lists the OLD level strings folding into
 *  `newLabel` (order within `from` is irrelevant; only membership matters). */
export interface RecodeGroup {
  newLabel: string;
  from: string[];
}

/** A recode recipe: an ordered list of groups. Old levels named in no group
 *  pass through unchanged (identity) -- see module header. */
export interface RecodeMapping {
  groups: RecodeGroup[];
}

/** A recode column's provenance, embedded on `ComputedColumn.recode`
 *  (lib/types.ts): which SOURCE channel (by letter, same identity scheme
 *  every formula dependency uses) this recode reads from, and the mapping
 *  recipe that produced it. Mutually exclusive with a real `expr` -- see
 *  lib/formula.ts's `computeFormulas`, which branches on this field's
 *  presence instead of compiling `expr`. */
export interface RecodeSpec {
  sourceLetter: string;
  mapping: RecodeMapping;
}

/** The new label one old level resolves to: the group naming it in `from`,
 *  or the old level itself (identity) when no group claims it. */
export function resolveLevel(mapping: RecodeMapping, oldLevel: string): string {
  for (const g of mapping.groups) {
    if (g.from.includes(oldLevel)) return g.newLabel;
  }
  return oldLevel;
}

export interface RecodePreviewRow {
  oldLevel: string;
  newLevel: string;
}

export interface RecodePreview {
  /** One row per OLD level (in its existing order) -- the live "old -> new
   *  mapping table" preview the workshop shows before anything commits. */
  rows: RecodePreviewRow[];
  /** The resulting NEW level table, in first-appearance order (see header). */
  newLevels: string[];
}

/** Preview a mapping against a categorical column's current level table --
 *  never mutates anything, safe to call on every keystroke while the user
 *  edits groups. */
export function buildRecodePreview(oldLevels: readonly string[], mapping: RecodeMapping): RecodePreview {
  const rows: RecodePreviewRow[] = [];
  const newLevels: string[] = [];
  const seen = new Set<string>();
  for (const oldLevel of oldLevels) {
    const newLevel = resolveLevel(mapping, oldLevel);
    rows.push({ oldLevel, newLevel });
    if (!seen.has(newLevel)) {
      seen.add(newLevel);
      newLevels.push(newLevel);
    }
  }
  return { rows, newLevels };
}

export interface RecodeColumnResult {
  /** Per-row new codes, same length/order as `sourceValues`. */
  codes: number[];
  /** The new column's level table (`levels[code]` recovers the label). */
  levels: string[];
}

/** Compute a recoded column's codes + level table from a source column's raw
 *  codes + its OWN level table. A source code that is missing (NaN),
 *  non-integer, or out of range for `sourceLevels` recodes to NaN too (P1.4's
 *  "never throw, degrade -- missing stays missing" convention, mirrored from
 *  `level_of`/`levelLabel`) rather than being silently coerced into some
 *  level. Pure; safe to call on every recompute. */
export function recodeColumnValues(
  sourceValues: readonly number[],
  sourceLevels: readonly string[],
  mapping: RecodeMapping,
): RecodeColumnResult {
  const { newLevels } = buildRecodePreview(sourceLevels, mapping);
  const indexOf = new Map(newLevels.map((l, i) => [l, i]));
  const codes = sourceValues.map((code) => {
    if (!Number.isFinite(code) || !Number.isInteger(code) || code < 0 || code >= sourceLevels.length) {
      return Number.NaN;
    }
    const newLevel = resolveLevel(mapping, sourceLevels[code]);
    return indexOf.get(newLevel) ?? Number.NaN; // unreachable: newLevel is always a member of newLevels
  });
  return { codes, levels: newLevels };
}

export interface RecodeAppendResult {
  /** Per-row codes for the new column — always `rowCount` long. */
  codes: number[];
  /** The new column's level table; present on success. */
  levels?: string[];
  /** Set (never thrown) when `sourceLevels` is undefined — the named source
   *  letter didn't resolve to a real, categorical column. `codes` is still
   *  all-NaN and `rowCount` long, keeping the column count stable, same
   *  contract a failing plain formula already gets (lib/formula.ts). */
  error?: string;
}

/** `lib/formula.ts`'s `computeFormulas` glue for one `f.recode` entry: given
 *  the SOURCE column's already-resolved level table (`undefined` when the
 *  source isn't categorical) and raw codes, compute the new column. Kept
 *  here (not inline in formula.ts) so that file's own general .ts ceiling
 *  isn't spent on recode-specific logic — this module owns "what a recode
 *  computes", formula.ts owns only "which column is the source, right now". */
export function computeRecodeAppend(
  recode: RecodeSpec,
  sourceLevels: readonly string[] | undefined,
  sourceValues: readonly number[],
  rowCount: number,
): RecodeAppendResult {
  if (!sourceLevels) {
    return {
      codes: Array.from({ length: rowCount }, () => Number.NaN),
      error: `recode source "${recode.sourceLetter}" is not categorical (has no level table)`,
    };
  }
  return recodeColumnValues(sourceValues, sourceLevels, recode.mapping);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a recode mapping from a plain find/replace over a column's level
 *  STRINGS (J2's "plain find-replace over text cells" -- for a categorical
 *  column, its "text cells" are the level strings every row displays). Only
 *  levels actually containing `find` get a group; levels that collide onto
 *  the same replaced text merge into ONE group (a deliberate, visible side
 *  effect of find-replace, not a bug -- the preview table shows it). An
 *  empty `find` is a no-op mapping (nothing would match). */
export function mappingFromFindReplace(
  oldLevels: readonly string[],
  find: string,
  replace: string,
  opts?: { caseSensitive?: boolean },
): RecodeMapping {
  if (find === "") return { groups: [] };
  const caseSensitive = opts?.caseSensitive ?? true;
  const test = (s: string): boolean =>
    caseSensitive ? s.includes(find) : s.toLowerCase().includes(find.toLowerCase());
  const replaceAll = (s: string): string =>
    caseSensitive ? s.split(find).join(replace) : s.replace(new RegExp(escapeRegExp(find), "gi"), replace);
  const byLabel = new Map<string, string[]>();
  for (const oldLevel of oldLevels) {
    if (!test(oldLevel)) continue;
    const newLabel = replaceAll(oldLevel);
    const list = byLabel.get(newLabel);
    if (list) list.push(oldLevel);
    else byLabel.set(newLabel, [oldLevel]);
  }
  return { groups: [...byLabel.entries()].map(([newLabel, from]) => ({ newLabel, from })) };
}

export type RecodeMappingResolution = { ok: true } | { ok: false; unmatched: string[]; reason: string };

/** Can a SAVED `mapping` (built against some earlier source's levels) be
 *  reapplied cleanly to a DIFFERENT column/dataset's CURRENT `targetLevels`?
 *  Refuses the WHOLE apply -- never a partial one -- when any old level the
 *  mapping names in a group's `from` doesn't exist on the target: that group
 *  member can never be reached during recompute, so its intended merge/
 *  rename silently never fires for that level. Every unmatched level is
 *  named (P1.6's `resolveImportFilter` shape: all-or-nothing, name every
 *  mismatch) -- an independent type, no coupling to `ImportFilterWire` or
 *  `quickPlotTemplates`; recode mappings are their own object. A level the
 *  mapping never mentions is fine either way (it passes through as identity
 *  on any target, same as on the mapping's original source). */
export function resolveRecodeMapping(
  mapping: RecodeMapping,
  targetLevels: readonly string[],
): RecodeMappingResolution {
  const targetSet = new Set(targetLevels);
  const seen = new Set<string>();
  const unmatched: string[] = [];
  for (const g of mapping.groups) {
    for (const oldLevel of g.from) {
      if (!targetSet.has(oldLevel) && !seen.has(oldLevel)) {
        seen.add(oldLevel);
        unmatched.push(oldLevel);
      }
    }
  }
  if (unmatched.length) {
    return {
      ok: false,
      unmatched,
      reason:
        `${unmatched.length} level${unmatched.length === 1 ? "" : "s"} in this mapping ` +
        `${unmatched.length === 1 ? "doesn't" : "don't"} exist on the target column: ${unmatched.join(", ")}`,
    };
  }
  return { ok: true };
}

/** A saved, re-applicable recode recipe (J2 item 3). Session-scoped (see
 *  store/recode.ts's header for why this doesn't round-trip `.dwk` yet) --
 *  `sourceLevels` is kept for DISPLAY only ("built from: Pass, Fail, Retry");
 *  `resolveRecodeMapping` above always checks the live TARGET's levels, never
 *  this snapshot, so a saved mapping degrades honestly even if its original
 *  source column has since changed. */
export interface SavedRecodeMapping {
  id: string;
  name: string;
  mapping: RecodeMapping;
  sourceLevels: string[];
  createdAt: string;
}
