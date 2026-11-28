// Statistics stage (gap #16): a Canvas2D view over Box / Violin / Q-Q /
// Histogram+fit, entered via the "Statistics" toggle in PlotToolbar — a
// store-boolean early-return alongside polarMode/stackMode, NOT a 4th Stage
// tab (box/violin is a view of the SAME dataset, like polar). Mirrors
// PolarStage's self-contained Canvas2D structure; MapStage's own floating
// picker toolbar is the precedent for the mode/column controls. Thin: all
// state lives in useStatStage, all math in lib/statstage + statRender.
//
// This file is the thin FOCUSED-window wrapper (MULTI_PLOT_PLAN item 15): it
// feeds `useStatStage` the live singleton store fields and owns the
// mode/column toolbar; the canvas lifecycle lives in `StatStageCanvas` (the
// props-driven core a background window renders from its own `PlotView`
// snapshot — `windows/BackgroundAltModes.tsx`).

import type { ReactNode } from "react";
import { useState } from "react";

import type { StatMode } from "../../lib/statstage";
import { setStatHideEmptyLevels, setStatMarks, setStatPicks, setStatShowGroupN, setStatShowSummary } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Button, Select } from "../primitives";
import StatDist2Controls from "./StatDist2Controls";
import StatDist3Controls from "./StatDist3Controls";
import StatFacetPicker from "./StatFacetPicker";
import { isDistGroupMode } from "./statDrawKinds";
import StatDistControls from "./StatDistControls";
import StatMarksControls from "./StatMarksControls";
import StatStagePlot from "./StatStagePlot";
import PlotRowRangeChip from "./PlotRowRangeChip";
import StatSummaryTable from "./StatSummaryTable";
import { useStatGroupSelection } from "./useStatGroupSelection";
import { useToolsClearance } from "./useToolsClearance";
import { useStatStage } from "./useStatStage";
import { useRegisterStatStageExporter } from "./useStatStageExport";

const MODE_OPTIONS: { value: StatMode; label: string }[] = [
  { value: "box", label: "Box" },
  // "strip" (JMP_GAP J5 #3): a points-only categorical plot, same category
  // slots as box but no quartile/whisker glyph.
  { value: "strip", label: "Strip" },
  { value: "violin", label: "Violin" },
  { value: "qq", label: "Q-Q" },
  { value: "histogram", label: "Histogram" },
  { value: "cdf", label: "CDF" },
  { value: "marginal", label: "Marginal" },
  { value: "ridgeline", label: "Ridgeline" },
  { value: "sideviolin", label: "Half / split violin" },
  { value: "paired", label: "Paired" },
  { value: "lollipop", label: "Lollipop" },
  { value: "bar", label: "Bar" },
];

/** The summary table's dock width, px (P2.6 box 4). */
const DOCK_WIDTH = 340;

const BAR_STACK_OPTIONS: { value: "grouped" | "stacked" | "percent"; label: string }[] = [
  { value: "grouped", label: "Grouped" },
  { value: "stacked", label: "Stacked" },
  { value: "percent", label: "100 %" },
];

export default function StatStage() {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setStatMode = useApp((s) => s.setStatMode);
  const active = useActiveDataset();
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const statStageSeed = useApp((s) => s.statStageSeed);
  const clearStatStageSeed = useApp((s) => s.clearStatStageSeed);
  // P2.6 box 2: persisted with the plot (PlotView), so they ride the .dwk.
  const hideEmptyLevels = useApp((s) => s.statHideEmptyLevels);
  const showGroupN = useApp((s) => s.statShowGroupN);
  const showSummary = useApp((s) => s.statShowSummary); // box 4's table, persisted likewise
  const rowRange = useApp((s) => s.rowRange); // the plot's row window
  const marks = useApp((s) => s.statMarks); // P2.6 box 1, persisted likewise
  const picks = useApp((s) => s.statPicks); // plot type, columns, options — persisted likewise
  const st = useStatStage({
    active,
    yKeys,
    xKey,
    seriesOrder,
    rowRange,
    seed: statStageSeed,
    onSeedConsumed: clearStatStageSeed,
    hideEmptyLevels,
    showGroupN,
    marks,
    onMarksChange: setStatMarks,
    picks,
    onPicksChange: setStatPicks,
  });
  useRegisterStatStageExporter(st.exportFigure); // the app's Export / Copy / Send figure route here
  const categorical = st.mode === "box" || st.mode === "violin" || st.mode === "bar" || st.mode === "strip";
  const ridge = isDistGroupMode(st.mode); // ridgeline, half / split violin, lollipop: groups like a violin, but no marks, facets or summary table
  // P2.6 box 4: the per-group summary table, linked both ways to the app's
  // row selection (useStatGroupSelection). The plot half of the link is on
  // whenever the plot is categorical; the table is opt-in (`statShowSummary`).
  // P2.6 review finding 6: only compute the table's per-group stats while
  // it's actually open — the plot half of the link needs only rows/keys.
  const sel = useStatGroupSelection(active, st.axes, hideEmptyLevels, showSummary);
  const dockOpen = categorical && showSummary;
  const [toolsRef, toolsClearance] = useToolsClearance(); // the plot and dock sit below the bar
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      const done = await st.exportFigure("pdf");
      useApp.getState().setStatus(done ? "exported statistical-plot figure" : "export cancelled");
    } catch (e) {
      useApp.getState().setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }

  const groupByOptions = [
    { value: "channel", label: "(per channel)" },
    ...st.categoricalCols.map((c) => ({ value: String(c.index), label: c.label })),
  ];
  const columnOptions = st.columns.map((c) => ({ value: String(c.index), label: c.label }));
  // Group R: the NESTED second factor. The already-chosen "group by" column is
  // omitted — nesting a column inside itself labels every box `lot = 0 / lot =
  // 0`. (`maskStaleCategoricalPicks` enforces the same rule on the value, for
  // the case where "group by" MOVES onto an already-picked second factor; this
  // list just stops the user from asking for it in the first place.)
  const thenByOptions = [
    { value: "none", label: "(none)" },
    ...st.categoricalCols
      .filter((c) => c.index !== st.groupCol)
      .map((c) => ({ value: String(c.index), label: c.label })),
  ];
  // P1.4 Color-by: only the group column or (box / violin / strip) the nest.
  const colourByOptions = [
    { value: "none", label: "(position)" },
    ...st.categoricalCols
      .filter((c) => c.index === st.groupCol || (st.mode !== "bar" && c.index === st.group2Col))
      .map((c) => ({ value: String(c.index), label: c.label })),
  ];
  return (
    <div className="qzk-stage">
      <StatStagePlot
        draw={st.draw}
        drawFacets={st.drawFacets}
        theme={theme}
        accent={accent}
        sel={categorical ? sel : null}
        right={dockOpen ? DOCK_WIDTH + 8 : 0}
        top={toolsClearance}
        errorNote={st.errorNote}
      />
      {dockOpen && sel.summary && (
        <div
          className="qzk-glass"
          data-testid="stat-summary-dock"
          style={{ position: "absolute", top: Math.max(56, toolsClearance), right: 8, bottom: 44, width: DOCK_WIDTH, overflow: "auto", padding: 4 }}
        >
          <StatSummaryTable sel={sel} valueLabels={sel.summary.valueLabels} />
        </div>
      )}

      <div
        ref={toolsRef}
        className="qzk-glass qzk-float-tools"
        style={{ gap: 10, padding: "6px 10px", flexWrap: "wrap", maxWidth: "92vw", justifyContent: "center", maxHeight: "40%", overflowY: "auto" }}
      >
        <button
          aria-label="Cartesian plot"
          className="qzk-tool-btn active"
          title="Back to a cartesian plot"
          onClick={() => setStatMode(false)}
        >
          ▦
        </button>
        <span className="qzk-tool-sep" />
        <SegmentedControl options={MODE_OPTIONS} value={st.mode} onChange={st.setMode} />
        <span className="qzk-tool-sep" />

        {(categorical || ridge) && (
          <>
            <Picker label="group by">
              <Select
                options={groupByOptions}
                value={st.groupCol == null ? "channel" : String(st.groupCol)}
                onChange={(e) =>
                  st.setGroupCol(e.target.value === "channel" ? null : Number(e.target.value))
                }
              />
            </Picker>
            {/* Nested second factor (Group R) -- one box per (group, then-by)
                cell. Box/Violin/Strip only: Bar's category slots come from a
                single column (it builds a category x series matrix, not a 1-D
                group list), so the hook holds the pick inert there and this
                hides it rather than showing a control that does nothing. */}
            {st.groupCol != null && st.mode !== "bar" && (
              <Picker label="then by">
                <Select
                  options={thenByOptions}
                  value={st.group2Col == null ? "none" : String(st.group2Col)}
                  onChange={(e) =>
                    st.setGroup2Col(e.target.value === "none" ? null : Number(e.target.value))
                  }
                />
              </Picker>
            )}
            {st.groupCol != null && st.mode !== "bar" && (
              <Picker label="value">
                <Select
                  options={columnOptions}
                  value={String(st.valueCol)}
                  onChange={(e) => st.setValueCol(Number(e.target.value))}
                />
              </Picker>
            )}
            {/* Every categorical mode facets, strip included (JMP_GAP J5 residual closed 2026-09-29: panels
                carry their own points), and the item 20 variants too (not the ridgeline). */}
            {st.mode !== "ridgeline" && <StatFacetPicker st={st} />}
            {/* P1.4 Color-by: a colour per level of one of the plot's own factors (lib/statColor). */}
            {st.groupCol != null && !ridge && (
              <Picker label="color by">
                <Select
                  options={colourByOptions}
                  value={st.colorCol == null ? "none" : String(st.colorCol)}
                  onChange={(e) => st.setColorCol(e.target.value === "none" ? null : Number(e.target.value))}
                />
              </Picker>
            )}
          </>
        )}

        {st.mode === "bar" && (
          <Picker label="layout">
            <SegmentedControl
              options={BAR_STACK_OPTIONS}
              value={st.barPercent ? "percent" : st.barStack ? "stacked" : "grouped"}
              onChange={st.setBarLayout}
            />
          </Picker>
        )}

        {/* P2.6 box 1: raw points, jitter, summary marker, error bars,
            connect-means and label options -- persisted on the PlotView. */}
        {categorical && (
          <StatMarksControls
            mode={st.mode} marks={st.marks} setMarks={st.setMarks} grouped={st.groupCol != null} stacked={st.barStack} errorColumn={st.errorColumn} comparisons={st.comparisons}
          />
        )}

        {/* P2.6 box 2: an empty level keeps its slot (n=0) unless hidden;
            the per-group n captions are optional. Both persist (PlotView). */}
        {categorical && (
          <Checkbox checked={!hideEmptyLevels} onChange={(v) => setStatHideEmptyLevels(!v)} title="Keep levels with no usable data on the axis, marked n=0">
            empty levels
          </Checkbox>
        )}
        {categorical && (
          <Checkbox checked={showGroupN} onChange={setStatShowGroupN} title="Annotate each group's n above the plot">
            n
          </Checkbox>
        )}
        {categorical && (
          <Checkbox checked={showSummary} onChange={setStatShowSummary} title="Per-group summary table, linked to the row selection">
            summary
          </Checkbox>
        )}

        <StatDistControls st={st} />
        <StatDist2Controls st={st} />
        <StatDist3Controls st={st} />

        <span className="qzk-tool-sep" />
        <Button
          size="sm"
          disabled={(!st.draw && !st.drawFacets) || exporting}
          onClick={() => void onExport()}
          title={
            st.drawFacets
              ? "Render this facet grid server-side and download it (PDF)"
              : "Render this plot server-side and download it (PDF)"
          }
        >
          ⤓ Export
        </Button>
      </div>

      {!st.hasData && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}
      <PlotRowRangeChip alt />
      {st.hasData && st.error && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}
        >
          {st.error}
        </div>
      )}
      {(st.note || st.groupNotice) && (
        <div className="qzk-glass qzk-readout" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", maxWidth: "70%" }}>
          {st.note && <div>{st.note}</div>}
          {/* One line; the per-level breakdown (dropped rows per level) is its tooltip. */}
          {st.groupNotice && (
            <div data-testid="stat-group-notice" title={st.groupNotice.detail}>
              {st.groupNotice.line}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A compact labeled control for the float toolbar (mirrors MapStage's Picker).
function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}
