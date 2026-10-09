import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import { initialQuickFigureMapping } from "../../../lib/quickFigureMappingActions";
import type { Dataset } from "../../../lib/types";

/** Seed the figure builder from the recorded result series instead of a fresh
 * whole-worksheet guess, which could silently add unrelated curves. */
export function mappingForResult(
  dataset: Dataset,
  recorded: readonly number[],
  recordedX?: number | null,
): QuickFigureMapping {
  const base = initialQuickFigureMapping(dataset);
  const yKeys = [...new Set(recorded)].filter((channel) =>
    Number.isInteger(channel) && channel >= 0 && channel < dataset.data.labels.length,
  );
  const ySet = new Set(yKeys);
  const candidateX = recordedX === undefined ? base.xKey : recordedX;
  const xKey = candidateX !== null && ySet.has(candidateX) ? null : candidateX;
  const xChanged = xKey !== base.xKey;
  const xKeyByY = base.xKeyByY
    ? Object.fromEntries(Object.entries(base.xKeyByY).filter(([channel]) => ySet.has(Number(channel))))
    : undefined;
  const errorBindings = base.errorBindings.filter((binding) =>
    !ySet.has(binding.channel) && (binding.axis === "y" ? ySet.has(binding.target) : !xChanged),
  );
  const reserved = new Set([
    ...(xKey === null ? [] : [xKey]),
    ...Object.values(xKeyByY ?? {}).filter((channel): channel is number => channel !== null),
    ...errorBindings.map((binding) => binding.channel),
    ...(base.groupKey == null || ySet.has(base.groupKey) ? [] : [base.groupKey]),
    ...(base.labelKey == null || ySet.has(base.labelKey) ? [] : [base.labelKey]),
  ]);
  const ignoredKeys = dataset.data.labels
    .map((_, channel) => channel)
    .filter((channel) => !ySet.has(channel) && !reserved.has(channel));
  const mapping: QuickFigureMapping = {
    ...base,
    xKey,
    yKeys,
    errorBindings,
    ignoredKeys,
    ...(base.groupKey != null && ySet.has(base.groupKey) ? { groupKey: null } : {}),
    ...(base.labelKey != null && ySet.has(base.labelKey) ? { labelKey: null } : {}),
  };
  if (xKeyByY && Object.keys(xKeyByY).length) mapping.xKeyByY = xKeyByY;
  else delete mapping.xKeyByY;
  return mapping;
}
