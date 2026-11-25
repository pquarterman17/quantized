// The imperative half of the Magnetometry "Isotherms" tab (OPEN_ITEMS row 36):
// resolve the selected worksheets, read one M(H) isotherm from each, get the
// common-unit plan, call the existing Maxwell / Arrott routes and commit ONE
// worksheet through the shared contract. In store/ because it reads the store
// after every async edge; the pure rules are in lib/magIsotherms.ts.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { magneticArrott, magneticEntropyChange, magneticSeriesComparePlan } from "../lib/api/magnetic";
import {
  arrottLines, arrottWorksheet, commonMaxField, entropyLines, entropyWorksheet, isothermBody, isothermUnitProblem, readIsotherm, temperatureProblem, uncertaintyStatus,
} from "../lib/magIsotherms";
import type { CompareSeries } from "../lib/magSeriesCompare";
import type { Dataset } from "../lib/types";
import { pickCompareIds } from "./magSeriesCompareRun";
import { commitComputedOutput } from "./commitComputedOutput";
import { useApp } from "./useApp";

export const ENTROPY_PRODUCER = { id: "mag-isotherm-entropy", label: "Magnetic entropy change", version: 1 } as const;
export const ARROTT_PRODUCER = { id: "mag-isotherm-arrott", label: "Arrott plot", version: 1 } as const;

export type IsothermView = "entropy" | "arrott";

export interface IsothermParams {
  view: IsothermView;
  /** One temperature (K) per selected worksheet, in selection order (null = blank). */
  temps: readonly (number | null)[];
  maxFields: readonly number[];
  window: readonly [number, number];
  beta: number;
  gamma: number;
}

export interface IsothermReadout {
  owners: readonly string[];
  key: string;
  lines: string[];
  warning: string | null;
  error: string | null;
}

/** Everything a stale readout must notice: the selection, response, view and every setting. */
export const isothermKey = (ids: readonly string[], channel: string, inputs: string, p: IsothermParams): string =>
  JSON.stringify([ids, channel, inputs, p.view, p.temps, p.view === "entropy" ? p.maxFields : [p.window, p.beta, p.gamma]]);

export async function runIsotherms(ids: readonly string[], channel: string, inputs: (datasets: readonly Dataset[]) => string, p: IsothermParams): Promise<IsothermReadout> {
  const key = isothermKey(ids, channel, inputs(useApp.getState().datasets), p);
  const fail = (error: string): IsothermReadout => ({ owners: ids, key, lines: [], warning: null, error });
  try {
    const resolved = await Promise.all(ids.map((id) => useApp.getState().resolveDataset(id)));
    const state = useApp.getState();
    if (pickCompareIds(state.activeId, state.selectedIds).ids.join("|") !== ids.join("|") || isothermKey(ids, channel, inputs(useApp.getState().datasets), p) !== key) {
      return fail("The selection or worksheets changed while they were loading; run it again.");
    }
    const datasets = resolved.map((ds, i) => {
      if (!ds) throw new Error(`Worksheet ${ids[i]} could not be loaded.`);
      return ds;
    });
    const reads = datasets.map((ds) => readIsotherm(ds, channel));
    const series = reads.map((r) => r.series);
    const tempProblem = temperatureProblem(series.map((s) => s.name), p.temps);
    if (tempProblem) return fail(tempProblem);
    const plan = await magneticSeriesComparePlan({
      axis: "field", series: series.map((s) => ({ label: s.name, x_unit: s.xUnit, y_unit: s.yUnit })),
    });
    const unitProblem = isothermUnitProblem(plan.x_unit, plan.y_unit);
    if (unitProblem) return fail(unitProblem);
    const live = useApp.getState().datasets;
    if (datasets.some((ds) => live.find((d) => d.id === ds.id)?.data !== ds.data)) {
      return fail("A worksheet changed during the calculation; run it again.");
    }
    const status = uncertaintyStatus(series);
    const isotherms = isothermBody(series, p.temps as number[], plan.series, status.usable);
    const common = { field_unit: plan.x_unit, magnetization_unit: plan.y_unit };
    const meta = {
      source_worksheets: series.map((s, i) => ({ dataset_id: s.datasetId, name: s.name, temperature: p.temps[i], rows_used: s.rowsUsed })),
      channel, field_unit: plan.x_unit, magnetization_unit: plan.y_unit, temperature_source: "entered per worksheet (pre-filled from a steady K temperature column)",
    };
    const sources = datasets.map((ds) => ({ id: ds.id, computedOn: analysisDataFingerprint(ds) }));
    const baseSettings = { channel, worksheets: ids.join(","), temperatures: p.temps.join(","), fieldUnit: plan.x_unit, magnetizationUnit: plan.y_unit, uncertainty: status.usable };
    let lines: string[];
    let sheet;
    let outcome;
    if (p.view === "entropy") {
      const res = await magneticEntropyChange({ isotherms, ...common, max_fields: [...p.maxFields] });
      if (isothermKey(ids, channel, inputs(useApp.getState().datasets), p) !== key) return fail("The inputs changed during the calculation; run it again.");
      sheet = entropyWorksheet(res, { ...meta, max_fields: [...p.maxFields] });
      lines = entropyLines(res);
      outcome = commitComputedOutput({
        producer: ENTROPY_PRODUCER, sources, settings: { ...baseSettings, maxFields: p.maxFields.join(",") },
        name: `${channel} ΔS_M (${series.length} isotherms)`, data: sheet.data, errorRoles: sheet.errorRoles,
        patch: { columnDesignations: sheet.columnDesignations },
        status: `created ΔS_M(T) from ${series.length} isotherms in ${res.unit}`,
      });
    } else {
      const res = await magneticArrott({ isotherms, ...common, window: [p.window[0], p.window[1]], beta: p.beta, gamma: p.gamma });
      if (isothermKey(ids, channel, inputs(useApp.getState().datasets), p) !== key) return fail("The inputs changed during the calculation; run it again.");
      sheet = arrottWorksheet(res, { ...meta, window: [...p.window] });
      lines = arrottLines(res);
      outcome = commitComputedOutput({
        producer: ARROTT_PRODUCER, sources, settings: { ...baseSettings, window: p.window.join(","), beta: p.beta, gamma: p.gamma },
        name: `${channel} Arrott (${series.length} isotherms)`, data: sheet.data,
        patch: { columnDesignations: sheet.columnDesignations },
        status: `created Arrott plot from ${series.length} isotherms`,
      });
    }
    if (outcome.kind === "refused") return fail(outcome.reason);
    const dropped = series.filter((s) => s.rowsDropped > 0);
    const warning = dropped.length ? `Rows without a finite field and ${channel} were left out: ${dropped.map((s) => `${s.name} ${s.rowsDropped}`).join(", ")}.` : null;
    return { owners: [...ids, outcome.outputId], key, lines, warning, error: null };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "isotherm analysis failed");
  }
}

/** Per-worksheet temperature pre-fill, the common field unit (the first worksheet's) and a default maximum field
 *  (provisional, owner to confirm: the largest field every isotherm reaches, only when all share one field unit), read from the store. */
export async function readIsothermHints(ids: readonly string[], channel: string): Promise<{ suggested: Record<string, number | null>; fieldUnit: string; maxField: number | null }> {
  const suggested: Record<string, number | null> = {};
  const reads: CompareSeries[] = [];
  let fieldUnit = "";
  for (const id of ids) {
    try {
      const ds = await useApp.getState().resolveDataset(id);
      const read = ds && channel ? readIsotherm(ds, channel) : null;
      suggested[id] = read?.suggestedT ?? null;
      if (read) reads.push(read.series);
      if (read && !fieldUnit) fieldUnit = read.series.xUnit;
    } catch {
      suggested[id] = null;
    }
  }
  const sameUnit = reads.length === ids.length && reads.length > 0 && reads.every((r) => r.xUnit === reads[0]!.xUnit);
  return { suggested, fieldUnit, maxField: sameUnit ? commonMaxField(reads, reads.map(() => ({ x_factor: 1 }))) : null };
}
