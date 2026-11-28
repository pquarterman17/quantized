// Significance brackets and compact-letter display for the categorical Stat
// Stage plots (box / violin / strip / bar). Pure: no DOM, no store, no fetch.
//
// The statistics are the existing post-hoc endpoints' — `POST /api/stats/tukey`
// (all pairs, familywise-adjusted p) and `POST /api/stats/dunnett` (each group
// vs one control) — this module only turns their pair p-values into what is
// DRAWN, so there is no second test engine. Conventions, pinned here once and
// restated verbatim on the figure (`compareNote`):
//   * alpha is fixed at 0.05 (the endpoints' own default); a pair is
//     significant when its (already multiplicity-adjusted) p < alpha;
//   * stars: * p<0.05, ** p<0.01, *** p<0.001, **** p<0.0001;
//   * brackets draw SIGNIFICANT pairs only (n.s. pairs are not drawn, and the
//     note says so);
//   * letters (Tukey only — Dunnett does not test every pair, so letters
//     would claim comparisons it never made) are the insert-absorb compact
//     letter display (Piepho 2004): groups sharing a letter are not
//     significantly different; "a" goes to the group with the highest mean.
// The export twin draws the SAME geometry (`calc.figure_stat_comparisons`):
// the layout is computed once, on the client, and posted.

export type ComparisonDisplay = "off" | "brackets" | "letters";
export type ComparisonMethod = "tukey" | "dunnett";

export const COMPARE_ALPHA = 0.05;

/** One tested pair, as indices into the compared groups. */
export interface PairP {
  a: number;
  b: number;
  p: number;
}

/** The outcome of a comparison run, before layout. */
export interface StatComparisonsResult {
  /** "given": the p-values were supplied (`lib/sigSource`), nothing was tested here. */
  method: ComparisonMethod | "given";
  display: Exclude<ComparisonDisplay, "off">;
  /** Show the exact p beside the stars. */
  exact: boolean;
  /** A bracket's text for a pair's p, or null to leave the pair undrawn.
   *  Absent: the fixed stars (`bracketLabel`), significant pairs only. */
  label?: (p: number) => string | null;
  pairs: PairP[];
  /** One letter string per compared group (letters display), else null. */
  letters: string[] | null;
  note: string;
}

/** What is drawn, in the plot's own units: `a` / `b` / `slot` are AXIS slot
 *  indices, `y` is a value-axis (data) coordinate. Posted verbatim to the
 *  export, which is what keeps screen and figure agreeing. */
export interface ComparisonMarks {
  note: string;
  brackets: { a: number; b: number; y: number; label: string }[];
  letters: { slot: number; y: number; text: string }[];
  /** Bracket end-tick length, data units. */
  tick: number;
  /** Highest extent (label headroom included), data units — folded into the value domain. */
  top: number;
}

/** Stars for an adjusted p ("" when not significant at `COMPARE_ALPHA`). */
export function starsOf(p: number): string {
  if (!Number.isFinite(p) || p >= COMPARE_ALPHA) return "";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  return "*";
}

/** A p-value to 2 significant digits, `<0.0001` below that. ASCII. */
export function formatP(p: number): string {
  if (p < 0.0001) return "<0.0001";
  return String(Number(p.toPrecision(2)));
}

/** A bracket's text: the stars, plus `p=...` when `exact`. */
export function bracketLabel(p: number, exact: boolean): string {
  const s = starsOf(p);
  return exact ? `${s} p=${formatP(p)}` : s;
}

/** The sentence naming the test and correction (ASCII, one text for screen and figure). */
export function compareNote(
  method: ComparisonMethod,
  display: Exclude<ComparisonDisplay, "off">,
  control: string | null,
): string {
  const test =
    method === "tukey"
      ? "Tukey HSD (all pairs, p adjusted)"
      : `Dunnett vs control${control ? ` "${control.length > 24 ? `${control.slice(0, 23)}...` : control}"` : ""} (p adjusted)`;
  const tail =
    display === "letters"
      ? "groups sharing a letter do not differ"
      : "* p<0.05 ** p<0.01 *** p<0.001 **** p<0.0001; n.s. not drawn";
  return `${test}, familywise alpha = ${COMPARE_ALPHA}; ${tail}`;
}

/** Why this method/display pairing cannot be drawn, or null. Fail closed. */
export function refusal(method: ComparisonMethod, display: ComparisonDisplay): string | null {
  if (display === "letters" && method === "dunnett") {
    return "Letters need every pair tested: use Tukey (Dunnett only compares to the control)";
  }
  return null;
}

/** The compact letter display. `means[g]` orders the groups (highest mean
 *  gets "a"); `pairs` are every tested pair. Insert-absorb: start with one
 *  column holding every group; for each SIGNIFICANT pair, split any column
 *  holding both; then drop columns contained in another. A pair left
 *  untested is treated as not significant (it never splits a column). */
export function compactLetters(means: readonly number[], pairs: readonly PairP[]): string[] | null {
  const k = means.length;
  let cols: Set<number>[] = [new Set(Array.from({ length: k }, (_, i) => i))];
  for (const { a, b, p } of pairs) {
    if (!(p < COMPARE_ALPHA)) continue;
    const next: Set<number>[] = [];
    for (const c of cols) {
      if (c.has(a) && c.has(b)) {
        next.push(new Set([...c].filter((x) => x !== a)), new Set([...c].filter((x) => x !== b)));
      } else next.push(c);
    }
    cols = absorb(next);
  }
  const order = [...Array(k).keys()].sort((x, y) => means[y] - means[x] || x - y);
  const rank = (c: Set<number>) => Math.min(...[...c].map((g) => order.indexOf(g)));
  cols.sort((x, y) => rank(x) - rank(y));
  if (cols.length > LETTERS.length) return null; // a wrapped letter would claim a share that was never found
  return Array.from({ length: k }, (_, g) =>
    cols.flatMap((c, i) => (c.has(g) ? [LETTERS[i]] : [])).join(""),
  );
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Remove empty, duplicate and contained columns. */
function absorb(cols: Set<number>[]): Set<number>[] {
  const keep = cols.filter((c) => c.size > 0);
  return keep.filter((c, i) =>
    !keep.some((o, j) => j !== i && o.size >= c.size && [...c].every((x) => o.has(x)) && (o.size > c.size || j < i)),
  );
}

/** The result for already-tested pairs, or the refusal message. */
export function buildComparisons(
  method: ComparisonMethod,
  display: Exclude<ComparisonDisplay, "off">,
  exact: boolean,
  means: readonly number[],
  pairs: readonly PairP[],
  control: string | null,
): StatComparisonsResult | { error: string } {
  const why = refusal(method, display);
  if (why) return { error: why };
  const letters = display === "letters" ? compactLetters(means, pairs) : null;
  if (display === "letters" && !letters) return { error: `Letters need at most ${LETTERS.length} distinct groups of letters; use brackets` };
  return { method, display, exact, pairs: [...pairs], letters, note: compareNote(method, display, control) };
}
