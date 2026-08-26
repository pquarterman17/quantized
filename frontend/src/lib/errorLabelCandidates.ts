// Error-label candidate generation (plans/ERROR_LABEL_CLASSIFIER_PLAN.md).
//
// Seven review rounds on the previous classifier each fixed one bug and
// introduced another in the same family, because that classifier MUTATED
// one interpretation across sequential phases and could not undo a wrong
// commitment (`Phase_err` -> confirmed base "phase" -> a later phase
// re-peels "phase" itself and overwrites the correct answer with "pha").
//
// The fix: this module only GENERATES candidates. It never decides which
// one wins — nothing here mutates, nothing here commits. Ranking
// (`errorLabelClassify.ts`'s `rankCandidates`) and selection (`selectCandidate`
// / `classifyErrorLabelInLabels`) are separate and pure over the candidate
// list, so a new spelling added here cannot perturb any existing spelling's
// result -- the interaction surface that produced the regressions is gone.

/** Which side of an asymmetric pair a column supplies. */
export type ErrorSide = "both" | "+" | "-";

export interface Candidate {
  /** Which token matched. */
  token: string;
  /** Normalized remainder (lowercase, separators stripped); "" only where
   *  the whole label IS the token, or where a rule defines it that way
   *  (the x/y axis-prefix rule). */
  base: string;
  side: ErrorSide;
  axis: "x" | "y" | null;
  /** true = the token sat on real segment boundaries (whole segment(s), or
   *  an axis/quantity prefix). false = the token was found glued inside an
   *  edge segment -- plausible, but needs sibling evidence to confirm. */
  confirmed: boolean;
}

/** Suffixes that mark an asymmetric half, checked before token matching so
 *  `err+` is not first read with "+" as part of the base. */
const PLUS = ["+", "up", "hi", "high", "upper"];
const MINUS = ["-", "dn", "down", "lo", "low", "lower"];

/** The token table. New spellings are added HERE ONLY -- ranking and
 *  selection (`errorLabelClassify.ts`) are independent of this list, so
 *  adding a token cannot perturb an existing token's result. */
export const ERROR_TOKENS = ["stderr", "sigma", "error", "err", "unc", "sdev", "std", "sd", "se"];

/** A single-letter quantity prefix allowed to glue directly onto a token
 *  and still count as CONFIRMED (`Ierr` -> base "i").
 *
 *  There is no label-intrinsic signal separating `Ierr` from `Kerr`: both
 *  are one segment, single-letter base, glued `err`. This is a deliberate
 *  DOMAIN special case (XRD intensity-error columns), not a general rule --
 *  `k`/`Kerr` is the named, deliberate exclusion. `Kerr` binds only when a
 *  literal sibling `K` column exists (the ordinary evidence rule), exactly
 *  like `Ierr` does when no `I` sibling exists but positional pairing takes
 *  over instead. Do not extend this list casually; every entry is a
 *  standing exception to "no label-intrinsic signal decides this".
 */
export const CONFIRMED_QUANTITY_PREFIXES = ["i"];

function normSeg(s: string): string {
  return s.trim().toLowerCase();
}

/** Split a label into ordered, lowercase segments. Concatenating every
 *  segment reproduces the fully-normalized (lowercase, whitespace/underscore
 *  stripped) flat label exactly -- segmentation only inserts cut points, it
 *  never drops or reorders characters. Splits on whitespace/underscore
 *  first (`M_std_err` -> `M`,`std`,`err`), then on camelCase boundaries
 *  within each resulting word (`MStdErr` -> `M`,`Std`,`Err`), then on a
 *  letter-to-digit boundary (`err1` -> `err`,`1`; a trailing instrument
 *  channel index must not hide "err" sitting on an otherwise-whole segment
 *  boundary) -- but never a digit-to-letter boundary, so `2theta` stays one
 *  piece. So both spellings of the same intent segment identically. */
export function segmentsOf(label: string): string[] {
  const words = label.trim().split(/[\s_]+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const camel = word.split(/(?=[A-Z])/).filter(Boolean);
    for (const piece of camel) {
      const digitSplit = piece.split(/(?<=[a-zA-Z])(?=[0-9])/).filter(Boolean);
      for (const sub of digitSplit) out.push(normSeg(sub));
    }
  }
  return out;
}

function flatten(segments: readonly string[]): string {
  return segments.join("");
}

interface SideStrip {
  segments: string[];
  flat: string;
  side: ErrorSide;
}

/** Peel an asymmetric-side suffix, if present. Tries a whole trailing
 *  segment first (`err_upper` -> segments `err`,`upper`), then a glued
 *  suffix on the flat string (`errlow` -> "low", `err+` -> "+") -- the
 *  glued fallback can't preserve segmentation, so its remainder becomes a
 *  single re-synthesized segment for the rules below. */
function peelSide(segments: readonly string[], flat: string): SideStrip {
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (PLUS.includes(last)) {
      const rest = segments.slice(0, -1);
      return { segments: rest, flat: flatten(rest), side: "+" };
    }
    if (MINUS.includes(last)) {
      const rest = segments.slice(0, -1);
      return { segments: rest, flat: flatten(rest), side: "-" };
    }
  }
  for (const suf of PLUS) {
    if (flat.endsWith(suf) && flat.length > suf.length) {
      const rest = flat.slice(0, -suf.length);
      return { segments: [rest], flat: rest, side: "+" };
    }
  }
  for (const suf of MINUS) {
    if (flat.endsWith(suf) && flat.length > suf.length) {
      const rest = flat.slice(0, -suf.length);
      return { segments: [rest], flat: rest, side: "-" };
    }
  }
  return { segments: [...segments], flat, side: "both" };
}

/** Generate every plausible error-column reading of `label`, unranked and
 *  uncommitted. `tokens` is injectable (defaults to the real table) purely
 *  so tests can prove the ranking/selection layer is independent of the
 *  token list -- production callers should never pass it. Recomputed on
 *  every call (never cached at module load): the derived "may glue" set
 *  below depends on `tokens`, and caching it against the DEFAULT table
 *  would make an injected token silently skip the 2-character restriction. */
export function generateCandidates(label: string, tokens: readonly string[] = ERROR_TOKENS): Candidate[] {
  const rawSegments = segmentsOf(label);
  if (rawSegments.length === 0) return [];
  const rawFlat = flatten(rawSegments);

  const { segments, flat, side } = peelSide(rawSegments, rawFlat);
  if (!flat) return [];

  // Tokens allowed to match GLUED (substring at an edge, not aligned to a
  // segment boundary) -- 2-character tokens ("sd", "se") may only match a
  // WHOLE segment, never glued, or "Set" yields a glued base "t" and binds
  // against a single-letter column.
  const glueable = tokens.filter((t) => t.length >= 3);

  const candidates: Candidate[] = [];
  const n = segments.length;

  // Rule: a run of one or more consecutive WHOLE segments, trailing or
  // leading, joins to a token. k===1 is "a whole segment equals a token";
  // k>1 is the multi-segment run (`M_std_err`'s "std"+"err" -> "stderr").
  // Every matching run length gets its own candidate -- ranking, not
  // generation, picks between them.
  for (let k = 1; k <= n; k++) {
    const trailingJoined = flatten(segments.slice(n - k));
    if (tokens.includes(trailingJoined)) {
      candidates.push({
        token: trailingJoined,
        base: flatten(segments.slice(0, n - k)),
        side,
        axis: null,
        confirmed: true,
      });
    }
    if (k < n) {
      const leadingJoined = flatten(segments.slice(0, k));
      if (tokens.includes(leadingJoined)) {
        candidates.push({
          token: leadingJoined,
          base: flatten(segments.slice(k)),
          side,
          axis: null,
          confirmed: true,
        });
      }
    }
  }

  // Rule: a token glued inside an edge segment (provisional -- needs
  // sibling evidence to confirm). A candidate with an empty base is valid
  // ONLY where the whole label IS the token (covered by the run rule
  // above with k===n), so glued matches require a non-empty remainder.
  for (const t of glueable) {
    if (flat.length <= t.length) continue;
    if (flat.endsWith(t)) {
      candidates.push({ token: t, base: flat.slice(0, -t.length), side, axis: null, confirmed: false });
    }
    if (flat.startsWith(t)) {
      candidates.push({ token: t, base: flat.slice(t.length), side, axis: null, confirmed: false });
    }
  }

  // Rule: a confirmed peel composed with a glued peel of what remains
  // (provisional) -- `MStdErr`'s "err" peels confirmed to base "mstd",
  // and "mstd" itself ends with the token "std", so a further glued peel
  // to base "m" is a SEPARATE candidate, not a mutation of the first.
  for (const c of [...candidates]) {
    if (!c.confirmed || !c.base) continue;
    for (const t of glueable) {
      if (c.base.length <= t.length) continue;
      if (c.base.endsWith(t)) {
        candidates.push({ token: t, base: c.base.slice(0, -t.length), side, axis: null, confirmed: false });
      }
      if (c.base.startsWith(t)) {
        candidates.push({ token: t, base: c.base.slice(t.length), side, axis: null, confirmed: false });
      }
    }
  }

  // Rule: the bare leading "d" delta convention (dR, dQ, dSA, dR2) --
  // CONFIRMED, but ONLY when "d" is its own genuine leading SEGMENT (a
  // capital letter, digit, space, or underscore immediately follows it in
  // the ORIGINAL label, forcing a real segment boundary there). This is
  // what tells "dR" apart from "Depth"/"Dose"/"Density"/"Delay": all five
  // are "d" + more letters, but only "dR" has a genuine boundary right
  // after the "d" -- "Depth" never splits into a "d" segment at all
  // (segmentsOf("Depth") is one whole segment, "depth"), so the rule
  // never fires for it. A false positive here would silently turn a real
  // measurement into whiskers, which is exactly what over-matching bare
  // "Depth"/"Dose" as this convention used to do.
  if (segments.length > 1 && segments[0] === "d") {
    candidates.push({ token: "d", base: flatten(segments.slice(1)), side, axis: null, confirmed: true });
  }

  // Rule: an explicit x/y axis prefix (confirmed) -- "xerr"/"yerr" say
  // which axis outright; the base is empty by definition of this rule.
  if (flat.length > 1 && (flat[0] === "x" || flat[0] === "y")) {
    const rest = flat.slice(1);
    if (tokens.includes(rest)) {
      candidates.push({ token: rest, base: "", side, axis: flat[0] as "x" | "y", confirmed: true });
    }
  }

  // Rule: a single-letter quantity prefix from CONFIRMED_QUANTITY_PREFIXES,
  // glued to a token (confirmed, base KEPT -- this is what makes `Ierr`
  // reach positional pairing without inventing a fake "I" sibling match).
  if (flat.length > 1) {
    const prefix = flat[0];
    if (CONFIRMED_QUANTITY_PREFIXES.includes(prefix)) {
      const rest = flat.slice(1);
      if (tokens.includes(rest)) {
        candidates.push({ token: rest, base: prefix, side, axis: null, confirmed: true });
      }
    }
  }

  return candidates;
}

/** Context-free: does `label` look even slightly like an error column on
 *  its own, with no sibling evidence? Used only to decide whether a LABEL
 *  is eligible to serve as somebody else's sibling-evidence target -- a
 *  label with its own CONFIRMED reading is disqualified from being
 *  "ordinary data" for that purpose. Deliberately narrower than "has any
 *  candidate at all": a label whose only reading is PROVISIONAL (a glued
 *  substring match, not aligned to a real segment boundary) still counts
 *  as ordinary data and stays eligible -- only a confirmed self-reading is
 *  strong enough evidence to disqualify a column from being someone
 *  else's target. */
export function hasConfirmedCandidate(label: string, tokens: readonly string[] = ERROR_TOKENS): boolean {
  return generateCandidates(label, tokens).some((c) => c.confirmed);
}

/** The fully-normalized (lowercase, whitespace/underscore stripped) flat
 *  form of a label -- what a candidate's `base` is compared against when
 *  looking for a sibling column by name. */
export function flatNorm(label: string): string {
  return flatten(segmentsOf(label));
}
