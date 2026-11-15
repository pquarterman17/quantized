// Sticky per-column statistics footer for the worksheet grid (WORKSHEET_PLAN
// item 2), opt-in via the Stats toggle. Stats are fetched by the worksheet
// view hook over `analysisRows` (filter + mask pruned, independent of the
// windowed/visible range) — this component only renders the fetched values,
// stacked as one sticky block pinned to the bottom of the grid's scroll
// region. "ignore"-role columns blank their stats (out of analysis), matching
// the old WorksheetTable behaviour. Text columns (item 8) always blank ("—")
// — read-only, never in stats — positioned by file order like GridHeader/
// GridRow (worksheet audit follow-up, `textLayout`).

import { Fragment } from "react";

import type { TextColumn } from "../../../lib/originTextColumns";
import type { CalcResult, ChannelRole } from "../../../lib/types";
import { fmtNum } from "../../../lib/format";
import type { TextColumnLayout } from "./textColumns";

// The descriptive-stats keys surfaced in the footer (StatsCard's set, plus
// Origin's sum / SE of mean / variance / range / missing — worksheet audit
// #19; `sum` and `missing` come from useWorksheetStats, the rest from the
// route).
// Each row is [short label, stat key, full name]. The short label has to fit
// the 44 px row-number gutter (it was cut to "Me…", "Va…", "SE me…"); the
// full name is the row header's tooltip and accessible name.
export const STAT_ROWS: [string, string, string][] = [
  ["Mean", "mean", "Mean"],
  ["Std", "std", "Standard deviation"],
  ["SEM", "sem", "Standard error of the mean"],
  ["Var", "var", "Variance"],
  ["Min", "min", "Minimum"],
  ["Max", "max", "Maximum"],
  ["Range", "range", "Range (max - min)"],
  ["Median", "median", "Median"],
  ["Sum", "sum", "Sum"],
  ["N", "N", "N"],
  ["Missing", "missing", "Missing (blank or non-numeric cells)"],
];

export interface GridStatsFooterProps {
  channelRoles: Record<number, ChannelRole>;
  colStats: (CalcResult | null)[] | null;
  statsErr: boolean;
  visibleCols: number[];
  leadingSpacer: number;
  trailingSpacer: number;
  colWidth: number;
  /** Per-column width (MAIN_PLAN #3); -1 = the pinned x column. Text columns
   *  keep the uniform `colWidth`. */
  widthOf: (col: number) => number;
  gutterWidth: number;
  rowHeight: number;
  textLayout: TextColumnLayout;
}

export default function GridStatsFooter({
  channelRoles,
  colStats,
  statsErr,
  visibleCols,
  leadingSpacer,
  trailingSpacer,
  colWidth,
  widthOf,
  gutterWidth,
  rowHeight,
  textLayout,
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

  const textCell = (t: TextColumn) => (
    <div key={`text-${t.shortName}`} role="gridcell" className="qzk-grid-cell" style={{ width: colWidth, flexShrink: 0 }}>
      —
    </div>
  );

  return (
    <div className="qzk-grid-footer" style={{ position: "sticky", bottom: 0, zIndex: 3 }}>
      {STAT_ROWS.map(([label, key, full]) => (
        <div role="row" key={key} className="qzk-grid-row" style={{ height: rowHeight }}>
          <div
            role="rowheader"
            className="qzk-grid-cell qzk-grid-headcell qzk-grid-rownum"
            title={`${full} (column statistic)`}
            aria-label={full}
            style={{ position: "sticky", left: 0, zIndex: 3, width: gutterWidth, flexShrink: 0 }}
          >
            {label}
          </div>
          <div
            role="gridcell"
            className="qzk-grid-cell"
            style={{ position: "sticky", left: gutterWidth, zIndex: 3, background: "var(--surface-2)", width: widthOf(-1), flexShrink: 0 }}
          >
            {colStats ? fmtNum(colStats[0]?.[key]) : "…"}
          </div>
          {textLayout.before.map(textCell)}
          {leadingSpacer > 0 && <div style={{ width: leadingSpacer, flexShrink: 0 }} aria-hidden="true" />}
          {visibleCols.map((c) => (
            <Fragment key={c}>
              <div role="gridcell" className="qzk-grid-cell" style={{ width: widthOf(c), flexShrink: 0 }}>
                {channelRoles[c] === "ignore" ? "—" : colStats ? fmtNum(colStats[c + 1]?.[key]) : "…"}
              </div>
              {textLayout.after(c).map(textCell)}
            </Fragment>
          ))}
          {trailingSpacer > 0 && <div style={{ width: trailingSpacer, flexShrink: 0 }} aria-hidden="true" />}
          {textLayout.trailing.map(textCell)}
        </div>
      ))}
    </div>
  );
}
