// Worksheet conditional formatting: the saved rule model and its load-time
// sanitizer (`Dataset.cellRules`, `.dwk` field). Pure and tiny on purpose: the
// grid's colour maths is in lib/worksheetRules.ts (the worksheet's lazy chunk),
// while this file rides with the workspace loader (scripts/check-bundle-size.mjs).
//
// A rule colours a column's cells and nothing else: the stored numbers, copies,
// exports and plots never change. Colours are TONES, names of design tokens
// (`--ok`, `--series-2`, ...), never raw colours, so a rule follows the theme.

/** The design tokens a rule may use: a closed list, so a saved or hand-edited
 *  file can never smuggle a raw colour (or arbitrary CSS) into the grid. */
export const RULE_TONES = ["ok", "warn", "danger", "accent", "series-2", "series-6"] as const;
export type RuleTone = (typeof RULE_TONES)[number];

export const RULE_TONE_LABELS: Record<RuleTone, string> = {
  ok: "Green",
  warn: "Amber",
  danger: "Red",
  accent: "Accent",
  "series-2": "Series 2",
  "series-6": "Series 6",
};

/** NaN matches a missing or NaN cell (not +-Infinity). Between is inclusive. */
export type ValueOp = ">" | "<" | "between" | "nan";
export const VALUE_OPS: readonly ValueOp[] = [">", "<", "between", "nan"];

export interface ValueRule {
  kind: "value";
  op: ValueOp;
  /** The threshold (`>`, `<`) or the lower bound (`between`); absent for `nan`. */
  a?: number;
  /** The upper bound of `between`. */
  b?: number;
  tone: RuleTone;
}

/** A 2-colour scale (low to high) or, with `mid`, a 3-colour one, over the
 *  column's own finite min..max. */
export interface ScaleRule {
  kind: "scale";
  low: RuleTone;
  mid?: RuleTone;
  high: RuleTone;
}

export type CellRule = ValueRule | ScaleRule;
/** Rules by value-column index; within a column the first matching value rule
 *  wins, and the (single) scale colours the cells no value rule claimed. */
export type CellRules = Record<number, CellRule[]>;

/** Rules a column may hold (a rule list is read on every drawn cell). */
export const MAX_RULES_PER_COLUMN = 8;

const isTone = (v: unknown): v is RuleTone => typeof v === "string" && (RULE_TONES as readonly string[]).includes(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One rule, or `null` when it is not exactly a rule this build understands. */
export function sanitizeRule(raw: unknown): CellRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "scale") {
    if (!isTone(r.low) || !isTone(r.high)) return null;
    if (r.mid !== undefined && !isTone(r.mid)) return null;
    return r.mid === undefined ? { kind: "scale", low: r.low, high: r.high } : { kind: "scale", low: r.low, mid: r.mid, high: r.high };
  }
  if (r.kind !== "value" || !isTone(r.tone) || !VALUE_OPS.includes(r.op as ValueOp)) return null;
  const op = r.op as ValueOp;
  if (op === "nan") return { kind: "value", op, tone: r.tone };
  if (!finite(r.a)) return null;
  if (op !== "between") return { kind: "value", op, a: r.a, tone: r.tone };
  if (!finite(r.b) || r.a > r.b) return null;
  return { kind: "value", op, a: r.a, b: r.b, tone: r.tone };
}

/** A column's rules: valid ones only, at most one scale, at most
 *  MAX_RULES_PER_COLUMN; `undefined` when none survive. */
export function sanitizeRuleList(raw: unknown): CellRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CellRule[] = [];
  let scale = false;
  for (const item of raw) {
    const rule = sanitizeRule(item);
    if (!rule || (rule.kind === "scale" && scale)) continue;
    if (rule.kind === "scale") scale = true;
    if (out.length < MAX_RULES_PER_COLUMN) out.push(rule);
  }
  return out.length ? out : undefined;
}

/** Load-time sanitizer for a `.dwk` dataset's `cellRules`: integer keys in
 *  `[0, width)`, each list sanitized; `undefined` when nothing valid remains. */
export function sanitizeCellRules(raw: unknown, width: number): CellRules | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: CellRules = {};
  for (const [k, v] of Object.entries(raw)) {
    const col = Number(k);
    if (!Number.isInteger(col) || col < 0 || col >= width) continue;
    const list = sanitizeRuleList(v);
    if (list) out[col] = list;
  }
  return Object.keys(out).length ? out : undefined;
}
