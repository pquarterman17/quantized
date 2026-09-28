// UNIT evidence for error-column pairing: do an error column's unit and its
// proposed target's unit agree? The TypeScript half of a CROSS-LANGUAGE PAIR
// with src/quantized/io/error_unit_evidence.py (read its module docstring for
// the full rationale). Parity is pinned case by case by the shared
// tests/fixtures/error_labels/unit_evidence_corpus.json, read by BOTH
// errorUnitEvidence.test.ts and tests/test_error_unit_evidence_parity_fixture.py.
//
//   "match"    both units known and equal after trivial-spelling normalisation.
//   "mismatch" both known and different: callers FAIL CLOSED and never bind the
//              pair (a bar is drawn in its target's units with no conversion,
//              so `mT` beside `T` or `%` beside `ohm` is a confidently wrong
//              plot).
//   "unknown"  either side blank/unitless/arbitrary, or the two differ ONLY in
//              letter case (`emu`/`EMU` is one unit, `mK`/`MK` is not). Neutral.
//
// Normalisation is SPELLING only, never dimensional analysis. On the EAGER
// path (errorRoles.ts), so it is written compactly; every rule below mirrors a
// named piece of the Python and the fixture exercises each one.

export type UnitEvidence = "match" | "mismatch" | "unknown";

// Python's whitespace (`str.isspace`, which is what its `\s` and `.strip()`
// use) is JS `\s` minus U+FEFF, plus U+001C..U+001F and U+0085.
const WS = "(?:[^\\S\\uFEFF]|[\\x1C-\\x1F\\x85])+";
const WS_RE = new RegExp(WS, "g");
const EDGE_WS_RE = new RegExp(`^${WS}|${WS}$`, "g");
const strip = (s: string): string => s.replace(EDGE_WS_RE, "");

// `_UNITLESS`, compared lowercased with all whitespace removed. Exactly its 25
// spellings: "", "-", "--", "---", "?", na, n/a, none, nan, null, 1, unitless,
// dimensionless, a.u., a.u, au, and the nine `arb` forms (arb, arb., arb.u,
// arb.u., arb.unit, arb.units, arbunits, arbitrary, arbitraryunits).
const UNITLESS_RE =
  /^(?:-{0,3}|\?|n(?:a|\/a|one|an|ull)|1|unitless|dimensionless|a(?:\.u\.?|u)|arb(?:\.(?:u(?:\.|nits?)?)?|units|itrary(?:units)?)?)$/;

/** `_strip_enclosing`: drop bracket pairs that wrap the WHOLE string
 *  (`(K)`/`[K]` -> `K`); one wrapping only part (`(m/s)^2`) is kept. */
function stripEnclosing(s: string): string {
  for (;;) {
    const open = s[0];
    const close = ")]}"["([{".indexOf(open)];
    if (s.length < 2 || close === undefined || s[s.length - 1] !== close) return s;
    const inner = s.slice(1, -1);
    let depth = 0;
    for (const ch of inner) {
      if (ch === open) depth++;
      else if (ch === close && --depth < 0) return s;
    }
    if (depth) return s;
    s = strip(inner);
  }
}

/** `_symbolise_word` over one ASCII alphabetic run: `_WORDS` (ohm(s),
 *  deg/degree(s), degc/degf, ang/angstrom(s), percent) and a one-letter
 *  prefixed ohm (`mOhm` -> `mΩ`). */
function symbolise(word: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^([a-z]?)ohms?$/i.exec(word))) return `${m[1]}Ω`;
  if ((m = /^deg(?:([cf])|rees?)?$/i.exec(word))) return `°${(m[1] ?? "").toUpperCase()}`;
  if (/^ang(?:stroms?)?$/i.test(word)) return "Å";
  return /^percent$/i.test(word) ? "%" : word;
}

/** Canonical spelling of `unit` for comparison, or `null` when it is blank,
 *  unitless, or arbitrary. Letter case is PRESERVED (see the header). */
export function normalizeUnit(unit: unknown): string | null {
  if (typeof unit !== "string") return null;
  const s = stripEnclosing(strip(unit.normalize("NFKC")));
  if (UNITLESS_RE.test(s.replace(WS_RE, "").toLowerCase())) return null;
  return (
    s
      .replace(/[A-Za-z]+/g, symbolise)
      .replace(/[−–]/g, "-") // MINUS SIGN (from a superscript minus), EN DASH
      .replace(/μ/g, "u") // NFKC already folded MICRO SIGN to GREEK SMALL MU
      .replace(/[\^*·⋅∙]/g, "") // exponent and multiplication marks
      .replace(WS_RE, "")
      // A hyphen NOT before a digit is a product ("ohm-cm"); before one it is
      // an exponent sign ("cm-3"). `\p{Nd}` because Python's `\d` is Unicode.
      .replace(/-(?!\p{Nd})/gu, "") || null
  );
}

/** Unit evidence for pairing an error column (`errorUnit`) with the value
 *  column or x axis (`valueUnit`) it would describe. */
export function compareUnits(errorUnit: unknown, valueUnit: unknown): UnitEvidence {
  const a = normalizeUnit(errorUnit);
  const b = normalizeUnit(valueUnit);
  if (a === null || b === null) return "unknown";
  if (a === b) return "match";
  // Python's `casefold()`; upper-then-lower folds the same pairs it does
  // (ß/SS, ς/σ, ſ/s) where a bare toLowerCase would not.
  return a.toUpperCase().toLowerCase() === b.toUpperCase().toLowerCase() ? "unknown" : "mismatch";
}
