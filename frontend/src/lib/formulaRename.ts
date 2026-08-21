// Column-letter rewriting for a formula's `expr`/`deps` when a column
// disappears out from under it — Sol audit P1-3, DEFECT A closure.
// lib/formula.ts resolves every column letter POSITIONALLY at recompute
// time (`channelLetter(index)`): removing a column shifts every LATER
// column's letter down by one, but nothing used to rewrite a SURVIVING
// formula's `expr`/`deps` text to follow that shift — a letter that used to
// name the removed column keeps meaning something (whatever shifted into
// its old position) unless this module explicitly invalidates it. Silently
// reusing the same `expr` against the shifted layout is exactly the
// corruption this closes: base m(A); F1(B)=A*1; F2(C)=A*2; F3(D)=B+C —
// removing F1 must not let F3's untouched "B+C" quietly start reading F2's
// (now at B) data for its old "B" term; F3 must become an ERROR instead.
//
// Rewrite strategy: reparse `expr` through `compileFormula`'s own `onRef`
// hook (formula.ts) to learn EXACTLY which token positions are bare column
// references — the same collection point `referencedColumns` uses, so this
// can never disagree with what the evaluator itself reads. Rename those
// tokens, reserialize with a token-per-token join (safe: whitespace is
// insignificant to the tokenizer, so spacing every token out can never
// accidentally merge two identifiers/numbers into one), and ROUND-TRIP
// verify: recompile the rewritten text and recheck its referenced letters
// are exactly the expected shifted set. Either a compile failure or a
// mismatch means "mark that formula errored rather than guessing" (the
// audit's own words) — this module never installs unverified text.
//
// A formula whose `expr` was ALREADY unparseable before the removal is left
// completely untouched (`ok: true`, same text) — an unrelated column
// disappearing must not overwrite an in-progress broken edit; that formula
// keeps whatever error `lib/formula.ts` already reports for it.

import { channelLetter, compileFormula, referencedColumns, tokenize } from "./formula";
import type { Tok } from "./formulaTypes";
import type { ComputedColumn } from "./types";

/** Inverse of `channelLetter`: "A"->0, "Z"->25, "AA"->26, … `null` for
 *  anything outside the bijective-base-26 uppercase alphabet channel letters
 *  use (the lowercase time column `x`, a function/keyword name — neither of
 *  which `compileFormula`'s `onRef` ever reports as a reference anyway, so
 *  this is a defensive narrow, not a live branch). */
export function channelIndexOf(letter: string): number | null {
  if (!/^[A-Z]+$/.test(letter)) return null;
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}

/** How one column-letter shifts when `removedCol` (0-based, full column
 *  space) disappears: unchanged before it, decremented by one after it, or
 *  flagged `removed` when it WAS that column. */
export function shiftLetter(letter: string, removedCol: number): { letter: string; removed: boolean } {
  const idx = channelIndexOf(letter);
  if (idx === null) return { letter, removed: false };
  if (idx === removedCol) return { letter, removed: true };
  return { letter: idx > removedCol ? channelLetter(idx - 1) : letter, removed: false };
}

const serializeTok = (t: Tok): string => (t.t === "num" ? String(t.v) : t.v);

/** Rewrite `expr`'s column-letter references for a single-column removal.
 *  See module header for the two `ok: false` cases (direct reference to the
 *  removed column; a rewrite that fails to round-trip) vs. the "already
 *  broken, left alone" `ok: true` case. */
export function rewriteFormulaExpr(
  expr: string,
  removedCol: number,
): { ok: true; expr: string } | { ok: false; reason: string } {
  const before = referencedColumns(expr);
  if (!before.valid) return { ok: true, expr }; // pre-existing break, not this removal's concern
  for (const letter of before.letters) {
    if (shiftLetter(letter, removedCol).removed) {
      return { ok: false, reason: `references removed column ${letter}` };
    }
  }
  const renamed = new Map<number, string>(); // token index -> new letter
  compileFormula(expr, (name, tokenIndex) => {
    const shifted = shiftLetter(name, removedCol);
    if (shifted.letter !== name) renamed.set(tokenIndex, shifted.letter);
  });
  if (renamed.size === 0) return { ok: true, expr }; // nothing referenced past removedCol
  const rewritten = tokenize(expr)
    .map((t, i) => (t.t === "name" && renamed.has(i) ? { ...t, v: renamed.get(i)! } : t))
    .map(serializeTok)
    .join(" ");
  const after = referencedColumns(rewritten);
  const expected = new Set(before.letters.map((l) => shiftLetter(l, removedCol).letter));
  const actual = new Set(after.letters);
  const roundTripped = after.valid && expected.size === actual.size && [...expected].every((l) => actual.has(l));
  if (!roundTripped) return { ok: false, reason: "formula could not be rewritten after column removal" };
  return { ok: true, expr: rewritten };
}

/** Remap every SURVIVING formula's `expr`/`deps` (or, for a recode column,
 *  its `recode.sourceLetter`) after removing the column at `removedCol`.
 *  `forcedErrors` is merged into the dataset's `formulaErrors` by the caller
 *  (store/computedColumns.ts) — kept separate from `lib/formula.ts`'s own
 *  error derivation because the exact "references removed column X" wording
 *  only this module can produce (a bare "unknown variable" from the
 *  placeholder expr below wouldn't name the real cause, though it WOULD
 *  still fire as a backstop if this override were ever skipped). */
export function remapSurvivingFormulas(
  formulas: readonly ComputedColumn[],
  removedCol: number,
): { formulas: ComputedColumn[]; forcedErrors: Record<string, string> } {
  const forcedErrors: Record<string, string> = {};
  const out = formulas.map((f) => {
    if (f.recode) {
      const shifted = shiftLetter(f.recode.sourceLetter, removedCol);
      if (shifted.removed) {
        forcedErrors[f.name] = `references removed column ${f.recode.sourceLetter}`;
        return { ...f, expr: "recode(__removed__)", deps: [], recode: { ...f.recode, sourceLetter: "__removed__" } };
      }
      return {
        ...f,
        expr: `recode(${shifted.letter})`,
        deps: [shifted.letter],
        recode: { ...f.recode, sourceLetter: shifted.letter },
      };
    }
    const r = rewriteFormulaExpr(f.expr, removedCol);
    if (!r.ok) {
      forcedErrors[f.name] = r.reason;
      return { ...f, expr: "__removed__", deps: [] };
    }
    return { ...f, expr: r.expr, deps: referencedColumns(r.expr).letters };
  });
  return { formulas: out, forcedErrors };
}
