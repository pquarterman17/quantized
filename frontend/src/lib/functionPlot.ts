// Function Plot (Origin's Plot > Function Plot): y = f(x; params) sampled on an
// x range into an ordinary Library dataset. The expression runs on the formula
// engine (lib/formula.ts: no eval), so every worksheet function works and the
// result is plain (x, y) data: the screen and every export (PDF/SVG/Origin)
// draw the same rows, and a graph that contains the curve follows its source
// when the definition is edited (store/linkedCurvesSync).
//
// The definition is stored on the dataset (`data.metadata.functionPlot`), so
// the curve stays editable after a project save and reload.

import { compileFormula } from "./formula";
import type { DataStruct, Dataset } from "./types";

export const MAX_FUNCTION_POINTS = 20000;
const NEEDS_ROWS = "a function of x alone: lag, diff, row and column aggregates (mean, cumsum) need table rows";

export interface FunctionPlotDef {
  /** The right-hand side as typed, e.g. `a*sin(b*x)+c` (a leading `y =` is dropped). */
  expr: string;
  /** Free parameters by name, in order of first use. */
  params: Record<string, number>;
  xMin: number;
  xMax: number;
  n: number;
}

/** The expression without a leading `y =` / `f(x) =` / `y(x) =`. */
export function stripLhs(expr: string): string {
  return expr.replace(/^\s*(?:y|f)\s*(?:\(\s*x\s*\))?\s*=(?!=)/, "").trim();
}

/** The free parameter names of `expr` (every bare name but `x`), or the parse error. */
export function functionParams(expr: string): { params: string[]; error: null } | { params: []; error: string } {
  const body = stripLhs(expr);
  if (!body) return { params: [], error: "enter an expression, e.g. a*sin(b*x)+c" };
  const names: string[] = [];
  try {
    let rowDependent = false;
    compileFormula(
      body,
      (name) => {
        if (name !== "x" && !names.includes(name)) names.push(name);
      },
      () => {
        rowDependent = true;
      },
    );
    if (rowDependent) return { params: [], error: NEEDS_ROWS };
  } catch (e) {
    return { params: [], error: e instanceof Error ? e.message : "invalid expression" };
  }
  return { params: names, error: null };
}

/** Why `def` cannot be sampled, or null. */
export function functionPlotProblem(def: FunctionPlotDef): string | null {
  if (!Number.isFinite(def.xMin) || !Number.isFinite(def.xMax)) return "x range must be numbers";
  if (def.xMin >= def.xMax) return "x min must be below x max";
  if (!Number.isInteger(def.n) || def.n < 2 || def.n > MAX_FUNCTION_POINTS) {
    return `points must be a whole number from 2 to ${MAX_FUNCTION_POINTS}`;
  }
  // Trial evaluation: anything that needs table rows (row(), cumsum, mean...)
  // is refused here, with the engine's own words, never at draw time.
  try {
    compileFormula(stripLhs(def.expr))({ ...def.params, x: def.xMin });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "cannot evaluate";
    return /row context/.test(msg) ? NEEDS_ROWS : msg;
  }
  return null;
}

/** y = f(x) at `n` evenly spaced x in [xMin, xMax]; non-finite results become NaN gaps. */
export function sampleFunction(def: FunctionPlotDef): { x: number[]; y: number[] } {
  const fn = compileFormula(stripLhs(def.expr));
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < def.n; i++) {
    const xi = def.xMin + ((def.xMax - def.xMin) * i) / (def.n - 1);
    const v = fn({ ...def.params, x: xi });
    x.push(xi);
    y.push(Number.isFinite(v) ? v : Number.NaN);
  }
  return { x, y };
}

/** The dataset body for `def`: one channel `y`, with the definition in its metadata. */
export function functionDataStruct(def: FunctionPlotDef): DataStruct {
  const { x, y } = sampleFunction(def);
  return {
    time: x,
    values: y.map((v) => [v]),
    labels: ["y"],
    units: [""],
    metadata: {
      x_column_name: "x",
      x_column_unit: "",
      parser_name: "function_plot",
      functionPlot: { expr: def.expr, params: def.params, xMin: def.xMin, xMax: def.xMax, n: def.n },
    },
  };
}

/** The stored definition of a function-plot dataset, or null for any other. */
export function readFunctionDef(ds: Dataset | undefined): FunctionPlotDef | null {
  const raw = ds?.data.metadata["functionPlot"] as Partial<FunctionPlotDef> | undefined;
  if (!raw || typeof raw.expr !== "string" || typeof raw.xMin !== "number" || typeof raw.xMax !== "number") return null;
  return { expr: raw.expr, params: { ...(raw.params ?? {}) }, xMin: raw.xMin, xMax: raw.xMax, n: raw.n ?? 200 };
}
