// "Estimate over selected worksheets" for the Background tab (lane BY4): the
// fit per worksheet as a table, without subtracting anything. What a worksheet
// means is in magBackgroundBatchItems.ts.

import { useCallback } from "react";

import { plottedYKey } from "../../../lib/fitselectionActions";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import { MAG_BACKGROUND_BATCH_HEADERS, magBackgroundBatchItem } from "./magBackgroundBatchItems";
import type { MagBgMode } from "./useMagTools";

interface Props {
  active: Dataset | null;
  bgMode: MagBgMode;
  autoFraction: number;
  hiFraction: number;
}

export default function MagBackgroundBatch({ active, bgMode, autoFraction, hiFraction }: Props) {
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const yKey = active ? (plottedYKey(active, xKey, yKeys, seriesOrder) ?? 0) : null;
  const channel = active && yKey !== null ? active.data.labels[yKey] || null : null;
  const blocked = !active ? "Select a dataset first."
    : !channel ? "The selected response has no name, so other worksheets cannot be matched to it."
      : xKey !== null ? "The batch reads each worksheet's own X axis; set the plot X to the worksheet's X axis first (the panel's single run follows the plotted X)." : null;
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!channel) throw new Error("Pick a response first.");
    return magBackgroundBatchItem(dataset, channel, bgMode, autoFraction, hiFraction);
  }, [channel, bgMode, autoFraction, hiFraction]);
  return <StatsBatchSection
    toolId="mag-background" label="Background estimate"
    meaning={`Estimates the background of the column named "${channel ?? "—"}" in each worksheet against its own X axis, and reports the fit; nothing is subtracted and no worksheet is written. Auto-detect reads each worksheet's own axis (an axis it cannot tell is an error row). High-T fraction ${autoFraction}, high-field fraction ${hiFraction}.`}
    rowsNote="Every worksheet row is used, as in the single Background fit (excluded and filtered rows are not left out); selected rows and the plot X range are not used."
    summaryColumns={MAG_BACKGROUND_BATCH_HEADERS} runItem={runItem}
    resultParameters={{
      ...(channel ? { channel } : {}), mode: bgMode,
      ...(bgMode !== "mh" ? { autoFraction } : {}), ...(bgMode !== "mt" ? { hiFraction } : {}),
    }} blockedReason={blocked}
  />;
}
