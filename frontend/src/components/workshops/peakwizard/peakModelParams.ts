// Peak Analyzer — the mixed-shape model's parameter set (audit P2.4 slice 2).
// Pure: seeds, edits and serialises the parameters `/api/peaks/model-fit`
// takes (backend contract: src/quantized/calc/peak_model.py's header). Peak i
// owns `p{i}.{center,height,fwhm,eta,fwhm_g,fwhm_l}` by shape; the background
// owns `bg.c0..c2`, a polynomial in (x - xRef). Every name, kind and field
// table here mirrors that module — the backend re-validates everything, so a
// drift fails loudly as an ASCII 422 the wizard shows, never a silent misfit.
//
// SEEDS (what a user who touches nothing gets): centres from the detected
// peaks, bounded to the fitted window; heights = detected apex minus the
// seeded background at that centre, min 0 (peaks, not dips); FWHM from
// detection, max = the window span; eta 0.5 in the backend's default [0, 1];
// a Voigt splits the detected FWHM into fwhm_g = fwhm_l = 0.61 x FWHM (the
// Olivero-Longbothum total of that pair is ~1.0 x FWHM); the background
// polynomial goes through the mean of the first and last 5 % of points.

export type ModelShape = "gaussian" | "lorentzian" | "pseudo_voigt" | "voigt";
export type ModelBackground = "none" | "constant" | "linear" | "quadratic";

export const MODEL_SHAPES: { value: ModelShape; label: string }[] = [
  { value: "gaussian", label: "Gaussian" },
  { value: "lorentzian", label: "Lorentzian" },
  { value: "pseudo_voigt", label: "Pseudo-Voigt" },
  { value: "voigt", label: "Voigt" },
];
export const MODEL_BACKGROUNDS: { value: ModelBackground; label: string }[] = [
  { value: "none", label: "None" },
  { value: "constant", label: "Constant" },
  { value: "linear", label: "Linear" },
  { value: "quadratic", label: "Quadratic" },
];

const SHAPE_FIELDS: Record<ModelShape, readonly string[]> = {
  gaussian: ["center", "height", "fwhm"],
  lorentzian: ["center", "height", "fwhm"],
  pseudo_voigt: ["center", "height", "fwhm", "eta"],
  voigt: ["center", "height", "fwhm_g", "fwhm_l"],
};
const BG_TERMS: Record<ModelBackground, number> = { none: 0, constant: 1, linear: 2, quadratic: 3 };
const WIDTHS = new Set(["fwhm", "fwhm_g", "fwhm_l"]);
/** fwhm_g = fwhm_l = VOIGT_SPLIT x FWHM gives a Voigt of ~that FWHM. */
const VOIGT_SPLIT = 0.61;

export interface ModelParam {
  name: string;
  value: number;
  vary: boolean;
  min: number | null;
  max: number | null;
  tie: string | null;
}

export interface ModelSetup {
  shapes: ModelShape[];
  background: ModelBackground;
  params: ModelParam[];
  /** The background's reference x (sent as `bg_x_ref`): the window's middle. */
  xRef: number;
}

/** A detected/added candidate, in the wizard's working (baseline-corrected)
 *  coordinates: apex = height + bg (lib/peakTable.ts's `Peak`). */
export interface SeedPeak {
  center: number;
  height: number;
  bg: number;
  fwhm: number;
}

/** The recipe's global shape as this engine's default: the classic engine's
 *  Split Pearson VII / TCH-pV have no equivalent here -> pseudo-Voigt. */
export function shapeFromGlobal(global: string): ModelShape {
  if (global === "Gaussian") return "gaussian";
  if (global === "Lorentzian") return "lorentzian";
  return "pseudo_voigt";
}

/** The recipe's background degree (0..6) as this engine's background. */
export function backgroundFromDegree(degree: number): ModelBackground {
  if (degree <= 0) return "constant";
  return degree === 1 ? "linear" : "quadratic";
}

/** Tie compatibility class: the backend joins only parameters of one kind. */
export function paramKind(name: string): string {
  const field = name.slice(name.indexOf(".") + 1);
  if (name.startsWith("bg.")) return `bg${field.slice(1)}`;
  return WIDTHS.has(field) ? "width" : field;
}

export function paramNames(shapes: readonly ModelShape[], background: ModelBackground): string[] {
  const names = shapes.flatMap((s, i) => SHAPE_FIELDS[s].map((f) => `p${i}.${f}`));
  for (let k = 0; k < BG_TERMS[background]; k++) names.push(`bg.c${k}`);
  return names;
}

/** "#2 FWHM" for "p1.fwhm", "bg c1" for "bg.c1" — the table's row label. */
export function paramLabel(name: string): string {
  const m = /^p(\d+)\.(.+)$/.exec(name);
  if (!m) return name.replace(".", " ");
  const field = m[2] === "fwhm" ? "FWHM" : m[2] === "eta" ? "η" : m[2].replace("fwhm_", "FWHM ");
  return `#${Number(m[1]) + 1} ${field}`;
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Background seed coefficients in (x - xRef), from the window's two ends. */
function seedBackground(x: readonly number[], y: readonly number[], bg: ModelBackground, xRef: number): number[] {
  const n = Math.min(x.length, y.length);
  if (BG_TERMS[bg] === 0 || n === 0) return [];
  const k = Math.max(1, Math.round(n * 0.05));
  const yL = mean(y.slice(0, k));
  const yR = mean(y.slice(n - k, n));
  if (bg === "constant") return [Math.min(yL, yR)];
  const xL = mean(x.slice(0, k));
  const xR = mean(x.slice(n - k, n));
  const slope = xR !== xL ? (yR - yL) / (xR - xL) : 0;
  const c = [yL + slope * (xRef - xL), slope];
  return bg === "quadratic" ? [...c, 0] : c;
}

function bgAt(coeffs: readonly number[], x: number, xRef: number): number {
  return coeffs.reduce((acc, c, k) => acc + c * (x - xRef) ** k, 0);
}

/** Fresh parameters for these peaks/shapes/background over (x, y). A
 *  `linkMode` of "Shared FWHM" (+ eta) — the classic engine's width link —
 *  pre-applies the matching ties so the recipe's intent carries over. */
export function seedSetup(
  peaks: readonly SeedPeak[],
  shapes: readonly ModelShape[],
  background: ModelBackground,
  x: readonly number[],
  y: readonly number[],
  linkMode = "None",
): ModelSetup {
  // Loops, not Math.min(...x): a spread of a 100k-point window can overflow
  // the call stack.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi >= lo)) { lo = 0; hi = 1; }
  const span = hi - lo || 1;
  const xRef = 0.5 * (lo + hi);
  let yScale = 0;
  for (const v of y) if (Number.isFinite(v)) yScale = Math.max(yScale, Math.abs(v));
  yScale ||= 1;
  const bg = seedBackground(x, y, background, xRef);
  const params: ModelParam[] = [];
  const free = (name: string, value: number, min: number | null, max: number | null): ModelParam => ({
    name, value, vary: true, min, max, tie: null,
  });
  peaks.forEach((p, i) => {
    const center = Math.min(hi, Math.max(lo, p.center));
    const width = Math.min(span, Number.isFinite(p.fwhm) && p.fwhm > 0 ? p.fwhm : span / 50);
    const height = Math.max(p.height + p.bg - bgAt(bg, center, xRef), 0.01 * yScale);
    for (const f of SHAPE_FIELDS[shapes[i] ?? "gaussian"]) {
      const name = `p${i}.${f}`;
      if (f === "center") params.push(free(name, center, lo, hi));
      else if (f === "height") params.push(free(name, height, 0, null));
      else if (f === "fwhm") params.push(free(name, width, null, span));
      else if (f === "eta") params.push(free(name, 0.5, null, null));
      else params.push(free(name, VOIGT_SPLIT * width, null, span));
    }
  });
  bg.forEach((c, k) => params.push(free(`bg.c${k}`, c, null, null)));
  let out = params;
  if (linkMode.startsWith("Shared FWHM")) out = setFwhmShared(out, true);
  if (linkMode === "Shared FWHM + eta") out = shareField(out, ["eta"], true);
  return { shapes: [...shapes], background, params: out, xRef };
}

/** Re-seed for new shapes/background, keeping every edit whose parameter
 *  still exists; a tie whose target vanished (or changed kind) is dropped. */
export function reshape(
  prev: ModelSetup,
  peaks: readonly SeedPeak[],
  shapes: readonly ModelShape[],
  background: ModelBackground,
  x: readonly number[],
  y: readonly number[],
): ModelSetup {
  const fresh = seedSetup(peaks, shapes, background, x, y);
  const old = new Map(prev.params.map((p) => [p.name, p]));
  const names = new Set(fresh.params.map((p) => p.name));
  const params = fresh.params.map((p) => {
    const kept = old.get(p.name);
    if (!kept) return p;
    const tieOk = kept.tie !== null && names.has(kept.tie) && paramKind(kept.tie) === paramKind(p.name);
    return { ...kept, tie: tieOk ? kept.tie : null };
  });
  return { ...fresh, params };
}

export function patchParam(setup: ModelSetup, name: string, patch: Partial<Omit<ModelParam, "name">>): ModelSetup {
  return { ...setup, params: setup.params.map((p) => (p.name === name ? { ...p, ...patch } : p)) };
}

/** Parameters `name` may be tied to: same kind, not itself, and a varying,
 *  untied root (the backend refuses a tie to a fixed parameter). */
export function tieTargets(params: readonly ModelParam[], name: string): string[] {
  const kind = paramKind(name);
  return params
    .filter((p) => p.name !== name && p.tie === null && p.vary && paramKind(p.name) === kind)
    .map((p) => p.name);
}

function shareField(params: ModelParam[], fields: readonly string[], on: boolean): ModelParam[] {
  const root = new Map<string, string>();
  return params.map((p) => {
    const field = p.name.slice(p.name.indexOf(".") + 1);
    if (!p.name.startsWith("p") || !fields.includes(field)) return p;
    if (!on) return p.tie ? { ...p, tie: null, vary: true } : p;
    const first = root.get(field);
    if (first === undefined) {
      root.set(field, p.name);
      return { ...p, tie: null, vary: true };
    }
    return { ...p, tie: first };
  });
}

const WIDTH_FIELDS = ["fwhm", "fwhm_g", "fwhm_l"];

/** The "share FWHM across peaks" convenience: ties every peak's width to
 *  the FIRST peak's width of the same field (fwhm, or a Voigt's fwhm_g /
 *  fwhm_l), making that root vary; off clears those ties. Only ties change. */
export function setFwhmShared(params: ModelParam[], on: boolean): ModelParam[] {
  return shareField(params, WIDTH_FIELDS, on);
}

/** True when sharing is in force: some width is tied, and applying the
 *  convenience again would change no tie. */
export function fwhmShared(params: readonly ModelParam[]): boolean {
  const shared = setFwhmShared([...params], true);
  return shared.some((p) => p.tie !== null && paramKind(p.name) === "width")
    && shared.every((p, i) => p.tie === params[i].tie);
}

/** Copy fitted values into the start values (untied parameters, clamped
 *  into their bounds) — "refine from here". */
export function startFromFit(
  params: readonly ModelParam[],
  fitted: readonly { name: string; value: number | null }[],
): ModelParam[] {
  const v = new Map(fitted.map((f) => [f.name, f.value]));
  return params.map((p) => {
    const f = v.get(p.name);
    if (p.tie !== null || f == null || !Number.isFinite(f)) return p;
    const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, f));
    return { ...p, value: clamped };
  });
}

/** The `/api/peaks/model-fit` body. `vary` is always explicit (the backend
 *  defaults it to false); a tied parameter's own value/bounds are ignored
 *  there. `range` is the wizard's fitted x-range (null bound = open). */
export function modelFitBody(
  setup: ModelSetup,
  x: number[],
  y: number[],
  range: { lo: number | null; hi: number | null },
) {
  return {
    x,
    y,
    shapes: setup.shapes,
    background: setup.background,
    parameters: setup.params.map((p) => ({
      name: p.name, value: p.value, vary: p.vary, min: p.min, max: p.max, tie: p.tie,
    })),
    bg_x_ref: setup.xRef,
    ...(range.lo !== null ? { x_min: range.lo } : {}),
    ...(range.hi !== null ? { x_max: range.hi } : {}),
  };
}
