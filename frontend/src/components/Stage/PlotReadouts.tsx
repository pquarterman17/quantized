// The floating readout chips for the interactive plot tools: cursor value list,
// region/measure hints, and the region-stats summary panel. Pure presentational
// (the live values are owned by PlotStage); extracted to keep PlotStage lean.

import { formatMeasurement, type Measurement } from "../../lib/measure";
import type { RegionStats } from "../../lib/regionStats";
import type { PlotTool } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotPlugins";

/** Compact number format for the stats panel; non-finite (e.g. std with n<2) → —. */
const fmtStat = (v: number): string => (Number.isFinite(v) ? v.toPrecision(4) : "—");

interface Props {
  tool: PlotTool;
  readout: Readout | null;
  measurement: Measurement | null;
  stats: RegionStats | null;
}

export default function PlotReadouts({ tool, readout, measurement, stats }: Props) {
  if (tool === "cursor") {
    if (!readout) return null;
    return (
      <div className="qzk-glass qzk-readout">
        <div style={{ color: "var(--text-dim)" }}>x = {readout.x.toPrecision(5)}</div>
        {readout.rows.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            style={{ display: "flex", gap: 6, justifyContent: "space-between" }}
          >
            <span>{r.label || "y"}</span>
            <span>{r.y.toPrecision(5)}</span>
          </div>
        ))}
      </div>
    );
  }

  if (tool === "region") {
    return <div className="qzk-glass qzk-readout">Drag to select a background range</div>;
  }

  if (tool === "measure") {
    return (
      <div className="qzk-glass qzk-readout">
        {measurement ? formatMeasurement(measurement) : "Drag between two points to measure"}
      </div>
    );
  }

  if (tool === "stats") {
    return (
      <div className="qzk-glass qzk-readout" style={{ maxHeight: 240, overflowY: "auto" }}>
        {stats ? (
          <>
            <div style={{ color: "var(--text-dim)" }}>
              x ∈ [{fmtStat(stats.xMin)}, {fmtStat(stats.xMax)}]
            </div>
            {stats.series.map((st, i) => (
              <div key={`${st.label}-${i}`} style={{ marginTop: 4 }}>
                <div style={{ color: "var(--text)" }}>
                  {st.label || "y"} · n={st.n}
                </div>
                <div style={{ display: "flex", gap: 8, color: "var(--text-dim)" }}>
                  <span>μ {fmtStat(st.mean)}</span>
                  <span>σ {fmtStat(st.std)}</span>
                  <span>med {fmtStat(st.median)}</span>
                </div>
                <div style={{ display: "flex", gap: 8, color: "var(--text-faint)" }}>
                  <span>min {fmtStat(st.min)}</span>
                  <span>max {fmtStat(st.max)}</span>
                </div>
              </div>
            ))}
          </>
        ) : (
          "Drag a range to summarize"
        )}
      </div>
    );
  }

  return null;
}
