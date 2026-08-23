// Pure local mapping draft for the Quick Figure Builder (plan PR G2).
// Assignments reference DataStruct channels; they never rewrite worksheet data.
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): this file keeps the
// `QuickFigureMapping` shape + the create-gate predicates
// (`mappingReady`/`canCreateQuickFigure` and their helpers) that
// `lib/quickFigurePreview.ts`/`store/quickFigureCreate.ts`/
// `store/quickPlotTemplates.ts` need EAGERLY. Every mapping-EDIT action
// (build the initial mapping, read/change one column's assignment, clear X
// to the acquisition axis) now lives in `lib/quickFigureMappingActions.ts`,
// reached only from the Quick Figure Builder workshop panel — already
// `lazy()`-gated, never the eager create-gate path. See that file's own
// header for the verified-no-eager-consumer rationale.

import { incompleteAsymmetricPairs, type ErrorBinding, type IncompleteAsymmetricPair } from "./errorRoles";
import type { Dataset } from "./types";

export interface QuickFigureMapping {
  /** null means the DataStruct acquisition axis (`time`). */
  xKey: number | null;
  yKeys: number[];
  errorBindings: ErrorBinding[];
  ignoredKeys: number[];
}

export function mappingReady(mapping: QuickFigureMapping): boolean {
  return mapping.yKeys.length > 0;
}

// ---------------------------------------------------------------------------
// G5 review round (P1, FIX 1): the single create-gate predicate.
//
// Before this, the Create button computed its own inline "can I create"
// logic (role-filtered Y channels + incomplete error pairs) while the store
// action `createQuickFigureFromMapping` (store/quickFigureCreate.ts) gated
// on `mappingReady` alone. The two never had to agree, and they drifted:
// calling the action directly with a lone `+`-only error binding, or with a
// mapping whose only assigned Y channel carries a worksheet Label/Ignore
// role, SUCCEEDED at the store layer and created a figure whose content
// silently vanished at render -- the exact defect this feature exists to
// prevent. `canCreateQuickFigure` is now the ONLY place that decides create
// eligibility; the button and the store action both call it, so they cannot
// drift again.

/** The Y channels this mapping explicitly assigns that also carry a
 *  worksheet-level Label/Ignore role (Inspector's Channels card). Such a
 *  channel is silently dropped by `effectiveChannels` at render time even
 *  though `mappingReady` already sees it as "assigned" -- see
 *  quickFigurePreview.ts's FIX 2 comment for why the filter cannot just be
 *  relaxed instead. Shared by the notice AND the create-gate below. */
export function roleFilteredYKeys(dataset: Dataset, mapping: QuickFigureMapping): number[] {
  return mapping.yKeys.filter((channel) => dataset.channelRoles?.[channel]);
}

/** The display name for the mapping's X axis: the assigned column's label,
 *  or (when X is the acquisition axis) the dataset's own axis metadata,
 *  falling back to a generic label. Used to name the X axis in error-pair
 *  notices without a second, drifting copy of this fallback chain. */
export function axisDisplayName(dataset: Dataset, mapping: QuickFigureMapping): string {
  if (mapping.xKey !== null) return dataset.data.labels[mapping.xKey];
  return String(
    dataset.data.metadata?.["x_column_long"] || dataset.data.metadata?.["x_column_name"] || "Acquisition axis",
  );
}

function describeIncompleteErrorPair(
  dataset: Dataset,
  mapping: QuickFigureMapping,
  pair: IncompleteAsymmetricPair,
): string {
  const targetName = pair.axis === "x"
    ? axisDisplayName(dataset, mapping)
    : (dataset.data.labels[pair.target] ?? `channel ${pair.target}`);
  const present = pair.plus !== null
    ? `+ "${dataset.data.labels[pair.plus]}"`
    : `− "${dataset.data.labels[pair.minus!]}"`;
  const missing = pair.plus === null ? "+" : "−";
  return `${pair.axis.toUpperCase()} error for "${targetName}" has ${present} but is missing ${missing}`;
}

/** Human-readable notice for every asymmetric error slot this mapping has
 *  only half-assigned (a `+` with no `-`, or vice versa) -- rendering
 *  intentionally ignores these (see `errorRoles.ts`'s `asymmetricPair`), so
 *  the mapping UI and the create-gate both need to explain why. */
export function incompleteErrorNotices(dataset: Dataset, mapping: QuickFigureMapping): string[] {
  return incompleteAsymmetricPairs(mapping.errorBindings).map((pair) => describeIncompleteErrorPair(dataset, mapping, pair));
}

export type QuickFigureCreateGate =
  | { ok: true }
  | { ok: false; reason: string; reasonId: string };

/** THE single predicate a mapping must pass to become a figure -- composes
 *  `mappingReady`, "no role-filtered Y channel", and "no incomplete
 *  asymmetric error pair". Both the Create button (for its disabled/title/
 *  aria state) and `createQuickFigureFromMapping` (store/quickFigureCreate.ts,
 *  fail-closed) call this SAME function so they cannot drift apart again.
 *  Priority order (first failing reason wins) matches what the button has
 *  always shown: unready, then role-filtered, then incomplete pairs. */
export function canCreateQuickFigure(dataset: Dataset, mapping: QuickFigureMapping): QuickFigureCreateGate {
  if (!mappingReady(mapping)) {
    return {
      ok: false,
      reason: "Assign at least one Y series to create a figure",
      reasonId: "quick-builder-preview-summary",
    };
  }
  if (roleFilteredYKeys(dataset, mapping).length > 0) {
    return {
      ok: false,
      reason: "Clear the Label/Ignore role from every assigned Y column in the Channels card first",
      reasonId: "quick-builder-role-warning",
    };
  }
  const notices = incompleteErrorNotices(dataset, mapping);
  if (notices.length > 0) {
    return { ok: false, reason: notices[0], reasonId: "quick-builder-error-warning" };
  }
  return { ok: true };
}
