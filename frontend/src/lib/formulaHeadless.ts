// Which worksheet formulas the exported Python script can reproduce (gap audit
// 5, item 6). `quantized.api.add_formula_columns` (calc/column_formula.py)
// evaluates the ELEMENT-WISE subset of the formula language: `x`, column
// letters, numbers, + - * / // % ^ **, parentheses, pi / e / nan and the plain
// function table (lib/formulaFuncs.ts). Anything else — comparisons and
// conditionals, and/or/not, A[i], quoted text (col("Name"), sheet(), fit()),
// the row-aware and aggregate forms (row(), lag, diff, cumsum, mean(A),
// min(A)), rng("Name") named ranges, complex numbers (complex(), re(), 2i, …), round/rnd/interp and a column named by its long name — is evaluated
// only in the app, so the exporter keeps it as an honest "NOT REPRODUCED".
//
// This is a TOKEN check over the app's own tokenizer plus a full compile with
// the app's own parser: an expression that passes has exactly the grammar the
// Python side parses. lib/formulaHeadless.test.ts pins the agreement both
// ways through a fixture tests/test_column_formula.py replays.

import { compileFormula } from "./formula";
import { COMPLEX_NAMES } from "./formulaComplexNames";
import { DIST_NAMES } from "./formulaDistNames";
import { CONSTS, FUNCS } from "./formulaFuncs";
import { tokenize } from "./formulaTokenize";
import { WAVE2_NAMES } from "./formulaWave2Names";

/** calc/column_formula.py MAX_LEN. */
const MAX_LEN = 10000;
const OPS = new Set(["+", "-", "*", "/", "//", "%", "^", "**", "(", ")", ","]);
/** Row-aware / special forms the app parses before the plain table. */
const APP_ONLY = new Set(["if", "where", "row", "lag", "diff", "cumsum", "col", "sheet", "rng", "fit", "fitval"]);

/** Why `expr` is outside the headless subset, or null. */
export function headlessFormulaProblem(expr: string): string | null {
  if (expr.length > MAX_LEN) return `it is longer than ${MAX_LEN} characters`;
  let toks;
  try {
    toks = tokenize(expr);
  } catch (e) {
    return e instanceof Error ? e.message : "it does not parse";
  }
  // Complex numbers (plans/COMPLEX_FORMULA_CONTRACT.md C8) are evaluated only in the app. Checked before the
  // compile, which would need the lazy complex module, and by name so the message says what was used.
  for (const [i, t] of toks.entries()) {
    if (t.t !== "name" || !COMPLEX_NAMES.has(t.v) || !(toks[i + 1]?.t === "op" && toks[i + 1].v === "(")) continue;
    const literal = t.v === "complex" && /^[0-9.]/.test(expr[t.p ?? 0] ?? "");
    return literal ? "it uses an imaginary literal such as 2i (complex numbers are evaluated only in the app)" : `it uses complex numbers: ${t.v}() is evaluated only in the app`;
  }
  // A named range (ROW_RANGE_CONTRACT 5.2) is a block of the project's own state, so the script cannot reproduce it.
  if (toks.some((t, i) => t.t === "name" && t.v === "rng" && toks[i + 1]?.t === "op" && toks[i + 1].v === "(")) return 'it uses rng(), a named range (evaluated only in the app)';
  try {
    compileFormula(expr);
  } catch (e) {
    return e instanceof Error ? e.message : "it does not parse";
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.t === "str") return "it uses quoted text (col(), sheet(), fit())";
    if (t.t === "op" && !OPS.has(t.v)) return `it uses "${t.v}" (comparisons, conditionals and row indexing)`;
    if (t.t !== "name") continue;
    if (next?.t === "op" && next.v === "(") {
      if (APP_ONLY.has(t.v) || !(Object.hasOwn(FUNCS, t.v) || DIST_NAMES.has(t.v) || WAVE2_NAMES.has(t.v))) return `it calls ${t.v}()`;
      const arg = toks[i + 2];
      const close = toks[i + 3];
      if ((t.v === "min" || t.v === "max") && arg?.t === "name" && !Object.hasOwn(CONSTS, arg.v) && close?.t === "op" && close.v === ")") {
        return `${t.v}(${arg.v}) is a column aggregate`;
      }
      continue;
    }
    if (Object.hasOwn(CONSTS, t.v) || t.v === "x" || /^[A-Z]+$/.test(t.v)) continue;
    return `"${t.v}" is not x or a column letter`;
  }
  return null;
}
