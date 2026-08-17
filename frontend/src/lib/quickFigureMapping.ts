// Pure local mapping draft for the Quick Figure Builder (plan PR G2).
// Assignments reference DataStruct channels; they never rewrite worksheet data.

import { inferErrorBindings, type ErrorBinding, type ErrorSide } from "./errorRoles";
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
