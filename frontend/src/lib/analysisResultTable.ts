import type { Dataset } from "./types";
import { csvTextCell } from "./csvCell";

function numericCell(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? String(value) : "";
}

/** RFC-4180 CSV for a result-owned worksheet. Numeric non-finite cells are
 * blank, matching other table exports; imported labels are formula-neutralized. */
export function analysisResultTableCsv(dataset: Pick<Dataset, "data">): string {
  const { data } = dataset;
  const xLabel = String(data.metadata.xLabel ?? "X");
  const header = [xLabel, ...data.labels].map(csvTextCell).join(",");
  const rows = data.time.map((x, row) => [
    numericCell(x),
    ...data.labels.map((_, column) => numericCell(data.values[row]?.[column])),
  ].join(","));
  return [header, ...rows].join("\r\n");
}
