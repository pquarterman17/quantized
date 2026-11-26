// The wave-2 additions to the LAZY formula chunk, kept in one place so
// lib/formulaRefs.ts (near its line budget) adds one import:
//
//   let(...)                         lib/formulaLet.ts
//   lookup / index / offset / …      lib/formulaLookup.ts
//   element-wise functions           WAVE2_FUNCS: lib/formulaSpecialFns.ts
//                                    (erfinv, beta, digamma, Bessel J/Y, …) and
//                                    lib/formulaEngineering.ts

import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn } from "./formulaTypes";
import { ENGINEERING_FUNCS } from "./formulaEngineering";
import { parseLet } from "./formulaLet";
import { tryParseLookupCall } from "./formulaLookup";
import { besselj, bessely, beta, digamma, erfcinv, erfinv, lbeta } from "./formulaSpecialFns";

export function tryParseWave2Call(fname: string, ops: ParserOps): FormulaFn | undefined {
  return fname === "let" ? parseLet(ops) : tryParseLookupCall(fname, ops);
}

/** Missing arguments are blank (NaN) cells, as everywhere in the element-wise tables. */
const fixed =
  (n: number, f: (...a: number[]) => number) =>
  (...a: number[]): number =>
    a.length < n ? NaN : f(...a.slice(0, n));

export const WAVE2_FUNCS: Record<string, (...a: number[]) => number> = {
  ...ENGINEERING_FUNCS,
  erfinv: fixed(1, erfinv),
  erfcinv: fixed(1, erfcinv),
  beta: fixed(2, beta),
  lbeta: fixed(2, lbeta),
  digamma: fixed(1, digamma),
  besselj: fixed(2, besselj),
  bessely: fixed(2, bessely),
};
