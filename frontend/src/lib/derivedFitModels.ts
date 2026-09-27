// P2.5 fitted-value use: the backend's CLOSED-FORM fit models
// (src/quantized/calc/fit_models.py) written in the worksheet formula language
// over `x` and `p0..pn`, with their registry parameter names — so a worksheet
// formula can evaluate a saved fit (`fitval("Gaussian", x)`) and name its
// parameters (`fit("Gaussian", "μ")`, `fit("Gaussian").A`) without a server
// round trip on every recompute.
//
// Each entry is a transcription of the Python evaluator, operation for
// operation; derivedFitModels.test.ts checks every one against values computed
// by that evaluator (`calc.fit_models.evaluate`). A model NOT listed here
// (Pseudo-Voigt, the helper-based magnetic/thermal models, plugins) can still
// be referenced by parameter INDEX — `fit("Langevin", "p0")` — but fitval()
// refuses it rather than approximating it.

export interface FitModelExpr {
  params: readonly string[];
  expr: string;
}

export const FIT_MODEL_EXPRS: Readonly<Record<string, FitModelExpr>> = {
  Linear: { params: ["m", "b"], expr: "p0*x + p1" },
  Quadratic: { params: ["a", "b", "c"], expr: "p0*x**2 + p1*x + p2" },
  Cubic: { params: ["a", "b", "c", "d"], expr: "p0*x**3 + p1*x**2 + p2*x + p3" },
  "Poly 4": { params: ["a", "b", "c", "d", "e"], expr: "p0*x**4 + p1*x**3 + p2*x**2 + p3*x + p4" },
  "Exponential Decay": { params: ["A", "τ", "C"], expr: "p0*exp(-x/p1) + p2" },
  "Stretched Exponential": { params: ["A", "τ", "β", "C"], expr: "p0*exp(-((x/p1)**p2)) + p3" },
  "Bi-exponential Decay": { params: ["A₁", "τ₁", "A₂", "τ₂", "C"], expr: "p0*exp(-x/p1) + p2*exp(-x/p3) + p4" },
  "Exponential Growth": { params: ["A", "τ", "C"], expr: "p0*exp(x/p1) + p2" },
  "Saturation Growth": { params: ["A", "τ", "C"], expr: "p0*(1 - exp(-x/p1)) + p2" },
  Gaussian: { params: ["A", "μ", "σ"], expr: "p0*exp(-((x - p1)**2)/(2*p2**2))" },
  Lorentzian: { params: ["A", "x₀", "γ"], expr: "p0/(1 + ((x - p1)/p2)**2)" },
  "Power Law": { params: ["A", "n", "C"], expr: "p0*abs(x)**p1 + p2" },
  Allometric: { params: ["A", "n"], expr: "p0*abs(x)**p1" },
  Logistic: { params: ["A", "k", "x₀", "C"], expr: "p0/(1 + exp(-p1*(x - p2))) + p3" },
  Tanh: { params: ["A", "k", "x₀", "C"], expr: "p0*tanh(p1*(x - p2)) + p3" },
  "Curie-Weiss": { params: ["C", "θ"], expr: "p0/(x - p1)" },
  "Bloch T^3/2": { params: ["M₀", "B"], expr: "p0*(1 - p1*x**1.5)" },
  Arrhenius: { params: ["A", "Eₐ/kB"], expr: "p0*exp(-p1/x)" },
  // 8.617e-5 eV/K is fit_models._vft's own literal — do not "fix" it to CODATA.
  VFT: { params: ["τ₀", "Ea_eV", "T₀"], expr: "p0*exp(p1/(8.617e-5*(x - p2)))" },
  Langmuir: { params: ["A", "K"], expr: "p0*x/(p1 + x)" },
  // 2.220446049250313e-16 is numpy's float eps, as in fit_models._logarithmic.
  Logarithmic: { params: ["a", "b"], expr: "p0*log(abs(x) + 2.220446049250313e-16) + p1" },
  "Square Root": { params: ["a", "b"], expr: "p0*sqrt(abs(x)) + p1" },
};

export const fitModelExpr = (model: string): FitModelExpr | undefined =>
  Object.hasOwn(FIT_MODEL_EXPRS, model) ? FIT_MODEL_EXPRS[model] : undefined;
