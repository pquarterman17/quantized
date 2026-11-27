// `let(name, value, …, expr)` — Excel's LET (plan item 28). Part of the LAZY
// formula chunk: lib/formulaWave2.ts hands `let(` to `parseLet` after the
// eager parser has eaten the name and the open paren.
//
//   let(t, A * 2, u, t + B, u / t)
//
// Names are bound left to right: a value may use the names bound before it
// (not its own or a later one), and the last argument may use all of them. A
// bound name is a SCALAR of the row being evaluated, so it is not a column
// reference — it is not reported through `ref` (no dependency on a column of
// that name, no column-shift rewrite), and it wins over a column or constant of
// the same name inside the call. Outside the call the name means what it did
// before. Shadowing works as in Excel: an inner let (or a later binding of the
// same name) hides the outer one, only inside its own scope.
//
// A name used before it is bound is not special: it is read as whatever it
// would be without the let (a column, a constant) or, failing that, reported
// as `unknown variable` — never as a silent 0.
//
// A bound name cannot be the bare column argument of lag/diff/an aggregate
// (`lag(t, 1)`): those read a whole column, and `t` is one number. The parser
// (lib/formulaParser.ts `ref`) says so. The tree parser used for units and
// error propagation (lib/derivedExprAst.ts) expands a let by substitution, so
// they see the formula with each bound name replaced by its value.
//
// Row-local when its arguments are: nothing here reads another row, so a
// single-row incremental recompute stays valid (formulaIncremental.ts).

import type { ParserOps } from "./formulaRowFns";
import type { FormulaFn, Tok } from "./formulaTypes";

const parseValue = (ops: ParserOps): FormulaFn => (ops.parseValue ?? ops.parseExpr)();
const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;
const KEYWORDS = new Set(["and", "or", "not"]);

/** `let(` (name and paren already eaten) parsed through the closing paren. */
export function parseLet(ops: ParserOps): FormulaFn {
  const steps: { name: string; value: FormulaFn }[] = [];
  const unbind: (() => void)[] = [];
  try {
    for (let t = ops.peek(); t?.t === "name" && isOp(ops.peekAt(1), ","); t = ops.peek()) {
      if (KEYWORDS.has(t.v)) throw new Error(`let() cannot bind "${t.v}": it is an operator`);
      ops.eat();
      ops.eat();
      const value = parseValue(ops);
      if (isOp(ops.peek(), ")")) throw new Error(`let(): "${t.v}" has a value but the call needs a final expression after it`);
      ops.expectOp(",");
      steps.push({ name: t.v, value });
      unbind.push(ops.bind(t.v)); // visible to the NEXT value and the final expression only
    }
    if (!steps.length) throw new Error("let() takes name, value pairs and then an expression, e.g. let(t, A * 2, t + 1)");
    const body = parseValue(ops);
    ops.expectOp(")");
    return (c, ex) => {
      let scope = c;
      for (const s of steps) {
        const v = s.value(scope, ex);
        // A fresh layer per binding: inherits everything outside, and defineProperty
        // (not assignment) keeps a name like `__proto__` an ordinary binding.
        scope = Object.create(scope) as Record<string, number>;
        Object.defineProperty(scope, s.name, { value: v, enumerable: true });
      }
      return body(scope, ex);
    };
  } finally {
    unbind.forEach((u) => u());
  }
}
