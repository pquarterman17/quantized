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
  switch (assignment.role) {
    case "unassigned": return base;
    case "x": return { ...base, xKey: channel };
    case "y": return { ...base, yKeys: uniqueSorted([...base.yKeys, channel]) };
    case "ignore": return { ...base, ignoredKeys: uniqueSorted([...base.ignoredKeys, channel]) };
    case "error":
      return {
        ...base,
        errorBindings: [
          ...base.errorBindings,
          { channel, target: assignment.target, axis: assignment.axis, side: assignment.side },
        ],
      };
  }
}

export function useAcquisitionAxis(mapping: QuickFigureMapping): QuickFigureMapping {
  return { ...mapping, xKey: null };
}

export function mappingReady(mapping: QuickFigureMapping): boolean {
  return mapping.yKeys.length > 0;
}
