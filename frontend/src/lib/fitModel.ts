// Fit Model (GAP_AUDIT_9 G1): the pure half of the workshop. Model building
// (JMP's Construct Model Effects: Add, Cross, Full Factorial, Polynomial to
// degree 2), term labels, and the request body for `/api/stats/fit-model`
// built from the ANALYSIS VIEW of the worksheet (excluded and filtered rows
// already dropped by lib/analysisInputs, the same chokepoint every other
// statistics tool reads).
//
// A term is a list of column keys (-1 = the X column, 0.. = value channels);
// a repeated key is a polynomial power (`[t, t]` = t²). Terms compare
// order-free (`A*B` is `B*A`).
//
// Factor kind comes from the column's modeling type: continuous stays
// continuous; nominal AND ordinal become nominal factors with JMP's effect
// coding (provisional, owner to confirm: JMP codes ordinal factors with a
// cumulative coding instead, which changes the parameter estimates but not the
// effect tests, the fit or the LS means). The kinds are recorded in the recipe
// so a saved result reruns with the kinds it was fitted with.

import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels, columnOf } from "./categorical";
import type { FitModelBody } from "./api/statsModel";
import { termKey, type FitModelRecipe } from "./fitModelRecipe";
import { isTextKey, textKeyIndex } from "./fitModelText";
import type { DataStruct } from "./types";

export type ModelTerm = readonly number[];
export { termKey, type FitModelRecipe } from "./fitModelRecipe";

export function termLabel(term: ModelTerm, labelOf: (col: number) => string): string {
  return term.map(labelOf).join("*");
}

export function hasTerm(terms: readonly ModelTerm[], term: ModelTerm): boolean {
  const key = termKey(term);
  return terms.some((t) => termKey(t) === key);
}

function withTerms(terms: readonly ModelTerm[], add: readonly ModelTerm[]): number[][] {
  const out = terms.map((t) => [...t]);
  for (const t of add) if (t.length && !hasTerm(out, t)) out.push([...t]);
  return out;
}

/** Add each selected column as a main effect. */
export function addMainEffects(terms: readonly ModelTerm[], cols: readonly number[]): number[][] {
  return withTerms(terms, cols.map((c) => [c]));
}

/** Cross the selected columns into one interaction term (needs 2+). */
export function crossTerms(terms: readonly ModelTerm[], cols: readonly number[]): number[][] {
  return cols.length < 2 ? terms.map((t) => [...t]) : withTerms(terms, [[...cols]]);
}

/** Every main effect and every interaction of the selected columns, lowest order first. */
export function fullFactorial(terms: readonly ModelTerm[], cols: readonly number[]): number[][] {
  const subsets: number[][] = [];
  const n = Math.min(cols.length, 6); // 2^6 - 1 = 63 terms: enough, never runaway
  for (let mask = 1; mask < 1 << n; mask++) {
    subsets.push(cols.slice(0, n).filter((_, i) => mask & (1 << i)));
  }
  subsets.sort((a, b) => a.length - b.length);
  return withTerms(terms, subsets);
}

/** JMP "Polynomial to Degree 2" for the selected CONTINUOUS columns: main
 *  effects, squares and pairwise crosses. Nominal columns get main effects only. */
export function polynomialDegree2(
  terms: readonly ModelTerm[],
  cols: readonly number[],
  isContinuous: (col: number) => boolean,
): number[][] {
  const cont = cols.filter(isContinuous);
  const add: number[][] = cols.map((c) => [c]);
  for (const c of cont) add.push([c, c]);
  for (let i = 0; i < cont.length; i++) for (let j = i + 1; j < cont.length; j++) add.push([cont[i]!, cont[j]!]);
  return withTerms(terms, add);
}

export function removeTerms(terms: readonly ModelTerm[], remove: readonly string[]): number[][] {
  const drop = new Set(remove);
  return terms.filter((t) => !drop.has(termKey(t))).map((t) => [...t]);
}

/** The columns a model uses, in first-use order. */
export function modelColumns(terms: readonly ModelTerm[]): number[] {
  const out: number[] = [];
  for (const t of terms) for (const c of t) if (!out.includes(c)) out.push(c);
  return out;
}

/** Why a model cannot be sent yet (client-side; the server refuses the rest), or null. */
export function modelProblem(recipe: FitModelRecipe, columnCount: number, textCount = 0): string | null {
  if (recipe.terms.length === 0) return "Add at least one effect to the model.";
  const cols = modelColumns(recipe.terms);
  if (cols.includes(recipe.responseCol)) return "The response cannot also be a model effect.";
  if (isTextKey(recipe.responseCol)) return "The response must be a numeric column, not a text column.";
  const gone = (c: number) => (isTextKey(c) ? textKeyIndex(c) >= textCount : c < -1 || c >= columnCount);
  if ([recipe.responseCol, ...cols].some(gone)) return "A model column no longer exists.";
  for (const t of recipe.terms) {
    for (const c of new Set(t)) {
      if (recipe.kinds[String(c)] === "nominal" && t.filter((v) => v === c).length > 1) {
        return "A nominal factor cannot be raised to a power; polynomial terms need a continuous column.";
      }
    }
  }
  return null;
}

/** Level labels of a nominal column, in the worksheet's level order. Labels
 *  that collide (two codes, one text) get the code appended so a level is
 *  never silently merged. */
function nominalColumn(data: DataStruct, col: number): { values: (string | null)[]; levels: string[] } {
  const codes = categoryLevels(data, col);
  const labels = resolveCategoryLabels(data, col, codes);
  const seen = new Map<string, number>();
  for (const l of labels) seen.set(l, (seen.get(l) ?? 0) + 1);
  const unique = labels.map((l, i) => (seen.get(l)! > 1 ? `${l} (${codes[i]})` : l));
  const byCode = new Map(codes.map((c, i) => [c, unique[i]!]));
  const values = columnOf(data, col).map((v) => (Number.isFinite(v) ? byCode.get(v) ?? null : null));
  return { values, levels: unique };
}

/** The request body for one fit, from the analysis-view `data`. */
export function buildFitModelBody(
  data: DataStruct,
  recipe: FitModelRecipe,
  labelOf: (col: number) => string,
  /** The cell of each text (sidecar) column a model uses, per request row (lib/fitModelText.textFactorValues). */
  textValues: ReadonlyMap<number, (string | null)[]> = new Map(),
): FitModelBody {
  const cols = modelColumns(recipe.terms);
  const names = new Map<number, string>();
  const used = new Set<string>();
  for (const c of cols) {
    let name = labelOf(c) || `col ${c}`;
    while (used.has(name)) name = `${name}′`; // two columns with one label stay two factors
    used.add(name);
    names.set(c, name);
  }
  const factors = cols.map((c) => {
    const kind = recipe.kinds[String(c)] ?? "continuous";
    const text = textValues.get(c);
    if (isTextKey(c) && !text) throw new Error(`text column ${c} has no values to fit`); // never fall through to the time axis
    if (text) return { name: names.get(c)!, kind: "nominal" as const, values: text };
    if (kind === "nominal") return { name: names.get(c)!, kind, ...nominalColumn(data, c) };
    return { name: names.get(c)!, kind, values: columnOf(data, c).map((v) => (Number.isFinite(v) ? v : null)) };
  });
  return {
    response_name: labelOf(recipe.responseCol),
    response: columnOf(data, recipe.responseCol).map((v) => (Number.isFinite(v) ? v : null)),
    factors,
    terms: recipe.terms.map((t) => t.map((c) => names.get(c)!)),
    center_polynomials: recipe.center,
  };
}
