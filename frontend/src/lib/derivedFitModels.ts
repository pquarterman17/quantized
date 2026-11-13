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
// (Pseudo-Voigt, Origin's Voigt, the helper-based magnetic/thermal models,
// plugins, and the Origin power-law sigmoids Hill/Hill1/Logistic (Origin)/
// Logistic5, whose evaluator returns NaN for x <= 0 where `**` would not) can
// still be referenced by parameter INDEX — `fit("Langevin", "p0")` — but
// fitval() refuses it rather than approximating it.

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
  // Origin built-in functions (calc/fit_models_origin_*). The polynomials are
  // written in Horner form, as fit_models_origin_misc.make_poly evaluates them.
  Gauss: { params: ["y0", "xc", "w", "A"], expr: "p0 + p3/(p2*sqrt(pi/2))*exp(-2*((x - p1)/p2)**2)" },
  GaussAmp: { params: ["y0", "xc", "w", "A"], expr: "p0 + p3*exp(-((x - p1)**2)/(2*p2**2))" },
  Lorentz: { params: ["y0", "xc", "w", "A"], expr: "p0 + (2*p3/pi)*p2/(4*(x - p1)**2 + p2**2)" },
  PsdVoigt1: { params: ["y0", "xc", "A", "w", "mu"], expr: "p0 + p2*(p4*(2/pi)*p3/(4*(x - p1)**2 + p3**2) + (1 - p4)*sqrt(4*log(2))/(sqrt(pi)*p3)*exp(-(4*log(2))*(x - p1)**2/p3**2))" },
  PsdVoigt2: { params: ["y0", "xc", "A", "wG", "wL", "mu"], expr: "p0 + p2*(p5*(2/pi)*p4/(4*(x - p1)**2 + p4**2) + (1 - p5)*sqrt(4*log(2))/(sqrt(pi)*p3)*exp(-(4*log(2))*(x - p1)**2/p3**2))" },
  LogNormal: { params: ["y0", "xc", "w", "A"], expr: "p0 + p3/(sqrt(2*pi)*p2*x)*exp(-(log(x/p1)**2)/(2*p2**2))" },
  Asym2Sig: { params: ["y0", "xc", "A", "w1", "w2", "w3"], expr: "p0 + p2*(1/(1 + exp(-(x - p1 + p3/2)/p4)))*(1 - 1/(1 + exp(-(x - p1 - p3/2)/p5)))" },
  ExpDec1: { params: ["y0", "A1", "t1"], expr: "p0 + p1*exp(-x/p2)" },
  ExpDec2: { params: ["y0", "A1", "t1", "A2", "t2"], expr: "p0 + p1*exp(-x/p2) + p3*exp(-x/p4)" },
  ExpDec3: { params: ["y0", "A1", "t1", "A2", "t2", "A3", "t3"], expr: "p0 + p1*exp(-x/p2) + p3*exp(-x/p4) + p5*exp(-x/p6)" },
  ExpDecay1: { params: ["y0", "x0", "A1", "t1"], expr: "p0 + p2*exp(-(x - p1)/p3)" },
  ExpDecay2: { params: ["y0", "x0", "A1", "t1", "A2", "t2"], expr: "p0 + p2*exp(-(x - p1)/p3) + p4*exp(-(x - p1)/p5)" },
  ExpDecay3: { params: ["y0", "x0", "A1", "t1", "A2", "t2", "A3", "t3"], expr: "p0 + p2*exp(-(x - p1)/p3) + p4*exp(-(x - p1)/p5) + p6*exp(-(x - p1)/p7)" },
  ExpGro1: { params: ["y0", "A1", "t1"], expr: "p0 + p1*exp(x/p2)" },
  ExpGro2: { params: ["y0", "A1", "t1", "A2", "t2"], expr: "p0 + p1*exp(x/p2) + p3*exp(x/p4)" },
  ExpGrow1: { params: ["y0", "x0", "A1", "t1"], expr: "p0 + p2*exp((x - p1)/p3)" },
  ExpGrow2: { params: ["y0", "x0", "A1", "t1", "A2", "t2"], expr: "p0 + p2*exp((x - p1)/p3) + p4*exp((x - p1)/p5)" },
  Boltzmann: { params: ["A1", "A2", "x0", "dx"], expr: "p1 + (p0 - p1)/(1 + exp((x - p2)/p3))" },
  DoseResp: { params: ["A1", "A2", "LOGx0", "p"], expr: "p0 + (p1 - p0)/(1 + 10**((p2 - x)*p3))" },
  MichaelisMenten: { params: ["Vmax", "Km"], expr: "p0*x/(p1 + x)" },
  SLogistic1: { params: ["a", "xc", "k"], expr: "p0/(1 + exp(-p2*(x - p1)))" },
  SGompertz: { params: ["a", "xc", "k"], expr: "p0*exp(-exp(-p2*(x - p1)))" },
  SWeibull1: { params: ["A", "xc", "d", "k"], expr: "p0*(1 - exp(-(max(p3*(x - p1), 0)**p2)))" },
  Poly5: { params: ["A0", "A1", "A2", "A3", "A4", "A5"], expr: "(((((p5)*x + p4)*x + p3)*x + p2)*x + p1)*x + p0" },
  "Poly 6": { params: ["A0", "A1", "A2", "A3", "A4", "A5", "A6"], expr: "((((((p6)*x + p5)*x + p4)*x + p3)*x + p2)*x + p1)*x + p0" },
  "Poly 7": { params: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"], expr: "(((((((p7)*x + p6)*x + p5)*x + p4)*x + p3)*x + p2)*x + p1)*x + p0" },
  "Poly 8": { params: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"], expr: "((((((((p8)*x + p7)*x + p6)*x + p5)*x + p4)*x + p3)*x + p2)*x + p1)*x + p0" },
  Poly: { params: ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"], expr: "(((((((((p9)*x + p8)*x + p7)*x + p6)*x + p5)*x + p4)*x + p3)*x + p2)*x + p1)*x + p0" },
  Proportional: { params: ["A"], expr: "p0*x" },
  Allometric1: { params: ["a", "b"], expr: "p0*x**p1" },
  Sine: { params: ["xc", "w", "A", "y0"], expr: "p3 + p2*sin(pi*(x - p0)/p1)" },
  SineDamp: { params: ["y0", "xc", "w", "t0", "A"], expr: "p0 + p4*exp(-x/p3)*sin(pi*(x - p1)/p2)" },
};

export const fitModelExpr = (model: string): FitModelExpr | undefined =>
  Object.hasOwn(FIT_MODEL_EXPRS, model) ? FIT_MODEL_EXPRS[model] : undefined;
