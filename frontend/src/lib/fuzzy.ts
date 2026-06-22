// Ported from fermiviewer frontend/src/lib/fuzzy.ts (shared platform code —
// keep in sync). Fuzzy subsequence matcher for the command palette.

export interface FuzzyResult {
  score: number;
  /** indices of matched characters in the haystack (for highlighting) */
  hits: number[];
}

/** null when the needle is not a subsequence of the haystack. */
export function fuzzy(needle: string, haystack: string): FuzzyResult | null {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (n.length === 0) return { score: 0, hits: [] };

  const hits: number[] = [];
  let score = 0;
  let hi = 0;
  let lastHit = -2;
  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    let found = -1;
    while (hi < h.length) {
      if (h[hi] === c) {
        found = hi;
        break;
      }
      hi++;
    }
    if (found === -1) return null;
    // bonuses: consecutive run, word start, exact-position start
    score += 1;
    if (found === lastHit + 1) score += 2;
    if (found === 0 || h[found - 1] === " " || h[found - 1] === "-") score += 3;
    hits.push(found);
    lastHit = found;
    hi = found + 1;
  }
  // shorter haystacks rank higher for equal matches
  score -= h.length * 0.01;
  return { score, hits };
}
