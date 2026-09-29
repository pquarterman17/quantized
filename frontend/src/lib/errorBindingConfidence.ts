// The CONFIDENCE GRADE of an inferred error-column pairing, and the rule a new
// figure's seed goes through before it applies one (plans/
// LIBRARY_WORKBOOK_UX_PLAN.md: "Header, unit, parser metadata, and adjacency
// evidence contribute to a confidence result; adjacency alone is
// insufficient"). The TypeScript half of a CROSS-LANGUAGE PAIR with
// src/quantized/io/error_binding_confidence.py (read its module docstring for
// the full rationale); parity is pinned by the shared
// tests/fixtures/error_labels/confidence_corpus.json, read by BOTH
// errorBindingConfidence.test.ts and
// tests/test_error_binding_confidence_parity_fixture.py.
//
//              unit match   unit unknown
//   name       high         medium
//   position   medium       low          (a unit mismatch is always `blocked`)
//
// `inferErrorBindingsFromLabels` still decides WHICH column each error column
// pairs with; this module never re-targets a pairing, it only grades it.
//
// LAZY on purpose: its consumers are the Quick Figure Builder (a lazy region)
// and Quick Plot's review (`lib/quickPlotErrorReview.ts`, a dynamic import);
// store/quickPlotRun.ts's cheap `seedIsSettled` keeps the common Quick Plot
// synchronous without pulling the grade into the eager bundle.

import { figureSeedErrorBindings, isDeclaredBinding, inferErrorBindingsFromLabels, xUnitOf, type ErrorBinding } from "./errorRoles";
import { flatNorm } from "./errorLabelCandidates";
import { classifyErrorLabelInLabels, type ClassifiedLabel } from "./errorLabelClassify";
import { compareUnits, type UnitEvidence } from "./errorUnitEvidence";
import type { DataStruct, Dataset } from "./types";

export type HeaderEvidence = "name" | "position";
export type Confidence = "high" | "medium" | "low" | "blocked";

/** One label-rule pairing plus the evidence behind it (Python's
 *  `ScoredErrorBinding.to_dict()` shape, key for key). */
export interface ScoredErrorBinding extends ErrorBinding {
  header: HeaderEvidence;
  unit: UnitEvidence;
  confidence: Confidence;
}

/** Python's `binding_confidence`: a unit mismatch is `blocked` whatever the
 *  header says (fail closed); otherwise the table in the header comment. */
export function bindingConfidence(header: HeaderEvidence, unit: UnitEvidence): Confidence {
  if (unit === "mismatch") return "blocked";
  if (header === "name") return unit === "match" ? "high" : "medium";
  return unit === "match" ? "medium" : "low";
}

/** Python's `is_name_driven_match`: did RULE 1 (base-name match) or RULE 2
 *  (explicit x prefix) pair `labels[channel]`? False means only RULE 3
 *  (nearest preceding column, pure position) can have. Re-derived with the
 *  SAME decisions `inferErrorBindingsFromLabels` makes, from one shared
 *  classification pass. */
function isNameDriven(classified: readonly (ClassifiedLabel | null)[], labels: readonly string[], channel: number): boolean {
  const info = classified[channel];
  if (!info) return false;
  if (info.axis === "x") return true;
  const base = info.base;
  return !!base && labels.some((label, i) => classified[i] === null && flatNorm(label) === base);
}

/** Every pairing `inferErrorBindingsFromLabels(labels)` makes, in its order,
 *  graded -- BLOCKED ones included, so a caller can explain a refusal.
 *  `units[i]` is `labels[i]`'s unit and `xUnit` the x axis's (compared for an
 *  error column targeting the x axis); blank/missing is neutral evidence. */
export function scoreErrorBindings(
  labels: readonly string[],
  units: readonly (string | null | undefined)[],
  xUnit: string | null = null,
): ScoredErrorBinding[] {
  const classified = labels.map((_, i) => classifyErrorLabelInLabels(labels, i));
  return inferErrorBindingsFromLabels(labels).map((b) => {
    const header: HeaderEvidence = isNameDriven(classified, labels, b.channel) ? "name" : "position";
    const unit = compareUnits(units[b.channel], b.target < 0 ? xUnit : units[b.target]);
    return { ...b, header, unit, confidence: bindingConfidence(header, unit) };
  });
}

/** Python's `score_dataset_error_bindings`: over a dataset's labels and units,
 *  with its recorded x-axis unit. */
export function scoreDatasetErrorBindings(data: DataStruct): ScoredErrorBinding[] {
  return scoreErrorBindings(data.labels ?? [], data.units ?? [], xUnitOf(data.metadata));
}

const sameBinding = (a: ErrorBinding, b: ErrorBinding): boolean =>
  a.channel === b.channel && a.target === b.target && a.axis === b.axis && a.side === b.side;

export interface SeedErrorReview {
  /** Apply without asking: every seeded binding not listed below. */
  apply: ErrorBinding[];
  /** Seeded, but `low` (adjacency alone): ask before applying. */
  confirm: ScoredErrorBinding[];
  /** Every pairing whose units contradict: never applied automatically. */
  blocked: ScoredErrorBinding[];
}

/** What a NEW figure (Quick Plot, the Quick Figure Builder's first mapping)
 *  may apply from `figureSeedErrorBindings(dataset)` without asking.
 *
 *  A DECLARED pairing (`errorRoles.isDeclaredBinding`: Origin's column
 *  designations, or one listed in `metadata.error_roles` -- a parser's, or a
 *  user confirmation recorded by lib/errorRoleConfirm.ts) is the fourth kind
 *  of evidence and OUTRANKS every inferred pairing (the precedence
 *  `store/importErrorRoles.ts` applies), so it is applied as it stands.
 *  Every other seeded binding the label rules also produce is graded: a
 *  `low` one moves to `confirm`, a `blocked` one is dropped (a pre-unit-gate
 *  `.dwk` can still carry one). A binding the rules never propose (the user
 *  picked it) passes through, and an explicit `[]` stays none. */
export function reviewSeedErrorBindings(dataset: Pick<Dataset, "data" | "errorRoles">): SeedErrorReview {
  const seed = figureSeedErrorBindings(dataset);
  const { data } = dataset;
  const undeclared = seed.filter((b) => !isDeclaredBinding(data, b));
  if (dataset.errorRoles && undeclared.length === 0) return { apply: seed, confirm: [], blocked: [] };
  const scored = scoreDatasetErrorBindings(data);
  const graded = (b: ErrorBinding) => (undeclared.includes(b) ? scored.find((s) => sameBinding(s, b))?.confidence : undefined);
  return {
    apply: seed.filter((b) => graded(b) !== "low" && graded(b) !== "blocked"),
    confirm: scored.filter((s) => s.confidence === "low" && undeclared.some((b) => sameBinding(b, s))),
    // A declared pairing is applied, so it is not "blocked" even if its units disagree.
    blocked: scored.filter((s) => s.confidence === "blocked" && !seed.some((b) => !undeclared.includes(b) && sameBinding(b, s))),
  };
}
