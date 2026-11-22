// Outlier screening over selected worksheets (lane BY): the panel's method and
// settings screen, in each worksheet, the channel with the panel's channel
// NAME (lib/statsBatchColumns; missing or duplicated is an error row). One
// summary row per worksheet; screening only, nothing is selected or excluded.

import { useCallback, useMemo } from "react";

import { columnByName, columnValues, statsBatchData } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import { OUTLIER_SUMMARY_HEADERS, outlierParameters, screenSummary } from "./outlierRun";
import type { OutlierScreeningState } from "./useOutlierScreening";

export default function OutlierBatchSection({ o }: { o: OutlierScreeningState }) {
  const { col, method, alpha, k, threshold } = o;
  const channel = o.columns.find((c) => c.index === col)?.label ?? null;
  const settings = useMemo(() => ({ method, alpha, k, threshold }), [method, alpha, k, threshold]);
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!channel) throw new Error("Pick a channel to screen first.");
    const data = statsBatchData(dataset);
    return { values: await screenSummary(columnValues(data, columnByName(data, channel)), settings) };
  }, [channel, settings]);
  return (
    <StatsBatchSection
      toolId="outlier-screening"
      label="Outlier screening"
      meaning={`Each worksheet is screened on its column named "${channel ?? "—"}".`}
      summaryColumns={OUTLIER_SUMMARY_HEADERS}
      runItem={runItem}
      resultParameters={{ ...(channel ? { channel } : {}), ...outlierParameters(settings) }}
      blockedReason={channel ? null : "Pick a channel to screen first."}
    />
  );
}
