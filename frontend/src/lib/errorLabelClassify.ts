// Ranking + selection over `errorLabelCandidates.ts`'s generated candidates
// (plans/ERROR_LABEL_CLASSIFIER_PLAN.md). This is the ONLY place dataset
// context (sibling column names) enters. Nothing here mutates a candidate;
// selection either returns one unchanged or returns none.
//
// The invariant this buys: adding a token to `ERROR_TOKENS` changes only
// generation. Ranking and selection below never look at the token list, so
// a new spelling cannot perturb an existing spelling's result.

import {
  ERROR_TOKENS,
  flatNorm,
  generateCandidates,
  hasConfirmedCandidate,
  type Candidate,
  type ErrorSide,
} from "./errorLabelCandidates";

export type { ErrorSide };

export interface ClassifiedLabel {
  axis: "x" | "y" | null;
  side: ErrorSide;
  base: string;
}

/** Total order over candidates for one label:
 *   1. confirmed before provisional
 *   2. longer matched token first ("stderr" beats "err")
 *   3. longer remaining base first
 *   4. lexical on (base, token, side), to make the order total and the
 *      selection deterministic -- `base` alone is not total, since two
 *      candidates can share a base with different tokens.
 *  Fields are compared in sequence, never concatenated into one sort key
 *  (a concatenated key with no separator, or a NUL-byte separator, has bit
 *  patterns that can misclassify the source file itself as binary). */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
    if (a.token.length !== b.token.length) return b.token.length - a.token.length;
    if (a.base.length !== b.base.length) return b.base.length - a.base.length;
    if (a.base !== b.base) return a.base < b.base ? -1 : 1;
    if (a.token !== b.token) return a.token < b.token ? -1 : 1;
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    return 0;
  });
}

function toResult(c: Candidate): ClassifiedLabel {
  return { axis: c.axis, side: c.side, base: c.base };
}

/** SELECT, stated precisely (the plan's own wording):
 *
 *  1. Scan EVERY candidate, in ranked order, for sibling evidence -- a
 *     sibling label (not itself independently error-like) whose normalized
 *     form equals the candidate's base. This is not "check the top-ranked
 *     candidate, then fall back": `MStdErr` beside `M` ranks
 *     confirmed(stderr,"m") ABOVE confirmed(err,"mstd") by longer-token, so
 *     the first candidate scanned already has the sibling; but a case where
 *     the top-ranked candidate's base has no sibling must still continue
 *     down the ranked list rather than give up.
 *  2. Otherwise, the first CONFIRMED candidate -- a confirmed reading can
 *     never be destroyed by a provisional one, which is what makes the old
 *     failure class ("Phase_err" losing its error bars to a later phase)
 *     impossible here: there IS no later phase, only a ranked list.
 *  3. Otherwise, not an error column.
 *
 *  Sibling eligibility uses `hasConfirmedCandidate` (context-free, no
 *  evidence) rather than the full recursive classification, so this never
 *  has to resolve a cycle between two labels each trying to use the other
 *  as evidence -- and so a label whose only reading of ITSELF is
 *  provisional (a glued substring match, not a real segment boundary)
 *  still counts as ordinary data and stays eligible as somebody else's
 *  sibling. */
export function selectCandidate(
  candidates: readonly Candidate[],
  labels: readonly string[],
  selfIndex: number,
  tokens: readonly string[] = ERROR_TOKENS,
): Candidate | null {
  if (candidates.length === 0) return null;
  const ranked = rankCandidates(candidates);

  for (const c of ranked) {
    if (!c.base) continue;
    for (let i = 0; i < labels.length; i++) {
      if (i === selfIndex) continue;
      if (hasConfirmedCandidate(labels[i], tokens)) continue;
      if (flatNorm(labels[i]) === c.base) return c;
    }
  }

  return ranked.find((c) => c.confirmed) ?? null;
}

/** The context-aware primary: does `labels[index]` read as an uncertainty
 *  column, given the OTHER labels as potential sibling evidence? This is
 *  what `inferErrorBindingsFromLabels` calls per channel -- the decision of
 *  whether a column IS an error column now lives here, not split between a
 *  context-free single-string classifier and a separate pairing pass. */
export function classifyErrorLabelInLabels(
  labels: readonly string[],
  index: number,
  tokens: readonly string[] = ERROR_TOKENS,
): ClassifiedLabel | null {
  const label = labels[index];
  if (!label || !label.trim()) return null;
  const candidates = generateCandidates(label, tokens);
  const selected = selectCandidate(candidates, labels, index, tokens);
  return selected ? toResult(selected) : null;
}

/** Context-free convenience wrapper kept for the ~40 existing importers of
 *  the single-string signature (and this module's own unit tests): "if this
 *  were the only column on the sheet, what would we call it". With no
 *  siblings to offer evidence, this returns the TOP-RANKED candidate
 *  overall (confirmed, or provisional if nothing confirmed exists) rather
 *  than running the strict evidence-gated SELECT above -- `classifyErrorLabel
 *  ("Rerr")` must still read as `{ base: "r" }` even though `Rerr`'s only
 *  candidate (a glued "err" at the edge, since "rerr" is one whole segment,
 *  not "err") is provisional and there is no sibling "R" in a one-element
 *  label list. This laxer fallback is deliberately NOT used for
 *  pairing-target-exclusion decisions -- those always go through the
 *  strict, evidence-gated `classifyErrorLabelInLabels` instead, or a bare
 *  "Depth"/"Density"/"Delay" (all zero-candidate, so unaffected either way)
 *  or a genuinely provisional-only column would round-trip back into being
 *  misclassified via this wrapper's own top-ranked-regardless fallback. */
export function classifyErrorLabel(
  label: string,
  tokens: readonly string[] = ERROR_TOKENS,
): ClassifiedLabel | null {
  if (!label || !label.trim()) return null;
  const candidates = generateCandidates(label, tokens);
  if (candidates.length === 0) return null;
  const ranked = rankCandidates(candidates);
  return toResult(ranked[0]);
}

/** Context-free "is this label error-like at all" (re-exported for
 *  `errorRoles.ts`'s pairing-target exclusion at the FINAL, evidence-gated
 *  layer it needs — see that module for how it's actually used there). */
export { hasConfirmedCandidate };
