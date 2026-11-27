// The "Complex numbers" entries of the Set Column Values function picker
// (plans/COMPLEX_FORMULA_CONTRACT.md C11): signature plus the one fact a user
// would otherwise have to guess, then the three worked examples. Every name of
// lib/formulaComplexNames.ts appears here (formulaComplex.test.ts), and every
// example is evaluated there.

export interface ComplexHelpEntry {
  label: string;
  /** Inserted at the cursor; `|` marks where the cursor goes after. */
  text: string;
}

const e = (label: string, text: string): ComplexHelpEntry => ({ label, text });

const GROUP = "Complex numbers";

export const COMPLEX_ENTRIES: ComplexHelpEntry[] = [
  e(`${GROUP}: complex(re, im) — a value inside a formula; a cell still holds one real number`, "complex(|, )"),
  e(`${GROUP}: polar(r, theta) — modulus and angle in radians`, "polar(|, )"),
  e(`${GROUP}: 2i, 0.5j, 1e3i — an imaginary literal (a number straight followed by i or j)`, "2i"),
  e(`${GROUP}: re(z) / im(z) — real and imaginary part (real, imag)`, "re(|)"),
  e(`${GROUP}: abs(z) / arg(z) — modulus; angle in (-pi, pi] radians (angle)`, "arg(|)"),
  e(`${GROUP}: conj(z) — complex conjugate`, "conj(|)"),
  e(`${GROUP}: exp log log10 sqrt sin cos tan sinh cosh tanh — principal branch, for a complex argument`, "sqrt(|)"),
  e(`${GROUP}, example: impedance magnitude from columns B (R) and C (X)`, "abs(complex(B, C))"),
  e(`${GROUP}, example: phase in degrees`, "degrees(arg(complex(B, C)))"),
  e(`${GROUP}, example: RC low-pass magnitude over frequency x (R C = 1 ms)`, "abs(1 / (1 + 2i*pi*x*1e-3))"),
];
