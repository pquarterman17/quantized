import type { BivariateResult, ContingencyResult, FitYByXKind, OnewayResult } from "./runLeg";

type ReportLeg = {
  oneway?: OnewayResult | null;
  bivariate?: BivariateResult | null;
  contingency?: ContingencyResult | null;
};

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function sd(values: number[]): number {
  if (values.length < 2) return NaN;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

/** Convert one landed leg into the report service's record shape. Keeping
 * this pure leaves the workshop hook responsible only for orchestration. */
export function fitYByXLegRecords(
  kind: FitYByXKind,
  leg: ReportLeg,
  level?: string,
): Record<string, unknown>[] {
  const withLevel = (record: Record<string, unknown>) => level == null ? record : { level, ...record };
  if (kind === "oneway" && leg.oneway) return leg.oneway.groups.map((group) => withLevel({
    group: group.label, n: group.values.length, mean: mean(group.values), sd: sd(group.values),
  }));
  if (kind === "bivariate" && leg.bivariate) {
    const result = leg.bivariate.regression;
    const coeffs = (result.coeffs as number[] | undefined) ?? [];
    return [withLevel({
      N: result.N, order: leg.bivariate.order, intercept: coeffs[0], slope: coeffs[1],
      R2: result.R2, fStat: result.fStat, fPvalue: result.fPvalue,
    })];
  }
  if (kind !== "contingency" || !leg.contingency) return [];
  const expected = (leg.contingency.chiSquare.expected as number[][] | undefined) ?? [];
  return leg.contingency.rowLabels.flatMap((row, i) => leg.contingency!.colLabels.map((column, j) => withLevel({
    row, col: column, observed: leg.contingency!.table[i][j], expected: expected[i]?.[j],
  })));
}
