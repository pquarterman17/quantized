// "→ Report" for the curve-measurement gadget kinds: a table of what was
// measured (one row per crossing, or the two reference crossings of a step),
// with the units in the headings and the region, the curve and the SOURCE rows
// (worksheet rows, 1-based) it was measured on in the caption.

import { reportEmit } from "../../lib/api";
import { fmtNum } from "../../lib/format";
import type { GadgetMeasure } from "../../lib/gadgetMeasure";
import type { Dataset } from "../../lib/types";
import { addReportWithProvenance } from "../../store/addReportWithProvenance";

type Measured = Exclude<GadgetMeasure, { mode: "interpolate" }>;

const TITLES = { intersect: "Intersections", levelcrossing: "Level crossings", risetime: "Rise / fall time" } as const;

/** The rows and column order of the report table, with the units in the headings. */
export function reportTable(m: Measured): { records: Record<string, unknown>[]; columns: string[] } {
  const { x, y } = m.units;
  const xc = `x${x ? ` (${x})` : ""}`;
  const yc = `y${y ? ` (${y})` : ""}`;
  if (m.mode === "intersect") {
    return { columns: [xc, yc, "kind", "direction"], records: m.r.intersections.map((p) => ({ [xc]: p.x, [yc]: p.y, kind: p.kind, direction: p.direction ?? "" })) };
  }
  if (m.mode === "levelcrossing") {
    return { columns: [xc, yc, "direction"], records: m.r.crossings.map((c) => ({ [xc]: c.x, [yc]: m.r.level, direction: c.direction })) };
  }
  const t = `${m.r.edge} time${x ? ` (${x})` : ""}`;
  return {
    columns: ["end", xc, yc, t],
    records: [
      { end: `${fmtNum(m.r.low_fraction * 100)} %`, [xc]: m.r.x_low, [yc]: m.r.low_level, [t]: m.r.time },
      { end: `${fmtNum(m.r.high_fraction * 100)} %`, [xc]: m.r.x_high, [yc]: m.r.high_level, [t]: m.r.time },
    ],
  };
}

export async function addMeasureReport(active: Dataset, m: Measured): Promise<void> {
  const { records, columns } = reportTable(m);
  if (records.length === 0) throw new Error("nothing was found to report");
  const { source } = m;
  const lo = Math.min(source.roi[0], source.roi[1]);
  const hi = Math.max(source.roi[0], source.roi[1]);
  const curve = active.data.labels[source.a.yKey] || `Column ${source.a.yKey + 1}`;
  const rows = source.rows ? `, rows ${source.rows.first}–${source.rows.last} (${source.rows.n} used)` : "";
  const level = m.mode === "levelcrossing" ? `, level ${fmtNum(m.r.level)}${m.units.y ? ` ${m.units.y}` : ""}${m.auto ? " (mid-range)" : ""}` : "";
  const title = `${TITLES[m.mode]} — ${active.name}`;
  const { report } = await reportEmit({
    kind: "stats_table",
    records,
    columns,
    title,
    caption: `${curve}, region ${fmtNum(lo)}–${fmtNum(hi)}${m.units.x ? ` ${m.units.x}` : ""}${rows}${level}`,
    source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
  });
  addReportWithProvenance(title, report, active.id);
}
