// Peak Analyzer — client-side mirror of the model fitter's parameter rules
// (src/quantized/calc/peak_model.py, `PeakParams`), so step 3/4 can block Fit
// with a plain reason instead of sending a table the backend will reject with
// a 422. Pure. The backend stays the final arbiter; this only has to agree
// with it on every rule a user can break from the table: ties (known, not
// self, same kind, no cycle, ending on a varying parameter), min <= max, a
// free parameter's start inside its bounds (widths > 0 by default, eta in
// [0, 1]), positive widths, eta in [0, 1], and a Voigt with a nonzero width.

import { paramKind, paramLabel, type ModelSetup } from "./peakModelParams";

export function setupProblems(setup: ModelSetup): string[] {
  const out: string[] = [];
  const by = new Map(setup.params.map((p) => [p.name, p]));
  const label = paramLabel;
  const rootOf = (name: string): string | null => {
    const seen = new Set<string>();
    let cur = name;
    for (;;) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const t = by.get(cur)?.tie;
      if (!t) return cur;
      cur = t;
    }
  };
  for (const p of setup.params) {
    const n = label(p.name);
    if (p.tie !== null) {
      const t = by.get(p.tie);
      if (!t) out.push(`${n} is tied to an unknown parameter (${p.tie})`);
      else if (p.tie === p.name) out.push(`${n} is tied to itself`);
      else if (paramKind(p.tie) !== paramKind(p.name)) out.push(`${n} can only be tied to a parameter of its own kind`);
      else {
        const root = rootOf(p.name);
        if (root === null) out.push(`${n}: its ties form a cycle`);
        else if (!by.get(root)?.vary) out.push(`${n} is tied to ${label(root)}, which is fixed: make ${label(root)} vary or untie ${n}`);
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
    if (kind === "eta") {
      if (p.value < 0 || p.value > 1) out.push(`${n}: η must lie in [0, 1]`);
      if (p.vary && [p.min, p.max].some((b) => b !== null && (b < 0 || b > 1))) out.push(`${n}: η bounds must lie in [0, 1]`);
    }
    if (!p.vary) continue;
    const lo = p.min ?? (kind === "eta" ? 0 : -Infinity);
    const hi = p.max ?? (kind === "eta" ? 1 : Infinity);
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
