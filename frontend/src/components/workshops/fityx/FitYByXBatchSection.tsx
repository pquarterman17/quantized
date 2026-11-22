// Fit Y by X over selected worksheets (lane BY): the SAME leg dispatch
// (./runLeg) once per worksheet, on the columns with the panel's X and Y NAMES
// in that worksheet (lib/statsBatchColumns). The batch runs ONE leg, the
// panel's: a worksheet whose columns dispatch to a different leg (a factor
// that reads as continuous there, say) is an error row, never re-dispatched,
// so every row of the table answers the same question.

import { useCallback } from "react";

import { columnByName, statsBatchData } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import { fitYByXKind, runLeg, type FitYByXKind, type LegResult } from "./runLeg";

type BatchKind = Exclude<FitYByXKind, "unsupported">;

export const FIT_Y_BY_X_BATCH_HEADERS: Readonly<Record<BatchKind, readonly string[]>> = {
  bivariate: ["N", "b0 (intercept)", "b1", "R²", "F", "p"],
  oneway: ["Groups", "N", "F", "p"],
  contingency: ["Rows × columns", "N", "χ²", "p", "Fisher p"],
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function summaryOf(kind: BatchKind, leg: LegResult): (string | number | null)[] {
  if (kind === "bivariate" && leg.bivariate) {
    const r = leg.bivariate.regression;
    const coeffs = (r.coeffs as number[] | undefined) ?? [];
    return [num(r.N), num(coeffs[0]), num(coeffs[1]), num(r.R2), num(r.fStat), num(r.fPvalue)];
  }
  if (kind === "oneway" && leg.oneway) {
    const { groups, anova } = leg.oneway;
    return [groups.length, groups.reduce((n, g) => n + g.values.length, 0), num(anova.fStat), num(anova.pValue)];
  }
  if (kind === "contingency" && leg.contingency) {
    const c = leg.contingency;
    const n = c.table.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
    return [`${c.rowLabels.length} × ${c.colLabels.length}`, n, num(c.chiSquare.chi2), num(c.chiSquare.p_value), num(c.fisher?.p_value)];
  }
  throw new Error("The analysis returned no result.");
}

export interface FitYByXBatchSettings {
  xName: string;
  yName: string;
  kind: FitYByXKind;
  order: number;
}

/** One worksheet's row; throws (an error row) on a missing / ambiguous
 *  column, a different leg, or too little data. */
export async function fitYByXBatchItem(dataset: Dataset, s: FitYByXBatchSettings): Promise<AnalysisBatchOutcome> {
  if (s.kind === "unsupported") throw new Error("This X / Y combination is not supported.");
  const data = statsBatchData(dataset);
  const x = columnByName(data, s.xName);
  const y = columnByName(data, s.yName);
  const kind = fitYByXKind(dataset, x, y);
  if (kind !== s.kind) {
    throw new Error(`Here "${s.yName}" by "${s.xName}" is a ${kind} analysis, not ${s.kind}; set the column types to match.`);
  }
  // Bands are not summarised, so the band interval does not matter here.
  const leg = await runLeg(data, kind, x, y, s.order);
  const failed = leg.oneway?.failed ?? leg.contingency?.failed;
  return {
    values: summaryOf(kind, leg),
    warnings: failed ? Object.entries(failed).map(([test, reason]) => `${test} failed: ${reason}`) : [],
  };
}

export default function FitYByXBatchSection({ xLabel, yLabel, kind, order }: { xLabel: string; yLabel: string; kind: FitYByXKind; order: number }) {
  const runItem = useCallback(
    (dataset: Dataset) => fitYByXBatchItem(dataset, { xName: xLabel, yName: yLabel, kind, order }),
    [xLabel, yLabel, kind, order],
  );
  return (
    <StatsBatchSection
      toolId="fit-y-by-x"
      label="Fit Y by X"
      meaning={`Each worksheet runs the ${kind} analysis of its column "${yLabel}" by its column "${xLabel}".`}
      summaryColumns={kind === "unsupported" ? [] : FIT_Y_BY_X_BATCH_HEADERS[kind]}
      runItem={runItem}
      resultParameters={{ x: xLabel, y: yLabel, kind, ...(kind === "bivariate" ? { order } : {}) }}
      blockedReason={kind === "unsupported" ? "Categorical Y against a continuous X is not supported, so there is nothing to batch." : null}
    />
  );
}
