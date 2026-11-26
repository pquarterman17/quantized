// The CDF plot's export request (`routes/export_statplots`, `kind: "cdf"`): the
// columns and labels are the SETTLED draw's own, so the figure is the plot on
// screen (`calc/figure_cdf.py` draws what `statRenderCdf.ts` paints).

import type { StatplotFigureSpec } from "../../lib/api/figures";
import { resolveRug, rugWire, type CdfY, type RugPick } from "../../lib/statCdf";
import type { StatDrawData } from "./statRender";

export interface CdfExportInputs {
  fit: string | null;
  cdfY?: CdfY;
  cdfBand?: boolean;
  rug?: RugPick;
  valueLabel: string;
}

/** Null when there is no settled CDF draw to export. */
export function cdfExportSpec(draw: StatDrawData | null, o: CdfExportInputs, fmt: string): StatplotFigureSpec | null {
  if (!draw || draw.mode !== "cdf") return null;
  const y = o.cdfY ?? "proportion";
  return {
    kind: "cdf",
    data: draw.columns,
    labels: draw.labels,
    fit: o.fit,
    fmt,
    cdf: { y, band: o.cdfBand ?? false },
    x_label: o.valueLabel,
    y_label: y === "count" ? "cumulative count" : "cumulative proportion",
    filename: `cdf_${o.valueLabel}`,
    ...rugWire(resolveRug(o.rug)),
  };
}
