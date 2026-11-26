// Math extras workshop: the modes, the form model, and the parsers that turn
// the text fields into request values. Pure (no React, no store) so the wiring
// is unit-testable. Every parser refuses a bad entry with a sentence naming it.

export type MathMode = "polygon-area" | "surface-area" | "trace" | "bspline" | "scatter" | "correlate" | "root" | "optimize";

/** What a mode reads: a curve (two columns), a map, scattered columns, or just an expression. */
export type MathInput = "curve" | "map" | "scatter" | "none";

export const MODES: { value: MathMode; label: string; input: MathInput }[] = [
  { value: "polygon-area", label: "Area enclosed by a curve", input: "curve" },
  { value: "surface-area", label: "Surface area of a map", input: "map" },
  { value: "trace", label: "Resample a curve by arc length", input: "curve" },
  { value: "bspline", label: "B-spline resampling", input: "curve" },
  { value: "scatter", label: "Interpolate 2-D / 3-D data onto points", input: "scatter" },
  { value: "correlate", label: "2-D correlation of two maps", input: "map" },
  { value: "root", label: "Solve f(x) = 0 in a bracket", input: "none" },
  { value: "optimize", label: "Minimise / maximise over a box", input: "none" },
];

export const inputOf = (m: MathMode): MathInput => MODES.find((o) => o.value === m)!.input;

export interface MathForm {
  sizing: "n" | "spacing";
  n: string;
  spacing: string;
  kind: "linear" | "pchip" | "cubic";
  periodic: boolean;
  degree: string;
  smoothing: string;
  dims: "2" | "3";
  method: "linear" | "nearest" | "rbf";
  nearestFill: boolean;
  queries: string;
  /** Where the scattered-interpolation query points come from: typed here, or the columns of a worksheet. */
  queriesFrom: "typed" | "sheet";
  /** Blank cells: false = refuse (default), true = skip (area) / treat as the mean (correlation). */
  blanksOk: boolean;
  expr: string;
  lo: string;
  hi: string;
  target: string;
  constants: string;
  sense: "min" | "max";
  bounds: string;
}

export const emptyForm = (): MathForm => ({
  sizing: "n", n: "200", spacing: "", kind: "linear", periodic: false, degree: "3", smoothing: "0",
  dims: "2", method: "linear", nearestFill: false, queries: "", queriesFrom: "typed", blanksOk: false,
  expr: "", lo: "", hi: "", target: "0", constants: "", sense: "min", bounds: "",
});

export type Parsed<T> = { value: T; error?: undefined } | { value?: undefined; error: string };
const fail = (error: string): { error: string } => ({ error });

/** A required finite number from a field. */
export function finite(text: string, what: string): Parsed<number> {
  const t = text.trim();
  const v = t === "" ? NaN : Number(t);
  return Number.isFinite(v) ? { value: v } : fail(`Enter ${what} as a number.`);
}

/** The point count or the spacing, per the chosen sizing. */
export function parseSizing(f: MathForm): Parsed<{ n?: number; spacing?: number }> {
  if (f.sizing === "n") {
    const n = finite(f.n, "the number of points");
    if (n.error !== undefined) return n;
    if (!Number.isInteger(n.value) || n.value < 2) return fail("The number of points must be a whole number of at least 2.");
    return { value: { n: n.value } };
  }
  const s = finite(f.spacing, "the spacing");
  if (s.error !== undefined) return s;
  return s.value > 0 ? { value: { spacing: s.value } } : fail("The spacing must be above 0.");
}

/** Query points, one per line: `x y` or `x, y, z` (separators: space, comma, semicolon, tab). */
export function parseQueries(text: string, dims: 2 | 3): Parsed<number[][]> {
  const rows: number[][] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[\s,;]+/).filter((p) => p !== "");
    const nums = parts.map(Number);
    if (nums.length !== dims || nums.some((v) => !Number.isFinite(v))) {
      return fail(`Line ${i + 1} needs ${dims} numbers (${dims === 2 ? "x y" : "x y z"}).`);
    }
    rows.push(nums);
  }
  return rows.length > 0 ? { value: rows } : fail(`Enter at least one point to interpolate onto, one per line (${dims === 2 ? "x y" : "x y z"}).`);
}

const NAME = "[A-Za-z][A-Za-z0-9_]*";

/** `name = value` entries separated by commas, semicolons or new lines. */
export function parseConstants(text: string): Parsed<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const item of text.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s !== "")) {
    const m = new RegExp(`^(${NAME})\\s*=\\s*(\\S+)$`).exec(item);
    const v = m ? Number(m[2]) : NaN;
    if (!m || !Number.isFinite(v)) return fail(`"${item}" is not name = number.`);
    if (m[1]! in out) return fail(`${m[1]} is given twice.`);
    out[m[1]!] = v;
  }
  return { value: out };
}

/** `name = low .. high` entries (the separator may also be a comma, colon or space). */
export function parseBounds(text: string): Parsed<Record<string, [number, number]>> {
  const out: Record<string, [number, number]> = {};
  for (const item of text.split(/[\n;]+/).map((s) => s.trim()).filter((s) => s !== "")) {
    const m = new RegExp(`^(${NAME})\\s*[=:]\\s*(\\S+?)\\s*(?:\\.\\.|,|:|\\s)\\s*(\\S+)$`).exec(item);
    const lo = m ? Number(m[2]) : NaN;
    const hi = m ? Number(m[3]) : NaN;
    if (!m || !Number.isFinite(lo) || !Number.isFinite(hi)) return fail(`"${item}" is not name = low .. high.`);
    if (!(lo < hi)) return fail(`${m[1]}: the lower bound must be below the upper bound.`);
    if (m[1]! in out) return fail(`${m[1]} is given twice.`);
    out[m[1]!] = [lo, hi];
  }
  return Object.keys(out).length > 0 ? { value: out } : fail("Give bounds for each variable, one per line: x = 0 .. 5.");
}

/** A number for the result card: 10 significant digits, no trailing zeros. */
export const fmt = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : "—");
