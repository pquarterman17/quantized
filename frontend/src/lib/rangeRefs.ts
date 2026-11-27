// Named-range references in worksheet formulas: `rng("Name")` / `rng("Name", n)` (ROW_RANGE_CONTRACT sections 5.2-5.3,
// slice R4b). Part of the LAZY formula module (lib/formulaRefs.ts registers these with lib/formulaExt.ts).
//
// The text of a formula shows the range's NAME; what the formula is LINKED to is the range's id, recorded on the column
// as `ComputedColumn.ranges` ({ name, id }) when the formula is added, exactly as `sheet("Name", L)` binds a worksheet
// (lib/sheetRefs.ts). Everything else follows from never resolving by name again:
//
//   - RENAME the range: the link holds and the formula text is rewritten to the new name (`renameRangeRefs`).
//   - DELETE it (or its worksheet): the link is cut (`id: null`, lib/sheetBindings.ts `cutSheetRefs`) and the formula
//     becomes an error ("named range ... was removed"); a later range with the same name is NOT picked up.
//   - A name binds only to a range VISIBLE from the formula's worksheet: one scoped to that sheet, or to its workbook.
//   - A block on ANOTHER worksheet draws the same recalc edge `sheet()` does (lib/recalc.ts), and a circle of
//     worksheets is refused at bind time. A block on the formula's OWN worksheet makes its columns inputs of the
//     formula's column, so a column that reads a range holding itself is refused too.
//   - A range that is stale (its rows were replaced), has lost every column, or whose rows were all deleted is refused,
//     never read as "every row" (contract 5.4).
//   - A lazy Origin book that has not loaded its full rows is refused rather than read as its preview.

import { channelLetter } from "./formula";
import { rowRangeLabel } from "./rowRange";
import type { NamedRange } from "./namedRanges";
import { recalcNodes, wouldCreateCycle } from "./recalc";
import { setNamedRangeSource } from "./sheetBindings";
import { tokenize } from "./formulaTokenize";
import type { SheetBinding, Tok } from "./formulaTypes";
import type { Dataset } from "./types";

let live: () => readonly NamedRange[] = () => [];
/** The project's named ranges, live (registered by `attachStore`, lib/formulaRefs.ts). */
export const namedRangeList = (): readonly NamedRange[] => live();
/** Where `rng("Name")` finds the ranges, for this module and for the recalc graph (lib/sheetBindings.ts). Returns the
 *  source it replaces, so a store update that evaluates against ranges not yet committed can put it back. */
export function installRangeSource(f: () => readonly NamedRange[]): () => readonly NamedRange[] {
  const previous = live;
  live = f;
  setNamedRangeSource(f);
  return previous;
}

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

export interface RangeCall {
  name: string;
  /** Source offsets of the quoted name. */
  nameAt: number;
  nameEnd: number;
  /** The 1-based column index when written, else null. */
  n: number | null;
}

/** Every `rng("Name")` / `rng("Name", n)` call in `expr`, in source order. */
export function rangeCalls(expr: string): RangeCall[] {
  let toks: Tok[];
  try {
    toks = tokenize(expr);
  } catch {
    return [];
  }
  const out: RangeCall[] = [];
  for (let i = 0; i + 3 < toks.length; i++) {
    const [t, open, name] = [toks[i], toks[i + 1], toks[i + 2]];
    if (!(t.t === "name" && t.v === "rng" && isOp(open, "(") && name.t === "str" && name.p !== undefined)) continue;
    const n = isOp(toks[i + 3], ",") && toks[i + 4]?.t === "num" ? (toks[i + 4] as Extract<Tok, { t: "num" }>).v : null;
    out.push({ name: name.v, nameAt: name.p, nameEnd: name.p + name.v.length + 2, n });
  }
  return out;
}

/** The ranges a worksheet can name from a formula: those scoped to it, and those scoped to its workbook. */
export function visibleRanges(selfId: string, datasets: readonly Dataset[]): NamedRange[] {
  const workbookId = datasets.find((d) => d.id === selfId)?.workbookId;
  return namedRangeList().filter((r) => (r.scope.kind === "sheet" ? r.scope.datasetId === selfId : workbookId !== undefined && r.scope.workbookId === workbookId));
}

/** Why `range` cannot be read at all (stale, no column, no row), or null. */
export function rangeProblem(range: NamedRange): string | null {
  const { rows, cols } = range.target;
  if (range.rowsStale)
    return `named range ${range.name}: its worksheet's rows were replaced; open Named Ranges to keep ${rows ? rowRangeLabel(rows) : "its columns"} or remove the row limit`;
  if (cols.length === 0) return `named range ${range.name} has lost every column it covered`;
  if (rows?.was !== undefined) return `named range ${range.name}: ${rows.was} no longer exist`;
  return null;
}

/** Which of `range`'s columns `rng("Name"[, n])` stands for (an index into `target.cols`), or why none. */
export function rangeColumn(range: NamedRange, n: number | null, letters: (c: number) => string): { index: number } | { error: string } {
  const { cols } = range.target;
  const shown = cols.map((c) => (c < 0 ? "x" : letters(c)));
  if (n === null) return cols.length === 1 ? { index: 0 } : { error: `named range ${range.name} covers ${cols.length} columns (${shown.join(", ")}): pick one with rng("${range.name}", 1) to rng("${range.name}", ${cols.length})` };
  if (!Number.isInteger(n) || n < 1 || n > cols.length)
    return { error: `rng("${range.name}", ${n}): the range has ${cols.length} column${cols.length === 1 ? "" : "s"} (${shown.join(", ")}), numbered from 1` };
  return { index: n - 1 };
}

/** Link every `rng("Name", …)` in `expr` to a named range visible from worksheet `selfId`. A name already linked in
 *  `prior` (the column being edited) keeps its link while that range exists, so an edit never silently re-points it.
 *  `target` is the letter of the column being written: a block on the formula's own worksheet that holds it (or, through
 *  another formula, reads it) is a cycle and is refused. Returns the bindings or why the formula is refused. */
export function linkRanges(
  expr: string,
  datasets: readonly Dataset[],
  selfId: string,
  prior: readonly SheetBinding[] = [],
  target?: string,
): { ranges: SheetBinding[] | undefined } | { error: string } {
  const calls = rangeCalls(expr);
  const ranges: SheetBinding[] = [];
  const all = namedRangeList();
  const visible = visibleRanges(selfId, datasets);
  for (const call of calls) {
    const kept = prior.find((b) => b.name === call.name && b.id !== null && all.some((r) => r.id === b.id));
    const matches = kept ? all.filter((r) => r.id === kept.id) : visible.filter((r) => r.name.toLowerCase() === call.name.toLowerCase());
    if (matches.length !== 1) return { error: `no named range "${call.name}" on this worksheet or its workbook (define one first)` };
    const range = matches[0];
    const problem = rangeProblem(range);
    if (problem) return { error: problem };
    const home = datasets.find((d) => d.id === range.target.datasetId);
    if (!home) return { error: `the worksheet of named range "${range.name}" no longer exists` };
    if (home.id !== selfId && home.pending) return { error: `"${home.name}" has not loaded its full data yet — open it (or wait for it to load), then add the formula` };
    const column = rangeColumn(range, call.n, channelLetter);
    if ("error" in column) return { error: column.error };
    if (!ranges.some((b) => b.id === range.id)) ranges.push({ name: call.name, id: range.id });
    // A block of another worksheet draws ds:block -> ds:this; a block of this one makes its columns inputs of the new column.
    const edges =
      home.id === selfId
        ? target === undefined ? [] : range.target.cols.map((c) => ({ from: recalcNodes.column(selfId, c < 0 ? "x" : channelLetter(c)), to: recalcNodes.column(selfId, target) }))
        : [{ from: recalcNodes.dataset(home.id), to: recalcNodes.dataset(selfId) }];
    for (const edge of edges) {
      const reason = wouldCreateCycle(datasets, edge);
      if (reason) return { error: reason };
    }
  }
  return { ranges: ranges.length ? ranges : undefined };
}

/** Range `id` was renamed: every formula linked to it shows the new name. A formula that ALSO links another range under
 *  that same name keeps its old text (the link still holds by id; two links cannot share one name). */
export function renameRangeRefs(datasets: readonly Dataset[], id: string, newName: string): { datasets: Dataset[]; changed: string[] } {
  const changed: string[] = [];
  const out = datasets.map((d) => {
    let hit = false;
    const formulas = d.formulas?.map((f) => {
      const binding = f.ranges?.find((b) => b.id === id);
      if (!binding || binding.name === newName || f.ranges!.some((b) => b.name === newName && b.id !== id)) return f;
      let expr = f.expr;
      for (const call of rangeCalls(f.expr).reverse()) if (call.name === binding.name) expr = expr.slice(0, call.nameAt) + `"${newName}"` + expr.slice(call.nameEnd);
      hit = true;
      return { ...f, expr, ranges: f.ranges!.map((b) => (b.id === id ? { ...b, name: newName } : b)) };
    });
    if (hit) changed.push(d.id);
    return hit ? { ...d, formulas } : d;
  });
  return { datasets: changed.length ? out : (datasets as Dataset[]), changed };
}

/** The formula columns linked to range `id`, as "Worksheet › Column". */
export function rangeReaderLabels(datasets: readonly Dataset[], id: string): string[] {
  return datasets.flatMap((d) => (d.formulas ?? []).filter((f) => f.ranges?.some((b) => b.id === id)).map((f) => `${d.name} › ${f.name}`));
}

/** The worksheets holding a formula linked to one of `ids` (every range when `ids` is undefined). */
export function rangeReaderIds(datasets: readonly Dataset[], ids?: ReadonlySet<string>): Set<string> {
  return new Set(datasets.filter((d) => d.formulas?.some((f) => f.ranges?.some((b) => b.id !== null && (!ids || ids.has(b.id))))).map((d) => d.id));
}

/** Range `id` was removed: the links to it are cut (`id: null`), so its readers error instead of freezing on their last
 *  values and never re-attach to a later range that happens to carry the same name. */
export function cutRangeRefs(datasets: readonly Dataset[], id: string): { datasets: Dataset[]; changed: string[] } {
  const changed: string[] = [];
  const out = datasets.map((d) => {
    let hit = false;
    const formulas = d.formulas?.map((f) => {
      if (!f.ranges?.some((b) => b.id === id)) return f;
      hit = true;
      return { ...f, ranges: f.ranges.map((b) => (b.id === id ? { ...b, id: null } : b)) };
    });
    if (hit) changed.push(d.id);
    return hit ? { ...d, formulas } : d;
  });
  return { datasets: changed.length ? out : (datasets as Dataset[]), changed };
}
