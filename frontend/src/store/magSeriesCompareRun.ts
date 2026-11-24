// The imperative half of the Magnetometry "Compare" tab: resolve the selected
// worksheets, read each series, get the unit plan, and commit ONE worksheet
// through the shared contract. Kept out of components/ (it reads the store
// after every async edge; see the getState ratchet in architecture.test.ts).

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { magneticSeriesComparePlan } from "../lib/api/magnetic";
import { buildCompareWorksheet, readCompareSeries, sharedAxis } from "../lib/magSeriesCompare";
import { commitComputedOutput } from "./commitComputedOutput";
import { useApp } from "./useApp";

const PRODUCER = { id: "mag-compare", label: "Series comparison", version: 1 } as const;

export interface CompareReadout {
  owners: readonly string[];
  key: string;
  summary: string[];
  warning: string | null;
  error: string | null;
}

/** The Library selection with the active worksheet first, or why there is none. */
export function pickCompareIds(activeId: string | null, selectedIds: readonly string[]): { ids: string[]; problem: string | null } {
  if (!activeId) return { ids: [], problem: "Select a dataset first." };
  if (!selectedIds.includes(activeId)) {
    return { ids: [], problem: "Select the worksheets to compare in the Library; the active worksheet must be one of them." };
  }
  const ids = [activeId, ...selectedIds.filter((id) => id !== activeId)];
  return { ids, problem: ids.length < 2 ? "Select at least two worksheets in the Library to compare." : null };
}

export const compareKey = (ids: readonly string[], channel: string): string => JSON.stringify([ids, channel]);

export async function runMagSeriesCompare(ids: readonly string[], channel: string): Promise<CompareReadout> {
  const key = compareKey(ids, channel);
  const fail = (error: string): CompareReadout => ({ owners: ids, key, summary: [], warning: null, error });
  try {
    const resolved = await Promise.all(ids.map((id) => useApp.getState().resolveDataset(id)));
    const state = useApp.getState();
    if (compareKey(pickCompareIds(state.activeId, state.selectedIds).ids, channel) !== key) {
      return fail("The selection changed while the worksheets were loading; compare again.");
    }
    const datasets = resolved.map((ds, i) => {
      if (!ds) throw new Error(`Worksheet ${ids[i]} could not be loaded.`);
      return ds;
    });
    const series = datasets.map((ds) => readCompareSeries(ds, channel));
    const axis = sharedAxis(series);
    const plan = await magneticSeriesComparePlan({
      axis,
      series: series.map((s) => ({ label: s.name, x_unit: s.xUnit, y_unit: s.yUnit })),
    });
    const live = useApp.getState().datasets;
    if (datasets.some((ds) => live.find((d) => d.id === ds.id)?.data !== ds.data)) {
      return fail("A worksheet changed during the comparison; compare again.");
    }
    const built = buildCompareWorksheet(series, plan);
    const outcome = commitComputedOutput({
      producer: PRODUCER,
      sources: datasets.map((ds) => ({ id: ds.id, computedOn: analysisDataFingerprint(ds) })),
      settings: { channel, axis, xUnit: plan.x_unit, yUnit: plan.y_unit, worksheets: ids.join(",") },
      name: `${channel} comparison (${series.length} worksheets)`,
      data: built.data,
      errorRoles: built.errorRoles,
      patch: { columnDesignations: built.columnDesignations },
      status: `created a ${series.length}-series ${axis === "field" ? "M(H)" : "M(T)"} comparison in ${plan.x_unit} / ${plan.y_unit}`,
    });
    if (outcome.kind === "refused") return fail(outcome.reason);
    const warnings: string[] = [];
    const dropped = series.filter((s) => s.rowsDropped > 0);
    if (dropped.length) warnings.push(`Rows without a finite X and ${channel} were left out: ${dropped.map((s) => `${s.name} ${s.rowsDropped}`).join(", ")}.`);
    if (series.some((s) => s.yErrors.length === 0) && series.some((s) => s.yErrors.length > 0)) {
      warnings.push("Only some worksheets have committed uncertainty; the others have none.");
    }
    return {
      owners: [...ids, outcome.outputId], key,
      summary: series.map((s, i) => {
        const f = plan.series[i]!;
        const conv = f.x_factor === 1 && f.y_factor === 1 ? "no conversion" : `X x${f.x_factor.toPrecision(6)}, Y x${f.y_factor.toPrecision(6)}`;
        return `${s.name}: ${s.rowsUsed} rows, ${s.xUnit} / ${s.yUnit} (${conv})`;
      }),
      warning: warnings.length ? warnings.join(" ") : null, error: null,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "comparison failed");
  }
}
