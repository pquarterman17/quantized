// "Batch over selected worksheets" for the Curie-Weiss fit (lane BY3); what a
// worksheet means is in curieWeissBatch.ts.

import { useCallback } from "react";

import type { Dataset } from "../../../lib/types";
import StatsBatchSection from "../analysisselection/StatsBatchSection";
import { CURIE_WEISS_BATCH_HEADERS, curieWeissBatchBlockReason, curieWeissBatchItem } from "./curieWeissBatchItems";
import type { CurieWeissBasisChoice } from "./curieWeissData";

interface Props {
  active: Dataset | null;
  yKey: number;
  plotXKey: number | null;
  basisChoice: CurieWeissBasisChoice;
  fitMin: number;
  fitMax: number;
}

export default function CurieWeissBatch({ active, yKey, plotXKey, basisChoice, fitMin, fitMax }: Props) {
  const channel = active?.data.labels[yKey] || null;
  const blocked = !active ? "Select a dataset first."
    : !channel ? "The selected response has no name, so other worksheets cannot be matched to it."
      : plotXKey !== null ? "The batch reads each worksheet's own temperature axis; set the plot X to the worksheet's X axis first."
        : curieWeissBatchBlockReason(basisChoice, active.data.units[yKey] ?? "")
          ?? (Number.isFinite(fitMin) && Number.isFinite(fitMax) && fitMin < fitMax ? null : "Enter a finite fit range with minimum < maximum.");
  const runItem = useCallback(async (dataset: Dataset) => {
    if (!channel) throw new Error("Pick a response first.");
    return curieWeissBatchItem(dataset, channel, basisChoice, fitMin, fitMax);
  }, [channel, basisChoice, fitMin, fitMax]);
  return <StatsBatchSection
    toolId="curie-weiss" label="Curie–Weiss"
    meaning={`Each worksheet's own X axis (temperature, in K) is fitted against its molar susceptibility column named "${channel ?? "—"}", over ${fitMin}–${fitMax} K. Raw-moment worksheets are not batched (their sample mass belongs to one sample). The inverse-susceptibility worksheet is not created.`}
    summaryColumns={CURIE_WEISS_BATCH_HEADERS} runItem={runItem}
    resultParameters={{ ...(channel ? { channel } : {}), basisChoice, fitMin, fitMax }} blockedReason={blocked}
  />;
}
