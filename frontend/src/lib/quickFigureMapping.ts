// Pure local mapping draft for the Quick Figure Builder (plan PR G2).
// Assignments reference DataStruct channels; they never rewrite worksheet data.

import {
  incompleteAsymmetricPairs,
  inferErrorBindings,
  type ErrorBinding,
  type ErrorSide,
  type IncompleteAsymmetricPair,
} from "./errorRoles";
import { originHiddenChannels } from "./errorbars";
import type { Dataset } from "./types";

export interface QuickFigureMapping {
  /** null means the DataStruct acquisition axis (`time`). */
  xKey: number | null;
  yKeys: number[];
  errorBindings: ErrorBinding[];
  ignoredKeys: number[];
}

export type QuickColumnAssignment =
  | { role: "unassigned" }
  | { role: "x" }
  | { role: "y" }
  | { role: "ignore" }
  | { role: "error"; target: number; axis: "x" | "y"; side: ErrorSide };

const uniqueSorted = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

export function initialQuickFigureMapping(dataset: Dataset): QuickFigureMapping {
  const inferred = dataset.errorRoles ?? inferErrorBindings(dataset.data);
  const errorChannels = new Set(inferred.map((binding) => binding.channel));
  const hidden = new Set(originHiddenChannels(dataset.data));
  const ignored = new Set(
    Object.entries(dataset.channelRoles ?? {})
      .filter(([, role]) => role === "ignore" || role === "label")
      .map(([channel]) => Number(channel)),
  );
  const yKeys = dataset.data.labels
    .map((_, channel) => channel)
    .filter((channel) => !errorChannels.has(channel) && !hidden.has(channel) && !ignored.has(channel));
  return {
    xKey: null,
    yKeys,
    errorBindings: inferred,
    ignoredKeys: uniqueSorted([...ignored, ...hidden].filter((channel) => !errorChannels.has(channel))),
  };
}

export function assignmentFor(mapping: QuickFigureMapping, channel: number): QuickColumnAssignment {
  if (mapping.xKey === channel) return { role: "x" };
  if (mapping.yKeys.includes(channel)) return { role: "y" };
  const binding = mapping.errorBindings.find((candidate) => candidate.channel === channel);
  if (binding) return { role: "error", target: binding.target, axis: binding.axis, side: binding.side };
  if (mapping.ignoredKeys.includes(channel)) return { role: "ignore" };
  return { role: "unassigned" };
}

/** X-error bindings carry `target: -1` (the axis sentinel, not a real
 * channel index) -- they are paired with WHICHEVER column is currently X,
 * not with a specific target channel. So whenever X itself changes identity
 * (reassigned to a different column, cleared to the acquisition axis, or the
 * old X channel is given a different role), every `axis: "x"` binding is
 * stale and must be dropped rather than silently kept pointed at the old X.
 * Keeping one would render a "confidently wrong" error bar for data it was
 * never paired with (see lib/errorRoles.ts's module docstring). */
function dropXErrorBindings(bindings: readonly ErrorBinding[]): ErrorBinding[] {
  return bindings.filter((binding) => binding.axis !== "x");
}

/** Drop any existing binding from a DIFFERENT channel targeting the same
 * (target, axis, side) -- two source columns must never both claim the same
 * error slot. The render helpers (errorbars.ts's symmetricBinding/
 * asymmetricPair) use `.find()` and would otherwise silently draw only the
 * first match, dropping the user's later choice. `side` is part of the key
 * so a `+` and a `-` half for the same target coexist; two `+`es do not. */
function dropConflictingErrorBinding(
  bindings: readonly ErrorBinding[],
  channel: number,
  target: number,
  axis: "x" | "y",
  side: ErrorSide,
): ErrorBinding[] {
  return bindings.filter(
    (binding) =>
      binding.channel === channel ||
      !(binding.target === target && binding.axis === axis && binding.side === side),
  );
}

/** Assign one values channel. Reassigning removes every incompatible old role;
 * changing X leaves the old X unassigned rather than silently making it Y. */
export function assignQuickFigureColumn(
  mapping: QuickFigureMapping,
  channel: number,
  assignment: QuickColumnAssignment,
): QuickFigureMapping {
  const base: QuickFigureMapping = {
    xKey: mapping.xKey === channel ? null : mapping.xKey,
    yKeys: mapping.yKeys.filter((candidate) => candidate !== channel),
    errorBindings: mapping.errorBindings.filter(
      (binding) => binding.channel !== channel && binding.target !== channel,
    ),
    ignoredKeys: mapping.ignoredKeys.filter((candidate) => candidate !== channel),
  };
  const result = ((): QuickFigureMapping => {
    switch (assignment.role) {
      case "unassigned": return base;
      case "x": return { ...base, xKey: channel };
      case "y": return { ...base, yKeys: uniqueSorted([...base.yKeys, channel]) };
      case "ignore": return { ...base, ignoredKeys: uniqueSorted([...base.ignoredKeys, channel]) };
      case "error":
        return {
          ...base,
          errorBindings: [
            ...dropConflictingErrorBinding(base.errorBindings, channel, assignment.target, assignment.axis, assignment.side),
            { channel, target: assignment.target, axis: assignment.axis, side: assignment.side },
          ],
        };
    }
  })();
  // X changed identity (reassigned, or the old X left the role above) --
  // every x-error binding referenced the OLD X and is now stale.
  if (result.xKey !== mapping.xKey) {
    return { ...result, errorBindings: dropXErrorBindings(result.errorBindings) };
  }
  return result;
}

export function useAcquisitionAxis(mapping: QuickFigureMapping): QuickFigureMapping {
  if (mapping.xKey === null) return mapping;
  return { ...mapping, xKey: null, errorBindings: dropXErrorBindings(mapping.errorBindings) };
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
