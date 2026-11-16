// UX8-C: a display-only legend option for a graph whose curves all share one
// unit (`metadata.legend_unit_on_axis`, set by lib/linkedCurves.ts's
// assembly). The legend then names each curve without the unit ("MH_010K",
// not "MH_010K (emu)" ten times), because the Y title already carries it.
// Neither the data (each column keeps its unit) nor the general
// "label (unit)" rule changes: this only fills `PlotSeriesSpec.legend`, which
// the on-screen legends (PlotLegend, BackgroundLegend) read first. A legend
// rename (`view.seriesLabels`) still wins over it. The flat publication
// export honours the same flag server-side (the wire dataset carries the
// metadata): `routes/export_figures_labels.legend_unit_on_axis`, with the
// cases shared in tests/fixtures/wire/legend_unit_on_axis.json.
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

type Series = PlotPayload["series"][number];
const isCompanion = (s: Series): boolean => !!(s.muted || s.selected || s.band || s.overlay);

/** `payload` with each data curve's legend set to its bare label when `data`
 *  carries the flag AND every data curve really shares one non-empty unit --
 *  the flag can outlive the curves it was set for (a duplicated graph keeps
 *  the metadata, then gains a "dM/dH (emu/Oe)" column), so it is re-checked
 *  on what is drawn. Companions and overlays are left alone. The caller
 *  passes no `data` for a grouped or encoded payload, whose export branches
 *  do not read the flag either. */
export function legendUnitOnAxis(payload: PlotPayload, data: DataStruct | undefined): PlotPayload {
  if (data?.metadata?.legend_unit_on_axis !== true) return payload;
  const units = new Set(payload.series.filter((s) => !isCompanion(s)).map((s) => s.unit));
  const [unit] = units;
  if (units.size !== 1 || !unit) return payload;
  const series = payload.series.map((s) => (s.legend !== undefined || isCompanion(s) ? s : { ...s, legend: s.label }));
  return { ...payload, series };
}
