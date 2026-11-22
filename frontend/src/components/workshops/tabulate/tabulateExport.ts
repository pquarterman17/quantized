// Tabulate "Export → dataset": the pure output builder (group columns + the
// selected stat columns as numeric channels; the grand-total row is a
// preview/TSV/report-only convenience and never part of this export).

import type { StatKey, TabRow } from "../../../lib/tabulate";
import type { DataStruct } from "../../../lib/types";

export function tabulateOutput(
  dataRows: readonly TabRow[],
  groupCols: readonly number[],
  valueCols: readonly number[],
  statKeys: readonly StatKey[],
  groupLabels: readonly string[],
  labelOf: (column: number) => string,
): { name: string; data: DataStruct } {
  const groupChannels = groupCols.map((_, d) => dataRows.map((r) => r.levels[d]));
  const statChannels: number[][] = [];
  const statLabels: string[] = [];
  valueCols.forEach((vc, vi) => {
    statKeys.forEach((k) => {
      statChannels.push(dataRows.map((r) => r.values[vi][k]));
      statLabels.push(`${labelOf(vc)} ${k}`);
    });
  });
  const allChannels = [...groupChannels, ...statChannels];
  return {
    name: `${valueCols.map(labelOf).join(", ")} by ${groupLabels.join(" × ")}`,
    data: {
      time: dataRows.map((_, i) => i),
      values: dataRows.map((_, i) => allChannels.map((ch) => ch[i])),
      labels: [...groupLabels, ...statLabels],
      units: allChannels.map(() => ""),
      metadata: { x_column_name: "row", source: "tabulate" },
    },
  };
}
