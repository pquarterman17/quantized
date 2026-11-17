import { Button } from "../../primitives";
import { batchParamColumns } from "./curveFitBatchPlot";

interface Props {
  columns: readonly string[];
  /** Build (or reuse) the run's summary worksheet, then plot this column of it. */
  onPlot: (column: number) => void;
}

/** One chip per fitted parameter, after a batch: the one-click path to "τ vs T". */
export default function CurveFitBatchPlotChips({ columns, onPlot }: Props) {
  const params = batchParamColumns(columns);
  if (!params.length) return null;
  return (
    <div className="qz-cf-plotchips" role="group" aria-label="Plot a fitted parameter against the summary X"
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Plot ▸</span>
      {params.map((p) => (
        <Button key={p.column} size="sm" onClick={() => onPlot(p.column)}
          title={`Open the summary with ${p.name} on Y and R² on the right axis, against the Summary X above`}>
          {p.name}
        </Button>
      ))}
    </div>
  );
}
