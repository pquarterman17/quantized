// Worksheet conditional formatting: what colour a cell gets (rule model and
// sanitizer: lib/worksheetRulesModel.ts). Display only, and drawn for the rows
// the grid windows in, never the whole sheet: `compileCellRules` does ONE pass
// over a column that has a scale (to find its min..max), and the per-cell
// lookup is then a few comparisons.
//
// Colours are CSS `color-mix` over design tokens, softened into the cell's own
// surface so the number keeps its contrast in every theme and accent.

import type { CellRule, CellRules, RuleTone, ScaleRule, ValueRule } from "./worksheetRulesModel";

/** How strongly a rule colour tints the cell surface (percent). */
const TINT = 30;

const tok = (t: RuleTone) => `var(--${t})`;
const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
const soften = (c: string) => mix(c, TINT, "var(--surface-0)");

/** True when `v` meets a value rule. NaN matches a missing or NaN cell only. */
export function matchesValueRule(rule: ValueRule, v: number | undefined): boolean {
  if (rule.op === "nan") return v === undefined || Number.isNaN(v);
  if (v === undefined || Number.isNaN(v) || rule.a === undefined) return false;
  if (rule.op === ">") return v > rule.a;
  if (rule.op === "<") return v < rule.a;
  return rule.b !== undefined && v >= rule.a && v <= rule.b;
}

/** The scale colour at `t` in [0, 1]: a 2-stop blend, or 3-stop through `mid`. */
export function scaleColour(rule: ScaleRule, t: number): string {
  const x = Math.min(1, Math.max(0, t));
  if (!rule.mid) return soften(mix(tok(rule.high), Math.round(x * 100), tok(rule.low)));
  return soften(
    x < 0.5
      ? mix(tok(rule.mid), Math.round(x * 200), tok(rule.low))
      : mix(tok(rule.high), Math.round((x - 0.5) * 200), tok(rule.mid)),
  );
}

/** The cell background a column's rules give `v`, or `undefined`: a value rule
 *  wins (first match), else the scale colours finite values over `range`
 *  (min == max: no scale, there is nothing to rank). */
export function cellBackground(rules: readonly CellRule[], v: number | undefined, range: { min: number; max: number } | null): string | undefined {
  for (const r of rules) if (r.kind === "value" && matchesValueRule(r, v)) return soften(tok(r.tone));
  const scale = rules.find((r): r is ScaleRule => r.kind === "scale");
  if (!scale || !range || v === undefined || !Number.isFinite(v) || range.max <= range.min) return undefined;
  return scaleColour(scale, (v - range.min) / (range.max - range.min));
}

/** The grid's lookup: column and value to background. Built once per rule or
 *  data change; a column with no rules costs one property read per cell. */
export type CellTint = (col: number, v: number | undefined) => string | undefined;

export function compileCellRules(rules: CellRules | undefined, values: readonly (readonly number[])[]): CellTint | undefined {
  if (!rules) return undefined;
  const ranges = new Map<number, { min: number; max: number } | null>();
  for (const [k, list] of Object.entries(rules)) {
    if (!list.some((r) => r.kind === "scale")) continue;
    const col = Number(k);
    let min = Infinity;
    let max = -Infinity;
    for (const row of values) {
      const v = row?.[col];
      if (v !== undefined && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    ranges.set(col, min <= max ? { min, max } : null);
  }
  return (col, v) => {
    const list = rules[col];
    return list ? cellBackground(list, v, ranges.get(col) ?? null) : undefined;
  };
}
