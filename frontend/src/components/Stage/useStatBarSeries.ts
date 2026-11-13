// Bar mode's series (gap #20): which channels become bars, their labels, the
// value-axis label, and each one's PRECOMPUTED error column. Moved out of
// useStatStage.ts (its module-size pin) when figures-audit #8 changed the
// channel rule, so the hook keeps one call here.
//
// Figures-audit #8: a Sample,Value,SD summary table drew THREE bar series --
// Value, the SD column and the Sample column's category codes -- because
// every plotted channel became a series. A bar's series are now the plotted
// channels MINUS the category columns (the group/nest picks, which are the
// x categories themselves) and minus every channel bound as an ERROR column
// (`dataset.errorRoles`), which instead becomes that series' error bar when
// each category holds a single row (the "already summarized" table shape,
// `lib/barMatrix.withColumnErrors`).

import { useMemo } from "react";

import { symmetricBinding } from "../../lib/errorRoles";
import type { Dataset } from "../../lib/types";
import type { StatColumn } from "./useStatStageTypes";

export interface StatBarSeries {
  barValueChannels: readonly number[];
  barLabels: readonly string[];
  barValueLabel: string;
  /** Per bar channel: the channel bound as its symmetric Y error, or null. */
  barErrorChannels: readonly (number | null)[];
}

/** The pure rule, exported for tests. */
export function barSeriesChannels(
  plotted: readonly number[],
  valueCol: number,
  categoryCols: readonly (number | null)[],
  errorRoles: Dataset["errorRoles"],
): number[] {
  const errorChannels = new Set((errorRoles ?? []).map((b) => b.channel));
  const kept = plotted.filter((c) => !categoryCols.includes(c) && !errorChannels.has(c));
  return kept.length ? kept : plotted.length ? [...plotted] : [valueCol];
}

export function useStatBarSeries(
  active: Dataset | null,
  plotted: readonly number[],
  valueCol: number,
  groupCol: number | null,
  nestCol: number | null,
  columns: readonly StatColumn[],
  valueLabel: string,
): StatBarSeries {
  const roles = active?.errorRoles;
  const barValueChannels = useMemo(
    () => barSeriesChannels(plotted, valueCol, [groupCol, nestCol], roles),
    [plotted, valueCol, groupCol, nestCol, roles],
  );
  const barValueLabel = useMemo(() => {
    if (barValueChannels.length > 1) return "value";
    return columns.find((c) => c.index === barValueChannels[0])?.label ?? valueLabel;
  }, [barValueChannels, columns, valueLabel]);
  const barLabels = useMemo(
    () => barValueChannels.map((c) => columns.find((col) => col.index === c)?.label ?? `col ${c}`),
    [barValueChannels, columns],
  );
  const barErrorChannels = useMemo(
    () => barValueChannels.map((c) => symmetricBinding(roles ?? [], c, "y")),
    [barValueChannels, roles],
  );
  return { barValueChannels, barLabels, barValueLabel, barErrorChannels };
}
