import { describe, expect, it } from "vitest";

import { FIT_MODEL_EXPRS } from "../../../lib/derivedFitModels";
import { parseRichText } from "../../../lib/richtext";
import { equationPlain, equationTex, latexName } from "./fitEquationText";
import { DEFAULT_FIT_ANNOTATION, type FitAnnotationOptions } from "../../../lib/fitAnnotationOptions";
import { buildFitAnnotationText } from "./fitAnnotationText";

const input = (model: string, names: string[], over: Record<string, unknown> = {}) => ({
  model,
  names,
  result: { params: [2.327, 0.5], errors: [0.0123, 0.011], R2: 0.99812, nPoints: 42, nFree: 2, ...over },
  xUnit: "K",
  yUnit: "emu",
});
const opt = (o: Partial<FitAnnotationOptions> = {}): FitAnnotationOptions => ({ ...DEFAULT_FIT_ANNOTATION, ...o });

describe("equations", () => {
  it("plain: parameter names replace p-indices", () => {
    expect(equationPlain("Linear", ["m", "b"])).toBe("y = m·x + b");
    expect(equationPlain("Exponential Decay", ["A", "τ", "C"])).toBe("y = A·exp(-x/τ) + C");
  });
  it("a model without a formula is named, never invented", () => {
    expect(equationPlain("Langevin", ["a"])).toBe("y = Langevin(x)");
    expect(equationTex("Langevin", ["a"])).toBeNull();
  });
  it("latex: fractions, exponentials and Greek parse in the screen subset", () => {
    const tex = equationTex("Exponential Decay", ["A", "τ", "C"])!;
    expect(tex).toBe("A\\,e^{\\frac{-x}{\\tau}}+C");
    expect(parseRichText(`$y=${tex}$`).ok).toBe(true);
    const lang = equationTex("Langmuir", ["A", "K"])!;
    expect(lang).toBe("\\frac{A\\,x}{K+x}");
    expect(parseRichText(`$y=${lang}$`).ok).toBe(true);
  });
  it("latexName refuses names with no safe form", () => {
    expect(latexName("A₁")).toBe("A_{1}");
    expect(latexName("τ")).toBe("\\tau");
    expect(latexName("Eₐ/kB")).toBeNull();
  });
});

describe("buildFitAnnotationText", () => {
  it("plain, auto digits: PDG-rounded value ± error, equation and R²", () => {
    const { text, note } = buildFitAnnotationText(input("Linear", ["m", "b"]), opt());
    expect(text).toBe("y = m·x + b;  m = 2.327 ± 0.012;  b = 0.500 ± 0.011;  R² = 0.99812");
    expect(note).toBeNull();
  });
  it("fixed significant figures apply to value and error", () => {
    const { text } = buildFitAnnotationText(input("Linear", ["m", "b"]), opt({ digits: 2, equation: false, r2: false }));
    expect(text).toBe("m = 2.3 ± 0.012;  b = 0.50 ± 0.011");
  });
  it("options drop the equation, add N and units", () => {
    const { text } = buildFitAnnotationText(input("Linear", ["m", "b"]), opt({ equation: false, r2: false, n: true, units: true }));
    expect(text).toBe("m = 2.327 ± 0.012 emu/K;  b = 0.500 ± 0.011 emu;  N = 42");
  });
  it("a held parameter says fixed and shows no error; a missing error shows the value alone", () => {
    const i = input("Linear", ["m", "b"], { errors: [0.1, null] });
    const fixed = { ...i, fixed: [true, false] };
    expect(buildFitAnnotationText(fixed, opt({ equation: false, r2: false })).text).toBe("m = 2.327 (fixed);  b = 0.5");
  });
  it("wide magnitudes share one exponent", () => {
    const i = input("Linear", ["m", "b"], { params: [5.4e-13, 1], errors: [1.4e-13, 0.1] });
    expect(buildFitAnnotationText(i, opt({ equation: false, r2: false })).text).toContain("m = (5.4 ± 1.4)×10⁻¹³");
  });
  it("latex: every segment parses with the screen parser", () => {
    const { text, note } = buildFitAnnotationText(input("Exponential Decay", ["A", "τ", "C"], { params: [1, 2, 3], errors: [0.1, 0.2, 0.3] }), opt({ format: "latex" }));
    expect(note).toBeNull();
    expect(text).toContain("$y=A\\,e^{\\frac{-x}{\\tau}}+C$");
    expect(text).toContain("$\\tau=2.00\\pm0.20$");
    expect(text).toContain("$R^2=0.99812$");
    expect(parseRichText(text).ok).toBe(true);
  });
  it("latex that cannot be written falls back to plain with a note (never half markup)", () => {
    const { text, note } = buildFitAnnotationText(input("Arrhenius", ["A", "Eₐ/kB"]), opt({ format: "latex" }));
    expect(note).toMatch(/plain text is used/);
    expect(text).not.toContain("$");
    expect(text).toContain("Eₐ/kB = ");
  });
  it("every closed-form model yields text the screen parser accepts in LaTeX mode, and never throws", () => {
    for (const [model, f] of Object.entries(FIT_MODEL_EXPRS)) {
      const r = input(model, [...f.params], { params: f.params.map(() => 1.5), errors: f.params.map(() => 0.1) });
      const { text } = buildFitAnnotationText(r, opt({ format: "latex" }));
      expect(parseRichText(text).ok, model).toBe(true);
    }
  });
  it("only the equation falls back when it cannot be written as LaTeX; parameters stay LaTeX", () => {
    const names = ["A", "τ", "C"];
    const r = input("Exponential Decay", names, { params: [1, 2, 3], errors: [0.1, 0.2, 0.3] });
    const ok = buildFitAnnotationText(r, opt({ format: "latex" }));
    expect(ok.note).toBeNull();
    // A parameter name with no LaTeX form falls everything back to plain, with a note.
    const bad = buildFitAnnotationText(input("Exponential Decay", ["A", "Eₐ/kB", "C"]), opt({ format: "latex" }));
    expect(bad.note).toMatch(/plain text is used/);
  });
  it("an exponent in a value or error is real mathtext, never a stray 'e'", () => {
    const r = input("Linear", ["m", "b"], { params: [1e-9, 1], errors: [1, 0.1] });
    const { text } = buildFitAnnotationText(r, opt({ format: "latex", digits: 3, equation: false, r2: false }));
    expect(text).not.toMatch(/\de-?\d/);
    expect(parseRichText(text).ok).toBe(true);
  });
  it("an Object.prototype-named model has no formula and does not throw", () => {
    expect(equationPlain("constructor", ["a"])).toBe("y = constructor(x)");
    expect(equationTex("toString", ["a"])).toBeNull();
  });
  it("a dollar sign in a name is escaped so plain text cannot turn into math", () => {
    const { text } = buildFitAnnotationText(input("Linear", ["$m", "b"]), opt({ equation: false }));
    expect(parseRichText(text).ok).toBe(true);
    expect(text).toContain("\\$m");
  });
});
