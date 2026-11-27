// The names and the one message of the complex-number formula syntax
// (plans/COMPLEX_FORMULA_CONTRACT.md), in a leaf of their own so the code that
// only needs to RECOGNISE the syntax — the headless check, the derived-unit
// parser, the Set Column Values dialog — never pulls in the evaluator
// (lib/formulaComplex.ts, a lazy chunk).

/** The functions that make or take apart a complex value. `complex` and
 *  `polar` are the only sources of one (an imaginary literal such as `2i` is
 *  read by the tokenizer as `complex(0, 2)`). */
export const COMPLEX_NAMES: ReadonlySet<string> = new Set(["complex", "polar", "re", "real", "im", "imag", "arg", "angle", "conj"]);

/** What a formula whose result is complex reports (contract C6). */
export const COMPLEX_RESULT_ERROR = "the result is complex: wrap it in re(), im(), abs() or arg(), or write both parts as two columns";

/** The one action Set Column Values offers for a complex result (C7). */
export const COMPLEX_SPLIT_LABEL = "Write the real and imaginary parts as two columns";

/** The suffix a name gets in the two-column form (contract C7). */
export const COMPLEX_PARTS = ["re", "im"] as const;
