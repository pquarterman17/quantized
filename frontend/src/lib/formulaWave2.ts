// The wave-2 additions to the LAZY formula chunk's call chain, kept in one
// place so lib/formulaRefs.ts (near its line budget) adds one import.

import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn } from "./formulaTypes";
import { parseLet } from "./formulaLet";

export function tryParseWave2Call(fname: string, ops: ParserOps): FormulaFn | undefined {
  return fname === "let" ? parseLet(ops) : undefined;
}

export const WAVE2_FUNCS: Record<string, (...a: number[]) => number> = {};
