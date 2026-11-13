// Cross-worksheet formula references — `sheet("Name", A)` — bound by IDENTITY
// (review of worksheet audit #17). Part of the lazy formula module
// (lib/formulaRefs.ts registers these with lib/formulaExt.ts).
//
// The text of a formula shows the worksheet's NAME, because that is what a
// person reads; what the formula is LINKED to is the worksheet's id, recorded
// on the column as `ComputedColumn.sheets` ({ name, id }) when the formula is
// added. Everything else follows from never resolving by name again:
//
//   - RENAME the referenced worksheet: the link holds, and the formula text is
//     rewritten to the new name (`renameSheetRefs`).
//   - DELETE it: the link is cut (`id: null`) and the formula becomes an error
//     ("worksheet … was removed"). A later worksheet that happens to carry the
//     same name is NOT picked up (`cutSheetRefs`, lib/sheetBindings.ts).
//   - Two worksheets with the same name at bind time: refused — rename one.
//   - REMOVE / INSERT a column in the referenced worksheet: the letter in the
//     reader's formula shifts with its column, exactly as a within-sheet
//     reference does; a reference to the removed column itself becomes an
//     explicit error, never whatever slid into that letter (`shiftSheetRefs`).
//   - APPEND a project: links are remapped through the append's id table like
//     `bgRef`; one whose target did not come along is cut (`remapSheetRefIds`,
//     lib/sheetBindings.ts).
//   - A worksheet cannot read itself, and a circular chain of worksheets is
//     refused at bind time (the store checks lib/recalc.ts's graph).
//   - A lazy Origin book that has not loaded its full rows is refused rather
//     than read as its 1-row preview.

import { type ColumnShift, remapChannel } from "./channelRemap";
import { channelLetter } from "./formula";
import { channelIndexOf } from "./formulaRename";
import { tokenize } from "./formulaTokenize";
import type { Tok } from "./formulaTypes";
import type { ComputedColumn, Dataset, SheetBinding } from "./types";

/** The placeholder letter a reference to a removed column is rewritten to. */
export const REMOVED_COLUMN = "__removed__";

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;

interface SheetCall {
  name: string;
  /** Source offsets of the quoted name and of the column letter. */
  nameAt: number;
  nameEnd: number;
  col: string;
  colAt: number;
}

/** Every `sheet("Name", L)` call in `expr`, in source order. */
function sheetCalls(expr: string): SheetCall[] {
  let toks: Tok[];
  try {
    toks = tokenize(expr);
  } catch {
    return [];
  }
  const out: SheetCall[] = [];
  for (let i = 0; i + 4 < toks.length; i++) {
    const [t, open, name, comma, col] = [toks[i], toks[i + 1], toks[i + 2], toks[i + 3], toks[i + 4]];
    if (!(t.t === "name" && t.v === "sheet" && isOp(open, "(") && name.t === "str" && isOp(comma, ",") && col.t === "name")) continue;
    if (name.p === undefined || col.p === undefined) continue;
    out.push({ name: name.v, nameAt: name.p, nameEnd: name.p + name.v.length + 2, col: col.v, colAt: col.p });
  }
  return out;
}

/** The worksheet names a formula reads through `sheet("Name", …)`. */
export function sheetNamesRead(expr: string): string[] {
  return [...new Set(sheetCalls(expr).map((c) => c.name))];
}

/** Link every `sheet("Name", …)` in `expr` to a worksheet. A name already
 *  linked in `prior` (the column being edited) keeps its link while that
 *  worksheet exists — an edit never silently re-points it. Returns the
 *  bindings, or why the formula is refused. */
export function bindSheets(
  expr: string,
  datasets: readonly Dataset[],
  selfId: string,
  prior: readonly SheetBinding[] = [],
): { sheets: SheetBinding[] } | { error: string } {
  const sheets: SheetBinding[] = [];
  for (const name of sheetNamesRead(expr)) {
    const kept = prior.find((b) => b.name === name && b.id !== null && datasets.some((d) => d.id === b.id));
    const named = datasets.filter((d) => d.name === name);
    if (!kept && named.length === 0) return { error: `no worksheet named "${name}"` };
    if (!kept && named.length > 1)
      return { error: `"${name}" names ${named.length} worksheets, so sheet("${name}", …) is ambiguous — rename one of them first` };
    const target = kept ? datasets.find((d) => d.id === kept.id)! : named[0];
    if (target.id === selfId) return { error: `a worksheet cannot read itself through sheet("${name}", …) — use the column letter` };
    if (target.pending) return { error: `"${name}" has not loaded its full data yet — open it (or wait for it to load), then add the formula` };
    sheets.push({ name, id: target.id });
  }
  return { sheets };
}

const quoted = (name: string): string | null => (!name.includes('"') ? `"${name}"` : !name.includes("'") ? `'${name}'` : null);

function mapFormulas(datasets: readonly Dataset[], fn: (f: ComputedColumn, d: Dataset) => ComputedColumn): { datasets: Dataset[]; changed: string[] } {
  const changed: string[] = [];
  const out = datasets.map((d) => {
    if (!d.formulas?.some((f) => f.sheets?.length)) return d;
    const formulas = d.formulas.map((f) => (f.sheets?.length ? fn(f, d) : f));
    if (formulas.every((f, i) => f === d.formulas![i])) return d;
    changed.push(d.id);
    return { ...d, formulas };
  });
  return { datasets: changed.length ? out : (datasets as Dataset[]), changed };
}

/** Worksheet `id` was renamed: every formula linked to it shows the new name.
 *  A formula that ALSO links another worksheet under that same name keeps its
 *  old text (the link still holds by id; two links cannot share one name). */
export function renameSheetRefs(datasets: readonly Dataset[], id: string, newName: string): { datasets: Dataset[]; changed: string[] } {
  const text = quoted(newName);
  return mapFormulas(datasets, (f) => {
    const binding = f.sheets!.find((b) => b.id === id);
    if (!binding || binding.name === newName || !text) return f;
    if (f.sheets!.some((b) => b.name === newName && b.id !== id)) return f;
    let expr = f.expr;
    for (const call of sheetCalls(f.expr).reverse()) {
      if (call.name === binding.name) expr = expr.slice(0, call.nameAt) + text + expr.slice(call.nameEnd);
    }
    return { ...f, expr, sheets: f.sheets!.map((b) => (b.id === id ? { ...b, name: newName } : b)) };
  });
}

/** A column of worksheet `id` was removed or inserted: shift the letters the
 *  readers' formulas name in it; a reference to the removed column itself is
 *  rewritten to REMOVED_COLUMN (an explicit evaluation error). */
export function shiftSheetRefs(datasets: readonly Dataset[], id: string, shift: ColumnShift): { datasets: Dataset[]; changed: string[] } {
  return mapFormulas(datasets, (f, d) => {
    const names = new Set(f.sheets!.filter((b) => b.id === id).map((b) => b.name));
    if (!names.size || d.id === id) return f;
    let expr = f.expr;
    for (const call of sheetCalls(f.expr).reverse()) {
      if (!names.has(call.name)) continue;
      const index = channelIndexOf(call.col); // null for `x` / the placeholder
      if (index === null) continue;
      const next = remapChannel(index, shift);
      const letter = next === null ? REMOVED_COLUMN : channelLetter(next);
      if (letter !== call.col) expr = expr.slice(0, call.colAt) + letter + expr.slice(call.colAt + call.col.length);
    }
    return expr === f.expr ? f : { ...f, expr };
  });
}
