// Distribution over selected worksheets (lane BY): the SAME descriptive +
// Shapiro–Wilk pair the single run computes, once per worksheet, on the column
// with the panel's column NAME in each worksheet (lib/statsBatchColumns; a
// worksheet without it, or with two, is an error row). One summary row per
// worksheet in one analysis-batch result. The histogram, fit overlay and
// Compare stay single-worksheet.

import { useCallback } from "react";

import { statsShapiro } from "../../../lib/api";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { columnByName, columnValues, statsBatchData } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import { normalityNote } from "./useDistributionByLevels";

export const DISTRIBUTION_BATCH_HEADERS = ["N", "Mean", "Median", "SD", "Min", "Max", "Shapiro W", "Shapiro p"] as const;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One worksheet's row: throws (an error row) when the column is missing,
 *  ambiguous or has no finite value, or when the descriptive call fails. */
export async function distributionBatchItem(dataset: Dataset, column: string): Promise<AnalysisBatchOutcome> {
  const data = statsBatchData(dataset);
  const values = columnValues(data, columnByName(data, column)).filter((v) => Number.isFinite(v));
  if (values.length === 0) throw new Error(`"${column}" has no finite values in this worksheet.`);
  const [desc, norm] = await Promise.allSettled([statsDescriptive(values), statsShapiro(values)]);
  if (desc.status === "rejected") throw desc.reason instanceof Error ? desc.reason : new Error("descriptive statistics failed");
  const d = desc.value;
  const W = norm.status === "fulfilled" ? num(Number(norm.value.W)) : null;
  const p = norm.status === "fulfilled" ? num(Number(norm.value.p)) : null;
  return {
    values: [values.length, num(d.mean), num(d.median), num(d.std), num(d.min), num(d.max), W, p],
    warnings: p === null ? [`Normality: ${normalityNote(values.length)}.`] : [],
  };
}

export default function DistributionBatchSection({ column }: { column: string | null }) {
  const runItem = useCallback(
    async (dataset: Dataset) => {
      if (!column) throw new Error("Pick a column to profile first.");
      return distributionBatchItem(dataset, column);
    },
    [column],
  );
  return (
    <StatsBatchSection
      toolId="distribution"
      label="Distribution"
      meaning={`Each worksheet is profiled on its column named "${column ?? "—"}".`}
      summaryColumns={DISTRIBUTION_BATCH_HEADERS}
      runItem={runItem}
      resultParameters={column ? { column } : {}}
      blockedReason={column ? null : "Pick a column to profile first."}
    />
  );
}
