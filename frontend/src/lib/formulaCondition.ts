// Conditions for the conditional aggregates (sumif, countif, averageif,
// maxifs, minifs), written the way Excel and Origin write them:
//
//   ">5"   ">=2"   "<=0.5"   "<>0"   "=3"   "3"   "Fe"   "<>Fe"   "=Fe"
//
// An operator (`=`, `<>`, `<`, `<=`, `>`, `>=`) then a value; no operator
// means `=`. A value that is a plain decimal number compares as a number,
// anything else as text. `<`, `<=`, `>` and `>=` need a number. `==` and `!=`
// are refused with the spelling to use instead. Text equality ignores case
// and surrounding spaces, as Excel's does; there are no wildcards.
//
// A blank (non-finite) numeric cell matches nothing, `<>` included. A text
// condition on a numeric column is an error, not a silent "no rows" (the
// formula language's `A == "text"` does the same). The parser is a regex and
// a number test: no eval, no dynamic code.

export type CondOp = "=" | "<>" | "<" | "<=" | ">" | ">=";

export interface Condition {
  op: CondOp;
  /** The value as written, trimmed. */
  operand: string;
  /** The value as a number, or null when it is text. */
  num: number | null;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** The condition `src` means, or throws saying what is wrong with it. */
export function parseCondition(src: string): Condition {
  const text = src.trim();
  if (/^(==|!=)/.test(text)) throw new Error(`condition "${src}": write "=" or "<>", not "${text.slice(0, 2)}"`);
  const m = /^(<=|>=|<>|=|<|>)?\s*([\s\S]*)$/.exec(text);
  const op = (m?.[1] ?? "=") as CondOp;
  const operand = (m?.[2] ?? "").trim();
  if (operand === "") throw new Error(`condition "${src}" has no value after the operator, e.g. ">5" or "<>0"`);
  const num = NUMBER.test(operand) && Number.isFinite(Number(operand)) ? Number(operand) : null;
  if (num === null && op !== "=" && op !== "<>") throw new Error(`condition "${src}": "${operand}" is not a number, and ${op} compares numbers only`);
  return { op, operand, num };
}

/** A numeric condition (`sumif(A, 3, B)` writes the number itself) is "= number". */
export const equalsNumber = (n: number): Condition => ({ op: "=", operand: String(n), num: n });

function compare(op: CondOp, v: number, n: number): boolean {
  switch (op) {
    case "=":
      return v === n;
    case "<>":
      return v !== n;
    case "<":
      return v < n;
    case "<=":
      return v <= n;
    case ">":
      return v > n;
    case ">=":
      return v >= n;
  }
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Where a range's cells come from: numbers, a categorical's level table, or text. */
export type CondSource =
  | { kind: "number"; label: string; values: readonly number[] }
  | { kind: "levels"; label: string; values: readonly number[]; levels: readonly string[] }
  | { kind: "text"; label: string; cells: readonly string[] };

/** Does row `r` of `src` satisfy `cond`? */
export function matches(cond: Condition, src: CondSource, r: number): boolean {
  if (src.kind === "number") {
    if (cond.num === null) throw new Error(`${src.label} is a numeric column; compare it with a number, not "${cond.operand}"`);
    const v = src.values[r];
    return Number.isFinite(v) && compare(cond.op, v, cond.num);
  }
  if (cond.op !== "=" && cond.op !== "<>") throw new Error(`${src.label} holds text; only "=" and "<>" apply to it`);
  let cell: string | null;
  if (src.kind === "levels") {
    const code = src.values[r];
    cell = Number.isInteger(code) && code >= 0 && code < src.levels.length ? src.levels[code] : null;
  } else {
    cell = src.cells[r] === undefined ? null : String(src.cells[r]);
  }
  if (cell === null) return false;
  return (norm(cell) === norm(cond.operand)) === (cond.op === "=");
}
