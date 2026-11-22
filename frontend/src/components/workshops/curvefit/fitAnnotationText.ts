// The Curve Fit result as ONE line of graph-annotation text (pure).
//
// Plot annotations are single-line on the canvas, so the equation, parameters
// with their uncertainty, R² and N are joined with "; ". Two formats:
//   * "plain": Unicode text ("(5.4 ± 1.4)×10⁻¹³");
//   * "latex": strict mathtext segments (`$A=1.2\pm0.1$`), the subset
//     lib/richtext.ts renders on screen and matplotlib renders in the vector
//     export. Every latex result is run through the screen parser; anything it
//     rejects falls back to plain with a note (never half-markup).
// Number rules are lib/fitValueFormat.ts's (PDG error rounding) when digits is
// 0 ("auto"); otherwise `digits` significant figures on value and error.

import type { FitResultInput } from "../../../lib/fitResultView";
import { paramUnit } from "../../../lib/fitParamUnits";
import { fmtR2, roundToError, sigFigs, timesTen } from "../../../lib/fitValueFormat";
import type { FitAnnotationOptions } from "../../../lib/fitAnnotationOptions";
import { parseRichText } from "../../../lib/richtext";
import { FIT_MODEL_EXPRS } from "../../../lib/derivedFitModels";
import { equationPlain, equationTex, latexName } from "./fitEquationText";

export interface FitAnnotationText {
  text: string;
  /** Why the requested format was not used, or null. */
  note: string | null;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const SEP = ";  ";

const sig = (x: number, n: number): string => {
  const s = x.toPrecision(n);
  return s.includes("e") ? String(Number(s)) : s;
};

interface Pair { value: string; error: string | null; mag: number }

/** Value (and error) text at `digits` sig figs (0 = auto); mag = shared power of ten. */
function pairOf(v: number, e: unknown, digits: number): Pair {
  if (!fin(e) || e <= 0) {
    return { value: digits > 0 ? sig(v, digits) : sigFigs(v, 4), error: null, mag: 0 };
  }
  if (digits <= 0) {
    const r = roundToError(v, e);
    if (r) return { value: r.value, error: r.error, mag: r.mag };
    return { value: sigFigs(v, 4), error: null, mag: 0 };
  }
  const top = Math.max(Math.abs(v), e);
  const mag = top !== 0 && (top < 1e-3 || top >= 1e5) ? Math.floor(Math.log10(top)) : 0;
  return { value: sig(v / 10 ** mag, digits), error: sig(e / 10 ** mag, digits), mag };
}

/** "1.2e-5" (sigFigs style) as mathtext "1.2\times10^{-5}". */
const texNum = (s: string): string => {
  const m = /^(.*?)e([+-]?\d+)$/.exec(s);
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s;
};

function plainValue(p: Pair): string {
  const body = p.error === null ? p.value : `${p.value} ± ${p.error}`;
  return p.mag === 0 || p.error === null ? body : `(${body})${timesTen(p.mag)}`;
}
function texValue(p: Pair): string {
  if (p.error === null) return texNum(p.value);
  const body = `${texNum(p.value)}\\pm${texNum(p.error)}`;
  return p.mag === 0 ? body : `(${body})\\times10^{${p.mag}}`;
}

function r2Text(r2: unknown, digits: number): string | null {
  if (!fin(r2)) return null;
  if (digits <= 0) return fmtR2(r2);
  const s = sig(r2, digits);
  return Number(s) >= 1 && r2 < 1 ? fmtR2(r2) : s;
}
function r2Tex(s: string): string {
  if (s.startsWith("≈1")) return "R^2\\approx1";
  if (s.startsWith("1 −")) return `R^2=1-${texNum(s.slice(3).trim())}`;
  return `R^2=${texNum(s)}`;
}

function build(i: FitResultInput, o: FitAnnotationOptions, tex: boolean, notes: string[]): string | null {
  const params = Array.isArray(i.result.params) ? (i.result.params as unknown[]) : [];
  const errors = Array.isArray(i.result.errors) ? (i.result.errors as unknown[]) : [];
  const parts: string[] = [];
  const math = (s: string) => `$${s}$`;
  if (o.equation) {
    if (!tex) parts.push(equationPlain(i.model, i.names));
    else {
      const eq = equationTex(i.model, i.names);
      if (eq !== null && parseRichText(`$y=${eq}$`).ok) parts.push(math(`y=${eq}`));
      else {
        // Only the equation falls back (to the model's name); parameters stay LaTeX.
        parts.push(`y = ${i.model}(x)`.replace(/\$/g, "\\$"));
        if (Object.hasOwn(FIT_MODEL_EXPRS, i.model)) notes.push("The equation cannot be written as LaTeX here; the model name is shown instead.");
      }
    }
  }
  for (let k = 0; k < params.length; k++) {
    const v = params[k];
    if (!fin(v)) continue;
    const name = i.names[k] ?? `p${k}`;
    const held = i.fixed?.[k] === true;
    const pair = pairOf(v, held ? null : errors[k], o.digits);
    const unit = o.units ? paramUnit(i.model, name, i.xUnit, i.yUnit) : null;
    if (!tex) {
      parts.push(`${name} = ${plainValue(pair)}${held ? " (fixed)" : ""}${unit ? ` ${unit}` : ""}`);
      continue;
    }
    const nm = latexName(name);
    if (nm === null) return null;
    parts.push(math(`${nm}=${texValue(pair)}${held ? "\\ (\\mathrm{fixed})" : ""}${unit ? `\\ \\mathrm{${unit}}` : ""}`));
  }
  if (o.r2) {
    const s = r2Text(i.result.R2, o.digits);
    if (s !== null) parts.push(tex ? math(r2Tex(s)) : `R² = ${s}`);
  }
  if (o.n && fin(i.result.nPoints)) parts.push(tex ? math(`N=${i.result.nPoints}`) : `N = ${i.result.nPoints}`);
  return parts.join(SEP);
}

/** The annotation text for a fit result. Never throws; a latex request that the
 *  screen parser rejects returns the plain text and says why in `note`. */
export function buildFitAnnotationText(input: FitResultInput, opts: FitAnnotationOptions): FitAnnotationText {
  const escape = (t: string) => t.replace(/\$/g, "\\$");
  if (opts.format === "latex") {
    const notes: string[] = [];
    const t = build(input, opts, true, notes);
    if (t !== null && parseRichText(t).ok) return { text: t, note: notes[0] ?? null };
    const plain = build(input, { ...opts, format: "plain" }, false, []) ?? "";
    return { text: escape(plain), note: "LaTeX is not available for these parameter names or units; plain text is used." };
  }
  return { text: escape(build(input, opts, false, []) ?? ""), note: null };
}

/** Marker appended to a withheld (out-of-date) annotation. */
export const OUT_OF_DATE_SUFFIX = "  (out of date)";
