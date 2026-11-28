// The question "Create subset from region" asks (ROW_RANGE_CONTRACT section 4): which of the plotted source series
// go into the subset, each with the number of the region's rows it holds, and which workbook the subset lands in.
// Ticking every series and keeping the first destination is the default: the subset the menu made before it asked.

import { parseSubsetDestination, type SubsetDestination, type SubsetSeries } from "../../lib/subsetColumns";
import { askParams } from "../overlays/ParamDialog";

export interface SubsetChoices {
  /** The plotted channels that go into the subset (the others are left out). */
  keep: number[];
  destination: SubsetDestination;
}

/** `workbooks`: every workbook a subset may land in other than the source's own (offered first as "beside the source"). */
export async function askSubsetChoices(
  series: readonly SubsetSeries[],
  workbooks: readonly { id: string; name: string }[],
  sourceBook: string | null,
  rows: number,
): Promise<SubsetChoices | null> {
  const optionLabels: Record<string, string> = {
    source: sourceBook ? `Beside the source (workbook “${sourceBook}”)` : "Beside the source",
    new: "A new workbook",
    ...Object.fromEntries(workbooks.map((w) => [`wb:${w.id}`, `Workbook “${w.name}”`])),
  };
  const answer = await askParams(`Create subset from ${rows.toLocaleString()} selected row${rows === 1 ? "" : "s"}`, [
    ...series.map((s) => ({
      key: `s${s.channel}`, label: `${s.label} (${s.rows.toLocaleString()} row${s.rows === 1 ? "" : "s"})`, type: "boolean" as const, default: true,
      ...(s.channel === series[0].channel ? { hint: "Tick the series that go into the subset" } : {}),
    })),
    { key: "where", label: "Put it in", type: "select", default: "source", options: Object.keys(optionLabels), optionLabels },
  ], { confirmLabel: "Create subset" });
  if (!answer) return null;
  return {
    keep: series.filter((s) => answer[`s${s.channel}`] === true).map((s) => s.channel),
    destination: parseSubsetDestination(String(answer.where), workbooks.map((w) => w.id)),
  };
}
