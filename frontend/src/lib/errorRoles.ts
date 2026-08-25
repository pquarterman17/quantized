// The canonical error-column role contract (MAIN_PLAN #33, foundation for #36).
//
// What existed: `errKeys: Record<number, number>` — one error channel per value
// channel. That expresses exactly one shape, symmetric vertical Y error, which
// is why X error and asymmetric ± pairs were unreachable. This module is the
// model that covers every shape the plan names (X±, Y±, X+/X−, Y+/Y−), with
// `errKeys` derived from it so every existing consumer keeps working untouched.
//
// TWO RULES THIS ENCODES, both from the plan:
//
//  1. Names are SUGGESTED, never silently forced. `err`/`sigma`/`dR` and
//     friends are strong hints, but a column called `error` next to three Y
//     columns is genuinely ambiguous, and quietly binding it to the wrong one
//     produces a plot that is confidently wrong. So inference only proposes
//     where the pairing is unambiguous, and everything is overridable.
//  2. An error column stays INDEPENDENT of the values it describes. A binding
//     is a reference, never a rewrite — toggling or re-pairing error bars can
//     never mutate the underlying X/Y data.

import type { DataStruct } from "./types";
import { classifyErrorLabel, classifyErrorLabelInLabels, type ErrorSide } from "./errorLabelClassify";
import { flatNorm } from "./errorLabelCandidates";

export type { ErrorSide };
// Re-exported for callers that used to reach into this module for the
// single-string classifier -- the generation/ranking/selection now live in
// `errorLabelCandidates.ts` / `errorLabelClassify.ts` (see
// plans/ERROR_LABEL_CLASSIFIER_PLAN.md), but the signature is unchanged.
export { classifyErrorLabel };

export interface ErrorBinding {
  /** Channel index holding the error values. */
  channel: number;
  /** Channel the error describes; -1 means the dataset's x axis. */
  target: number;
  axis: "x" | "y";
  side: ErrorSide;
}

/** Infer bindings from column LABELS ALONE, pairing each error column with
 *  the value column it describes.
 *
 *  PAIRING RULES, in order of confidence:
 *    1. Base-name match — `dR` binds to `R`, `M_err` to `M`. Unambiguous.
 *    2. An explicit `x` prefix binds to the x axis.
 *    3. Nearest PRECEDING value column — the instrument-file convention the
 *       Origin/reflectometry corpus already relies on.
 *  A column that matches none of these is left UNBOUND rather than guessed at:
 *  the plan's "never silently forced".
 *
 *  Label-only (no `.values` needed) so the SAME algorithm seeds the Import
 *  Wizard's error-role suggestions (P1.6) against a preview's resolved
 *  column names, before any DataStruct exists — `inferErrorBindings` below
 *  is a thin `data.labels` wrapper over this. */
export function inferErrorBindingsFromLabels(labels: readonly string[]): ErrorBinding[] {
  // The REAL, evidence-gated decision for every channel, computed once up
  // front (`classifyErrorLabelInLabels` only ever consults OTHER labels'
  // context-free `hasConfirmedCandidate`, never another label's `classified`
  // result, so this has no circular dependency). `isError` -- used below to
  // keep a channel that IS an error column from also being treated as
  // somebody else's target -- is the FINAL result, not the context-free
  // approximation: `dR` beside `R` is only confirmed via sibling evidence,
  // and still must not itself be eligible as a third column's target.
  const classified = labels.map((_, i) => classifyErrorLabelInLabels(labels, i));
  const isError = classified.map((c) => c !== null);
  const bindings: ErrorBinding[] = [];

  for (let ch = 0; ch < labels.length; ch++) {
    const info = classified[ch];
    if (!info) continue;

    // 1. base-name match against a NON-error column
    let target = -2;
    if (info.base) {
      const idx = labels.findIndex((l, i) => !isError[i] && flatNorm(l) === info.base);
      if (idx >= 0) target = idx;
    }
    // 2. explicit x prefix
    if (target === -2 && info.axis === "x") target = -1;
    // 3. nearest preceding value column
    if (target === -2) {
      for (let k = ch - 1; k >= 0; k--) {
        if (!isError[k]) {
          target = k;
          break;
        }
      }
    }
    if (target === -2) continue; // nothing defensible to bind to — leave it out

    bindings.push({
      channel: ch,
      target,
      axis: info.axis ?? (target === -1 ? "x" : "y"),
      side: info.side,
    });
  }
  return bindings;
}

/** `inferErrorBindingsFromLabels` against a real DataStruct's `.labels`. */
export function inferErrorBindings(data: DataStruct): ErrorBinding[] {
  return inferErrorBindingsFromLabels(data.labels ?? []);
}

/** Back-compat projection: the legacy `errKeys` map (value channel → error
 *  channel) that the existing error-bar plugin and fit weighting consume.
 *
 *  Only SYMMETRIC Y bindings project — that is all the legacy shape can carry,
 *  and silently collapsing an asymmetric pair into it would draw whiskers that
 *  misstate the data in one direction. */
export function errKeysFromBindings(bindings: readonly ErrorBinding[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const b of bindings) {
    if (b.axis === "y" && b.side === "both" && b.target >= 0) out[b.target] = b.channel;
  }
  return out;
}

/** The asymmetric pair for a target channel on one axis, if both halves exist.
 *  Returns null unless BOTH sides are present — half a pair is not an
 *  asymmetric error bar, and drawing it as one would invent the other side. */
export function asymmetricPair(
  bindings: readonly ErrorBinding[],
  target: number,
  axis: "x" | "y",
): { plus: number; minus: number } | null {
  const plus = bindings.find((b) => b.target === target && b.axis === axis && b.side === "+");
  const minus = bindings.find((b) => b.target === target && b.axis === axis && b.side === "-");
  return plus && minus ? { plus: plus.channel, minus: minus.channel } : null;
}

/** The asymmetric error slots that have only one half assigned.
 *
 * Rendering intentionally ignores these (see `asymmetricPair`), but the
 * mapping UI needs to explain why a column the user assigned does not show
 * up in the preview. Keep this alongside the canonical binding helpers so
 * every builder/editor uses the same pairing semantics.
 */
export interface IncompleteAsymmetricPair {
  target: number;
  axis: "x" | "y";
  plus: number | null;
  minus: number | null;
}

export function incompleteAsymmetricPairs(
  bindings: readonly ErrorBinding[],
): IncompleteAsymmetricPair[] {
  const groups = new Map<string, IncompleteAsymmetricPair>();
  for (const binding of bindings) {
    if (binding.side === "both") continue;
    const key = `${binding.axis}:${binding.target}`;
    const pair = groups.get(key) ?? { target: binding.target, axis: binding.axis, plus: null, minus: null };
    if (binding.side === "+") pair.plus ??= binding.channel;
    else pair.minus ??= binding.channel;
    groups.set(key, pair);
  }
  return [...groups.values()].filter((pair) => pair.plus === null || pair.minus === null);
}

/** The symmetric binding for a target on one axis, if any. */
export function symmetricBinding(
  bindings: readonly ErrorBinding[],
  target: number,
  axis: "x" | "y",
): number | null {
  const b = bindings.find((x) => x.target === target && x.axis === axis && x.side === "both");
  return b ? b.channel : null;
}

/** Does this binding set contain anything the legacy `errKeys` shape (value
 *  channel -> symmetric-Y error channel) cannot express -- an X-error, or an
 *  asymmetric (`+`/`-`) half? (plan G4) This is the activation predicate for
 *  treating a FigureDocument's own `bindings.errors` as authoritative over
 *  `Dataset.errorRoles` when rendering: a document whose errors are entirely
 *  legacy-expressible (y/both) is indistinguishable from what `errKeys`
 *  already carries, so ordinary windows (whose documents only ever derive
 *  their errors FROM `errKeys` -- see `figureDocument.ts`'s
 *  `legacyErrorBindings`) never flip to the document-authoritative path.
 *  Only a document seeded with genuinely richer error data (Quick Figure
 *  Builder's mapping, or a Graph Builder error well) does. */
export function hasRichErrorBindings(errors: readonly ErrorBinding[] | undefined): boolean {
  return !!errors?.some((binding) => binding.axis === "x" || binding.side !== "both");
}

/** Validate bindings read back from a `.dwk` / template — never trust the slot.
 *  Drops anything referencing a channel the dataset no longer has, which is
 *  what keeps a reapplied template from binding error bars to the wrong column
 *  after the source's shape changed. */
export function sanitizeBindings(
  raw: unknown,
  channelCount: number,
): ErrorBinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ErrorBinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Partial<ErrorBinding>;
    if (typeof b.channel !== "number" || typeof b.target !== "number") continue;
    if (b.channel < 0 || b.channel >= channelCount) continue;
    if (b.target < -1 || b.target >= channelCount) continue;
    if (b.axis !== "x" && b.axis !== "y") continue;
    if (b.side !== "both" && b.side !== "+" && b.side !== "-") continue;
    out.push({ channel: b.channel, target: b.target, axis: b.axis, side: b.side });
  }
  return out;
}
