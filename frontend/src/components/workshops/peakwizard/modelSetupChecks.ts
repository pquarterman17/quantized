// Peak Analyzer — client-side mirror of the model fitter's parameter rules
// (src/quantized/calc/peak_model.py, `PeakParams`), so step 3/4 can block Fit
// with a plain reason instead of sending a table the backend will reject with
// a 422. Pure. The backend stays the final arbiter; this only has to agree
// with it on every rule a user can break from the table: ties (known, not
// self, same kind, an operation the kind allows, a finite coefficient — a
// positive ratio —, an area ratio only between peaks that have an area, no
// cycle — an area ratio reads both peaks' other fields —, and an equal tie
// ending on a varying parameter), min <= max, a free parameter's start inside
// its bounds (widths > 0 by default, eta in [0, 1], Pearson VII m > 0.5,
// Doniach–Šunjić alpha in [0, 0.99] by default), positive widths, and a Voigt
// with a nonzero width.
// Non-finite numbers first: every comparison with NaN is false, so without
// that check a NaN start or bound slipped past all of the rules below — and
// JSON sends NaN as null, which the backend refuses (a 422 for the fit, an
// error row in a batch). Checked for tied parameters too: the backend
// validates every value, even one a tie then ignores.

import { NO_AREA_SHAPES, paramKind, paramLabel, tieOpsFor, type ModelParam, type ModelSetup } from "./peakModelParams";

/** kind -> [lo, lo inclusive, hi, hi inclusive, default min, default max]
 *  (calc/peak_model_shapes.py's KIND_RULES). */
const RULES: Record<string, [number, boolean, number, boolean, number, number]> = {
  eta: [0, true, 1, true, 0, 1],
  m: [0.5, false, Infinity, false, 0.51, Infinity], // m = 0.5: infinite area
  alpha: [0, true, 1, false, 0, 0.99],
};
const inRule = ([lo, loIn, hi, hiIn]: (typeof RULES)[string], v: number) =>
  (loIn ? v >= lo : v > lo) && (hiIn ? v <= hi : v < hi);
const ruleText = ([lo, loIn, hi, hiIn]: (typeof RULES)[string]) =>
  `${loIn ? "[" : "("}${lo}, ${hi === Infinity ? "∞" : hi}${hiIn ? "]" : ")"}`;
const SYMBOL: Record<string, string> = { eta: "η", alpha: "α" };
const peakOf = (name: string) => /^p(\d+)\./.exec(name)?.[1];

/** What a tied row reads: its target, and for an area ratio every other field
 *  of both peaks (the backend's dependency graph). */
function deps(p: ModelParam, all: readonly ModelParam[]): string[] {
  if (p.tie === null) return [];
  if (p.tieOp !== "area_ratio") return [p.tie];
  const peaks = [peakOf(p.tie), peakOf(p.name)];
  return all.filter((q) => q.name !== p.name && peaks.includes(peakOf(q.name))).map((q) => q.name);
}

export function setupProblems(setup: ModelSetup): string[] {
  const out: string[] = [];
  const by = new Map(setup.params.map((p) => [p.name, p]));
  const label = paramLabel;
  /** The end of a chain of EQUAL ties (an expression tie is its own root). */
  const rootOf = (name: string): string | null => {
    const seen = new Set<string>();
    let cur = name;
    for (;;) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const p = by.get(cur);
      if (!p?.tie || (p.tieOp ?? "equal") !== "equal") return cur;
      cur = p.tie;
    }
  };
  const cyclic = new Set<string>();
  const state = new Map<string, number>();
  const visit = (name: string, path: string[]): void => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) {
      path.slice(path.indexOf(name)).forEach((n) => cyclic.add(n));
      return;
    }
    state.set(name, 1);
    const p = by.get(name);
    if (p) for (const d of deps(p, setup.params)) if (by.has(d)) visit(d, [...path, name]);
    state.set(name, 2);
  };
  for (const p of setup.params) visit(p.name, []);
  for (const p of setup.params) {
    const n = label(p.name);
    if (!Number.isFinite(p.value)) {
      out.push(`${n}: the start value is not a finite number`);
      continue;
    }
    if ([p.min, p.max].some((b) => b !== null && !Number.isFinite(b))) {
      out.push(`${n}: a bound is not a finite number`);
      continue;
    }
    if (p.tie !== null) {
      const t = by.get(p.tie);
      if (!t) out.push(`${n} is tied to an unknown parameter (${p.tie})`);
      else if (p.tie === p.name) out.push(`${n} is tied to itself`);
      else if (paramKind(p.tie) !== paramKind(p.name)) out.push(`${n} can only be tied to a parameter of its own kind`);
      else if (cyclic.has(p.name)) out.push(`${n}: its ties form a cycle`);
      else {
        const op = p.tieOp ?? "equal";
        const root = rootOf(p.name);
        const shapeOf = (name: string) => setup.shapes[Number(peakOf(name))];
        if (!tieOpsFor(p.name, setup.shapes).includes(op)) out.push(`${n}: this parameter cannot take an "${op.replace("_", " ")}" tie`);
        else if (op === "area_ratio" && NO_AREA_SHAPES.has(shapeOf(p.tie))) {
          out.push(`${n}: ${label(p.tie).split(" ")[0]} (${shapeOf(p.tie)}) has no finite area to take a ratio of`);
        } else if (op !== "equal" && p.tieCoef !== undefined && !Number.isFinite(p.tieCoef)) {
          out.push(`${n}: the tie coefficient is not a finite number`);
        } else if ((op === "ratio" || op === "area_ratio") && p.tieCoef !== undefined && !(p.tieCoef > 0)) {
          out.push(`${n}: a ratio must be positive`);
        } else if (op === "equal" && root !== null && !by.get(root)?.vary && !by.get(root)?.tie) {
          out.push(`${n} is tied to ${label(root)}, which is fixed: make ${label(root)} vary or untie ${n}`);
        }
      }
      continue; // a tied parameter's own value and bounds are ignored
    }
    const kind = paramKind(p.name);
    const width = kind === "width";
    if (p.min !== null && p.max !== null && p.min > p.max) out.push(`${n}: min is greater than max`);
    if (width) {
      const zeroOk = !p.vary && /\.fwhm_[gl]$/.test(p.name);
      if (p.value < 0 || (p.value === 0 && !zeroOk)) out.push(`${n}: a width must be positive`);
      if (p.vary && p.min !== null && p.min <= 0) out.push(`${n}: min must be positive for a width`);
    }
    const rule = RULES[kind];
    if (rule) {
      const sym = SYMBOL[kind] ?? kind;
      if (!inRule(rule, p.value)) out.push(`${n}: ${sym} must lie in ${ruleText(rule)}`);
      if (p.vary && [p.min, p.max].some((b) => b !== null && !inRule(rule, b))) out.push(`${n}: ${sym} bounds must lie in ${ruleText(rule)}`);
    }
    if (!p.vary) continue;
    const lo = p.min ?? (rule ? rule[4] : -Infinity);
    const hi = p.max ?? (rule ? rule[5] : Infinity);
    if (width && !(hi > 0)) out.push(`${n}: max must be positive for a width`);
    else if (!(lo < hi)) out.push(`${n}: min equals max — fix it (uncheck vary) instead`);
    else if (p.value < lo || p.value > hi) out.push(`${n}: start value ${p.value} is outside [${lo}, ${hi}]`);
  }
  setup.shapes.forEach((s, i) => {
    if (s !== "voigt") return;
    const g = by.get(rootOf(`p${i}.fwhm_g`) ?? "");
    const l = by.get(rootOf(`p${i}.fwhm_l`) ?? "");
    if (g?.value === 0 && l?.value === 0) out.push(`#${i + 1}: a Voigt needs FWHM g or FWHM l above 0`);
  });
  return out;
}
