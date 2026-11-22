// The worksheet's Conditional Format dialog and its column-menu items: up to two
// value rules (>, <, between, NaN) and one 2- or 3-colour scale per column,
// asked through the shared ParamDialog and applied through
// store/worksheetRules.ts (one undo step). Display only.
//
// The form is flat (ParamDialog has no conditional rows), so "between" reads
// both value boxes and the other conditions only the first. A form that cannot
// be read as a rule (an upper bound below the lower one) applies nothing and
// says why: fail closed, never a guessed rule.

import type { ParamField, ParamValues } from "../../../lib/params";
import { RULE_TONES, RULE_TONE_LABELS, type CellRule, type RuleTone, type ValueOp } from "../../../lib/worksheetRulesModel";
import type { Dataset } from "../../../lib/types";
import { refuseRules, setColumnRules } from "../../../store/worksheetRules";
import { askParams } from "../../overlays/ParamDialog";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const NONE = "(none)";
const OPS: Record<string, ValueOp> = { "greater than": ">", "less than": "<", between: "between", "is NaN or empty": "nan" };
const OP_LABELS = Object.keys(OPS);
const SCALES = [NONE, "2-colour", "3-colour"];
const TONES = RULE_TONES.map((t) => RULE_TONE_LABELS[t]);
const toneOf = (label: unknown): RuleTone => RULE_TONES[Math.max(0, TONES.indexOf(String(label)))];
const labelOfOp = (op: ValueOp) => OP_LABELS.find((l) => OPS[l] === op) ?? NONE;

/** The form fields, seeded from a column's current rules (the first two value
 *  rules and the scale; a column's other rules are replaced on apply). */
export function ruleFields(current: readonly CellRule[] = []): ParamField[] {
  const values = current.flatMap((r) => (r.kind === "value" ? [r] : [])).slice(0, 2);
  const scale = current.find((r) => r.kind === "scale");
  const fields: ParamField[] = [];
  for (const i of [0, 1]) {
    const v = values[i];
    fields.push(
      { key: `op${i}`, label: `Rule ${i + 1}: cell is`, type: "select", options: [NONE, ...OP_LABELS], default: v ? labelOfOp(v.op) : NONE },
      { key: `a${i}`, label: `Rule ${i + 1}: value (lower bound)`, type: "number", default: v?.a ?? 0 },
      { key: `b${i}`, label: `Rule ${i + 1}: upper bound (between only)`, type: "number", default: v?.b ?? 0 },
      { key: `tone${i}`, label: `Rule ${i + 1}: colour`, type: "select", options: TONES, default: RULE_TONE_LABELS[v?.tone ?? (i ? "warn" : "danger")] },
    );
  }
  const stops = scale?.kind === "scale" ? (scale.mid ? SCALES[2] : SCALES[1]) : NONE;
  fields.push(
    { key: "scale", label: "Colour scale", type: "select", options: SCALES, default: stops },
    { key: "low", label: "Scale: lowest value", type: "select", options: TONES, default: RULE_TONE_LABELS[scale?.kind === "scale" ? scale.low : "series-6"] },
    { key: "mid", label: "Scale: middle (3-colour)", type: "select", options: TONES, default: RULE_TONE_LABELS[scale?.kind === "scale" && scale.mid ? scale.mid : "warn"] },
    { key: "high", label: "Scale: highest value", type: "select", options: TONES, default: RULE_TONE_LABELS[scale?.kind === "scale" ? scale.high : "danger"] },
  );
  return fields;
}

/** The rules a filled form means, or a refusal sentence. */
export function rulesFromParams(p: ParamValues): { rules: CellRule[] } | { error: string } {
  const rules: CellRule[] = [];
  for (const i of [0, 1]) {
    const op = OPS[String(p[`op${i}`])];
    if (!op) continue;
    const tone = toneOf(p[`tone${i}`]);
    if (op === "nan") {
      rules.push({ kind: "value", op, tone });
      continue;
    }
    const a = Number(p[`a${i}`]);
    const b = Number(p[`b${i}`]);
    if (!Number.isFinite(a) || (op === "between" && (!Number.isFinite(b) || a > b))) {
      return { error: `Rule ${i + 1} was not applied: ${op === "between" ? "the upper bound must be a number at or above the lower bound" : "the value must be a number"}.` };
    }
    rules.push(op === "between" ? { kind: "value", op, a, b, tone } : { kind: "value", op, a, tone });
  }
  if (p.scale === SCALES[1]) rules.push({ kind: "scale", low: toneOf(p.low), high: toneOf(p.high) });
  if (p.scale === SCALES[2]) rules.push({ kind: "scale", low: toneOf(p.low), mid: toneOf(p.mid), high: toneOf(p.high) });
  return { rules };
}

/** Conditional Format for `cols`: apply the form (an all-(none) form clears). */
export async function conditionalFormatDialog(ds: Dataset, cols: readonly number[]): Promise<void> {
  const p = await askParams(
    cols.length > 1 ? `Conditional format — ${cols.length} columns` : "Conditional format",
    ruleFields(ds.cellRules?.[cols[0]]),
    {
      confirmLabel: "Apply",
      message: "Colours cells by value or on a scale, using theme colours. Display only: the stored numbers, copies, exports and plots are unchanged. Leave every rule and the scale at (none) to clear.",
    },
  );
  if (!p) return;
  const out = rulesFromParams(p);
  if ("error" in out) {
    refuseRules(out.error);
    return;
  }
  setColumnRules(ds.id, cols, out.rules.length ? out.rules : null);
}

/** The column menu's Conditional format items for the right-clicked `targets`
 *  (value columns only; the X column has none). */
export function cellRulesItems(ds: Dataset, targets: readonly number[]): ContextMenuItem[] {
  const cols = targets.filter((c) => c >= 0 && c < ds.data.labels.length);
  if (!cols.length) return [];
  const ruled = cols.some((c) => ds.cellRules?.[c]?.length);
  return [
    { separator: true },
    { label: "Conditional format…", title: "Colour cells by value or on a scale (display only)", run: () => void conditionalFormatDialog(ds, cols) },
    { label: "Clear conditional format", disabled: !ruled, title: ruled ? undefined : "no rules on the selected columns", run: () => void setColumnRules(ds.id, cols, null) },
  ];
}
