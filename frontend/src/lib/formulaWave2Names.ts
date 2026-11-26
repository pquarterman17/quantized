// Names of the wave-2 element-wise functions the exported Python script also
// computes (calc/column_formula_extra.py), in a leaf of their own so the EAGER
// headless check (lib/formulaHeadless.ts) knows them without loading the
// numerics. formulaWave2.test.ts pins this list to the lazy table's keys.
export const WAVE2_NAMES: ReadonlySet<string> = new Set(
  "erf erfc gamma lgamma erfinv erfcinv beta lbeta digamma besselj bessely sinc clamp heaviside todb fromdb degrees radians mod trunc fact combin permut gcd lcm isnan ifnan between wrap choose cbrt expm1 log1p".split(" "),
);

/** The lookup/reference calls (lib/formulaLookup.ts): app-only, so not in the list above. */
export const LOOKUP_NAMES: ReadonlySet<string> = new Set(["lookup", "xlookup", "match", "index", "offset"]);
