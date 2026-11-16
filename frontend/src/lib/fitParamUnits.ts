// The unit of a fit parameter, derived from the fitted X and Y column units.
// Pure. Only a parameter whose dimension is certain from the model's formula
// is listed (a length-like "x0", a Y-valued "A1", a rate "m" = Y per X); every
// other parameter has NO unit shown. Never guessed: "—" beats a wrong unit.
//
// Keys are the backend registry's model names and their parameter names
// (calc/fit_models*.py); each value is the parameter's dimension in terms of
// the fitted X and Y: X, Y, Y/X (a slope) or Y·X (an area-form amplitude).

type Dim = "X" | "Y" | "Y/X" | "Y·X";

const exp1: Record<string, Dim> = { y0: "Y", A1: "Y", t1: "X" };
const exp2: Record<string, Dim> = { ...exp1, A2: "Y", t2: "X" };
const peakGeneral: Record<string, Dim> = { y0: "Y", xc: "X", w: "X" };

const DIMS: Record<string, Record<string, Dim>> = {
  Linear: { m: "Y/X", b: "Y" },
  Proportional: { A: "Y/X" },
  "Exponential Decay": { A: "Y", τ: "X", C: "Y" },
  "Exponential Growth": { A: "Y", τ: "X", C: "Y" },
  "Bi-exponential Decay": { "A₁": "Y", "τ₁": "X", "A₂": "Y", "τ₂": "X", C: "Y" },
  ExpDec1: exp1,
  ExpDec2: exp2,
  ExpGro1: exp1,
  ExpGro2: exp2,
  Gaussian: { A: "Y", μ: "X", σ: "X" },
  Lorentzian: { A: "Y", "x₀": "X", γ: "X" },
  GaussAmp: { ...peakGeneral, A: "Y" },
  Gauss: { ...peakGeneral, A: "Y·X" },
  Lorentz: { ...peakGeneral, A: "Y·X" },
  Boltzmann: { A1: "Y", A2: "Y", x0: "X", dx: "X" },
  Sine: { xc: "X", w: "X", A: "Y", y0: "Y" },
};

/** `a` and `b` joined by `op`, or null when either unit is blank. */
const compound = (a: string, op: "·" | "/", b: string): string | null => (a && b ? `${a}${op}${b}` : null);

/** The unit of `param` in `model` given the X/Y column units, or null when it
 *  is not known (unlisted parameter, dimensionless, or a needed unit is blank). */
export function paramUnit(model: string, param: string, xUnit: string, yUnit: string): string | null {
  const dim = DIMS[model]?.[param];
  if (!dim) return null;
  const x = xUnit.trim();
  const y = yUnit.trim();
  if (dim === "X") return x || null;
  if (dim === "Y") return y || null;
  return dim === "Y/X" ? compound(y, "/", x) : compound(y, "·", x);
}
