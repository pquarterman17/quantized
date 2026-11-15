// The one line under the 3-D preview saying what is actually drawn: the counts
// come from the same rule that builds the request (`pointStats`, the same row
// test), so the caption cannot claim more than was sent. Pure.

import type { MapPayload } from "../../lib/mapdataFetch";
import { pointStats, type MapExportView } from "./mapFigureExport";
import { MAP3D_MAX_POINTS, rawSource, WATERFALL_MAX_LINES } from "./map3dRequest";

const n = (v: number): string => v.toLocaleString("en-US");

/** Rows of the payload's grid that draw a waterfall line (2+ drawable cells). */
export function waterfallRowsWithData(p: MapPayload, logZ: boolean): number {
  const ok = (v: number | null): boolean => v !== null && Number.isFinite(v) && (!logZ || v > 0);
  return p.zGrid.filter((row) => row.filter(ok).length >= 2).length;
}

export function view3dCaption(p: MapPayload, view: MapExportView): string {
  const raw = rawSource(p, view);
  if (raw) {
    const s = pointStats(raw, view);
    let t = `Plotting ${n(s.sent)} original points`;
    if (s.sent < s.valid) t += `, evenly sampled from ${n(s.valid)}`;
    if (s.valid < s.total) t += `; ${n(s.total - s.valid)} not drawn (${view.logZ ? "non-finite or non-positive" : "non-finite"})`;
    return `${t}.`;
  }
  const kind = view.view3d?.kind;
  if (kind === "waterfall") {
    const rows = waterfallRowsWithData(p, view.logZ);
    return `Drawing ${n(Math.min(rows, WATERFALL_MAX_LINES))} of ${n(rows)} grid rows with data${rows > WATERFALL_MAX_LINES ? " (evenly stepped)" : ""}.`;
  }
  if (kind === "scatter3d") {
    const cells = p.zGrid.reduce((a, row) => a + row.filter((v) => v !== null && Number.isFinite(v) && (!view.logZ || v > 0)).length, 0);
    if (cells > MAP3D_MAX_POINTS) return `Plotting ${n(MAP3D_MAX_POINTS)} of ${n(cells)} grid cells, evenly sampled.`;
  }
  return p.interpolated ? `Interpolated onto a regular grid from ${n(p.interpolated.nPoints)} points.` : "";
}
