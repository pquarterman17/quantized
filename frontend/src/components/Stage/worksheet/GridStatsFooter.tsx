// Sticky per-column statistics footer for the worksheet grid (WORKSHEET_PLAN
// item 2), opt-in via the Stats toggle. Stats are fetched by the worksheet
// view hook over `analysisRows` (filter + mask pruned, independent of the
// windowed/visible range) — this component only renders the fetched values,
// stacked as one sticky block pinned to the bottom of the grid's scroll
// region. "ignore"-role columns blank their stats (out of analysis), matching
// the old WorksheetTable behaviour.

import type { CalcResult, ChannelRole } from "../../../lib/types";
import { fmtNum } from "../../../lib/format";

// The descriptive-stats keys surfaced in the footer (matches StatsCard's set).
const STAT_ROWS: [string, string][] = [
  ["Mean", "mean"],
  ["Std", "std"],
  ["Min", "min"],
  ["Max", "max"],
  ["Median", "median"],
  ["N", "N"],
];

export interface GridStatsFooterProps {
  channelRoles: Record<number, ChannelRole>;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  gutterWidth: number;
  rowHeight: number;
}

export default function GridStatsFooter({
  channelRoles,
  colStats,
  statsErr,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  gutterWidth,
  rowHeight,
}: GridStatsFooterProps) {
  if (statsErr) {
    return (
      <div className="qzk-grid-footer" style={{ position: "sticky", bottom: 0, zIndex: 3 }}>
        <div role="row" className="qzk-grid-row" style={{ height: rowHeight }}>
          <div
            role="rowheader"
            className="qzk-grid-cell qzk-grid-headcell qzk-grid-rownum"
            style={{ position: "sticky", left: 0, width: gutterWidth, flexShrink: 0 }}
          />
          <div role="gridcell" className="qzk-grid-cell qzk-ds-meta" style={{ flex: 1, textAlign: "left" }}>
            statistics unavailable offline
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="qzk-grid-footer" style={{ position: "sticky", bottom: 0, zIndex: 3 }}>
      {STAT_ROWS.map(([label, key]) => (
        <div role="row" key={key} className="qzk-grid-row" style={{ height: rowHeight }}>
          <div
            role="rowheader"
            className="qzk-grid-cell qzk-grid-headcell qzk-grid-rownum"
            title="column statistic"
            style={{ position: "sticky", left: 0, zIndex: 3, width: gutterWidth, flexShrink: 0 }}
          >
            {label}
          </div>
          <div
            role="gridcell"
            className="qzk-grid-cell"
            style={{ position: "sticky", left: gutterWidth, zIndex: 3, background: "var(--surface-2)", width: colWidth, flexShrink: 0 }}
          >
            {colStats ? fmtNum(colStats[0]?.[key]) : "…"}
          </div>
          {leadingSpacer > 0 && <div style={{ width: leadingSpacer, flexShrink: 0 }} aria-hidden="true" />}
          {visibleCols.map((c) => (
            <div key={c} role="gridcell" className="qzk-grid-cell" style={{ width: colWidth, flexShrink: 0 }}>
              {channelRoles[c] === "ignore" ? "—" : colStats ? fmtNum(colStats[c + 1]?.[key]) : "…"}
            </div>
          ))}
          {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
