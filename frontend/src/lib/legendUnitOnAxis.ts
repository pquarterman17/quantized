// UX8-C: a display-only legend option for a graph whose curves all share one
// unit (`metadata.legend_unit_on_axis`, set by lib/linkedCurves.ts's
// assembly). The legend then names each curve without the unit ("MH_010K",
// not "MH_010K (emu)" ten times), because the Y title already carries it.
// Neither the data (each column keeps its unit) nor the general
// "label (unit)" rule changes: this only fills `PlotSeriesSpec.legend`, which
// the on-screen legends (PlotLegend, BackgroundLegend) read first. A legend
// rename (`view.seriesLabels`) still wins over it. The publication export
// does NOT read it -- an exported figure keeps "MH_010K (emu)".
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

/** `payload` with each data curve's legend set to its bare label when `data`
 *  carries the flag; companions and overlays are left alone. */
export function legendUnitOnAxis(payload: PlotPayload, data: DataStruct | undefined): PlotPayload {
  if (data?.metadata?.legend_unit_on_axis !== true) return payload;
  const series = payload.series.map((s) =>
    s.legend !== undefined || s.muted || s.selected || s.band || s.overlay ? s : { ...s, legend: s.label },
  );
  return { ...payload, series };
}
