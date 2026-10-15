import type { AnalysisResult } from "./analysisResult";
import { defaultPlotView } from "./plotview";
import type { StatisticalResultFigureDraft } from "./statisticalResultFigures";
import type { DataStruct } from "./types";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Build the normal editable figure from saved fit values only. No live peak
 * table or backend recomputation is involved. */
export function williamsonHallResultFigure(result: AnalysisResult): StatisticalResultFigureDraft[] {
  if (result.producer.id !== "williamson-hall") return [];
  const table = result.tables?.find((candidate) => candidate.title === "Williamson–Hall fit");
  if (!table || table.columns.join("\0") !== ["4 sin(θ)", "β cos(θ)", "fitted β cos(θ)"].join("\0")) return [];
  const rows = table.rows.filter((row) => finite(row[0]) && finite(row[1]) && finite(row[2]))
    .sort((left, right) => (left[0] as number) - (right[0] as number));
  if (rows.length < 2) return [];
  const data: DataStruct = {
    time: rows.map((row) => row[0] as number),
    values: rows.map((row) => [row[1] as number, row[2] as number]),
    labels: ["Observed β cos(θ)", "Linear fit"], units: ["rad", "rad"],
    metadata: { frozenFromAnalysisResult: true },
  };
  return [{
    key: "williamson-hall-fit", name: result.name,
    description: "Saved transformed peak widths and Williamson–Hall fitted line.",
    data, mark: "line", view: {
      ...defaultPlotView(), plotTitle: result.name, xAxisLabel: "4 sin(θ)",
      yAxisLabel: "β cos(θ) (rad)", xKey: null, yKeys: [0, 1], showLegend: true,
      seriesStyles: {
        0: { width: 0, marker: true, markerSize: 6, explicit: true },
        1: { width: 2, marker: false, explicit: true },
      },
    },
  }];
}
