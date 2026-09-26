// The singleton PlotView writers, extracted from store/useApp.ts (audit P4.1 —
// "decompose high-risk frontend god-modules, characterization tests first";
// store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp store
// instance exactly like ./windows, ./corrections and ./gadget — read
// store/windows.ts's header first: `useApp` spreads
// `createPlotViewSettingsSlice(set, get)` into the store, so every existing
// `useApp((s) => ...)` selector and `useApp.getState().setYScale(...)` call
// keeps working. This file is a code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: every action that writes the app's singleton
// PlotView state — the axis scales/limits/steps/tick formats/titles, the
// legend/grid/axis-box flags, stack mode + panel fit + page setup, the
// x/y/y2/group channel keys, reference lines, annotations, the per-channel
// series styles/labels/error pairings, the explicit draw order, hidden/solo
// channels, and the waterfall offset. The `ref-`/`ann-` id counters move with
// the two actions that mint from them, so nothing else can draw from them.
//
// WHAT IT DOES NOT OWN, deliberately:
//   - the FIELDS themselves. They stay declared (and initialized) on
//     `AppState` in store/useApp.ts, because the actions that RESET them on a
//     dataset switch (`setActive`/`addDataset`/`duplicateDataset`) and the
//     ones that bulk-apply them (`loadWorkspace`, `applyOriginFigure`,
//     `facetByColumn`/`breakAtGaps`) are not part of this cluster. Same shape as
//     store/corrections.ts, which mutates the shared `datasets` field without
//     owning it, and store/libraryPanel.ts's `updateFolder`.
//   - `setChannelRole`/`setChannelType`. Those write per-DATASET channel
//     config (`Dataset.channelRoles`/`channelTypes`, which round-trip the
//     `.dwk`), not view state, so they stay in useApp.ts beside the other
//     dataset writers rather than widening this module's promise.
//   - preferences (`setTheme`/`setAccent`/`setDensity`/`setPalette`/
//     `setPref`) and shell layout (`toggleLeft`/`toggleRight`/`setStageTab`).
//     Those persist through store/prefs.ts and are not PlotView.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, and no React — this
// is store-layer code (architecture.test.ts's "store/ layering guard" enforces
// this file specifically: only three grandfathered modules — reimport.ts,
// reimportAllRun.ts, originFigureApply.ts — may import components/, and this
// one is not among them), and every action here is a plain state writer a
// test can call without rendering anything. Only `lib/`
// pure helpers, sibling store modules, and the `AppState` TYPE from ./useApp
// (type-only, so the runtime import graph stays one-directional:
// useApp -> here).
//
// Characterization tests: store/plotViewSettings.characterization.test.ts pins
// every action below — fields written, undo label pushed (or not: the
// setXLim/setYLim pair records none), macro step emitted, and an edge case
// each. They were written and run GREEN against the pre-extraction code in
// useApp.ts, and pass unchanged against this module.

import { lit } from "../lib/macro";
import type { PageSetup } from "../lib/pagesetup";
import { nextPanelFit, type PanelFit } from "../lib/panelLayout";
import { effectiveChannels } from "../lib/plotdata";
import type { StatLevelOptions } from "../lib/statLevelOptions";
import type { AxisFormat, AxisScale, SeriesStyle } from "../lib/types";
import type { HistoryBatchToken } from "./history";
import type { AppState, LegendPos } from "./useApp";
import { clearFocusedXBreaks } from "./windowDocuments";

/** Reference-line and annotation id sequences. Module-level (not per-slice) so
 *  the ids stay unique for the process, exactly as they were in useApp.ts. */
let _refSeq = 0;
let _annSeq = 0;

export interface PlotViewSettingsSlice {
  setYScale: (yScale: AxisScale) => void;
  setXScale: (xScale: AxisScale) => void;
  setShowGrid: (showGrid: boolean) => void;
  setShowLegend: (showLegend: boolean) => void;
  setLegendPos: (pos: LegendPos) => void;
  setLegendStatic: (v: boolean) => void;
  setPlotTemplate: (template: string) => void;
  setShowAxisBox: (show: boolean) => void;
  setStackMode: (stackMode: boolean) => void;
  setPanelFit: (mode: PanelFit) => void; // #54
  cyclePanelFit: () => void; // #54 — frames<->window, +page when a pageSetup exists
  setPageSetup: (pageSetup: PageSetup | null) => void; // #54
  setInsetMode: (insetMode: boolean) => void;
  setPolarMode: (polarMode: boolean) => void;
  setStatMode: (statMode: boolean) => void;
  setStatLevels: (patch: Partial<StatLevelOptions>) => void; // P2.6 (lib/statLevelOptions)
  setXLim: (xLim: [number, number] | null) => void;
  setYLim: (yLim: [number, number] | null) => void;
  // Secondary (right) Y axis: expose the already-rendered y2Scale/y2Lim fields
  // so the plot context menu can edit an Origin double-Y import's right axis.
  // Only meaningful when y2Keys is non-empty (otherwise there is no y2 scale).
  setY2Scale: (y2Scale: AxisScale | null) => void;
  setY2Lim: (y2Lim: [number, number] | null) => void;
  setXFmt: (xFmt: AxisFormat) => void;
  setYFmt: (yFmt: AxisFormat) => void;
  setY2Fmt: (y2Fmt: AxisFormat | null) => void;
  setPlotTitle: (plotTitle: string) => void;
  setXAxisLabel: (xAxisLabel: string) => void;
  setYAxisLabel: (yAxisLabel: string) => void;
  setY2AxisLabel: (y2AxisLabel: string) => void;
  setXKey: (xKey: number | null) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setGroupKey: (groupKey: number | null) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
  addRefLine: (axis: "x" | "y", value: number) => void;
  removeRefLine: (id: string) => void;
  updateRefLine: (id: string, value: number) => void;
  /** `historyToken`: forward the token an enclosing `withHistoryBatch` gave
   *  the caller (e.g. `usePeaks`' "Label peaks" batch) so this add folds
   *  into that batch's one undo entry instead of pushing its own — same
   *  pattern as `addDataset`'s own `historyToken` (see its doc). Omitted by
   *  every ordinary call site (manual "Add text here…", the object menu's
   *  Duplicate, plotspec apply), which keep recording their own independent
   *  entry exactly as before. */
  addAnnotation: (x: number, y: number, text: string, historyToken?: HistoryBatchToken) => string;
  removeAnnotation: (id: string) => void;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  resetSeriesStyle: (channel: number) => void;
  setSeriesLabel: (channel: number, label: string) => void;
  setErrKey: (channel: number, errChannel: number | null) => void;
  setSeriesOrder: (order: number[] | null) => void;
  toggleHidden: (channel: number) => void;
  // Solo one plotted channel (hide all others); null = show all. The column
  // switcher's engine — kept in the store so it's testable.
  soloChannel: (channel: number | null) => void;
  setWaterfall: (waterfall: number) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createPlotViewSettingsSlice(set: SliceSet, get: SliceGet): PlotViewSettingsSlice {
  return {
    setYScale: (yScale) => {
      get().recordHistory("change Y scale"); set({ yScale });
      get().recordMacro(`Y axis ${yScale}`, `qz.setYScale(${lit(yScale)})`);
    },
    setXScale: (xScale) => {
      get().recordHistory("change X scale"); set({ xScale });
      get().recordMacro(`X axis ${xScale}`, `qz.setXScale(${lit(xScale)})`);
    },
    setShowGrid: (showGrid) => { get().recordHistory("toggle grid"); set({ showGrid }); },
    setShowLegend: (showLegend) => { get().recordHistory("toggle legend"); set({ showLegend }); },
    setLegendPos: (legendPos) => { get().recordHistory("move legend"); set({ legendPos }); },
    setLegendStatic: (legendStatic) => { get().recordHistory("change legend mode"); set({ legendStatic }); },
    setPlotTemplate: (plotTemplate) => { get().recordHistory("apply plot template"); set({ plotTemplate }); },
    setShowAxisBox: (showAxisBox) => { get().recordHistory("toggle axis box"); set({ showAxisBox }); },
    // A manual toggle (on OR off) always drops any spatial arrangement from a
    // prior Origin multi-panel apply, or a prior facet-by-column arrangement
    // (gap #21 residual) — the plain per-channel split (or leaving stack mode)
    // is what the user asked for, never a stale spatial/facet grid.
    // F4.4: also clears `facetKey` -- without it, toggling OFF a facet
    // (`composition: null` here) then toggling stack mode back ON via the
    // plain "Stack" button (never through `facetByColumn`) would resurrect the
    // old facet grid, since `MultiPanelStage.tsx`'s render-layer fallback
    // rebuilds it from `facetKey` whenever `composition` is null.
    setStackMode: (stackMode) => (
      get().recordHistory("change plot layout"), set((s) => ({ stackMode, composition: null, facetKey: null, plotWindows: clearFocusedXBreaks(s.plotWindows, s.focusedWindowId) })) // review F3: clears the AUTHORED break too, in BOTH directions -- a break composition pre-empts the per-channel stack (`multiPanelShowing`), so keeping it would make ON inert exactly as OFF was; see `clearFocusedXBreaks`' doc
    ),
    // #54: the spatial multi-panel fit mode (PlotView field). `cyclePanelFit`
    // advances frames<->window until a page model exists (Stage 2 opens page).
    setPanelFit: (panelFit) => { get().recordHistory("change panel fit"); set({ panelFit }); },
    cyclePanelFit: () => { get().recordHistory("change panel fit"); set((s) => ({ panelFit: nextPanelFit(s.panelFit, s.pageSetup != null) })); },
    setPageSetup: (pageSetup) => { get().recordHistory("change page setup"); set({ pageSetup }); },
    setInsetMode: (insetMode) => { get().recordHistory("toggle inset"); set({ insetMode }); },
    setPolarMode: (polarMode) => { get().recordHistory("toggle polar plot"); set({ polarMode }); },
    setStatMode: (statMode) => { get().recordHistory("toggle statistics plot"); set({ statMode }); },
    setStatLevels: (patch) => { get().recordHistory("change level display"); set((s) => ({ statLevels: { ...s.statLevels, ...patch } })); },
    // Clears the paired decoded step too: a manual/Inspector range (or the
    // smart auto-scale reset to null) is no longer the Origin figure that
    // produced xStep/yStep, so a stale step must never leak onto it.
    setXLim: (xLim) => set({ xLim, xStep: null }),
    setYLim: (yLim) => set({ yLim, yStep: null }),
    // A manual y2 range is no longer the Origin figure that decoded y2Step, so
    // drop the stale step alongside it (mirrors setYLim / yStep above).
    setY2Scale: (y2Scale) => { get().recordHistory("change Y2 scale"); set({ y2Scale }); },
    setY2Lim: (y2Lim) => { get().recordHistory("change Y2 limits"); set({ y2Lim, y2Step: null }); },
    setXFmt: (xFmt) => { get().recordHistory("format X axis"); set({ xFmt }); },
    setYFmt: (yFmt) => { get().recordHistory("format Y axis"); set({ yFmt }); },
    setY2Fmt: (y2Fmt) => { get().recordHistory("format Y2 axis"); set({ y2Fmt }); },
    setPlotTitle: (plotTitle) => {
      get().recordHistory("edit plot title"); set({ plotTitle });
      get().recordMacro(`Title → ${plotTitle || "(none)"}`, `qz.setPlotTitle(${lit(plotTitle)})`);
    },
    setXAxisLabel: (xAxisLabel) => { get().recordHistory("edit X axis title"); set({ xAxisLabel }); },
    setYAxisLabel: (yAxisLabel) => { get().recordHistory("edit Y axis title"); set({ yAxisLabel }); },
    setY2AxisLabel: (y2AxisLabel) => { get().recordHistory("edit Y2 axis title"); set({ y2AxisLabel }); },
    setXKey: (xKey) => {
      get().recordHistory("change X channel"); set({ xKey });
      get().recordMacro(`X axis → channel ${xKey ?? "time"}`, `qz.setXKey(${lit(xKey)})`);
    },
    // P1.5: durable live grouping -- committed by useGraphBuilder's commitToPlot
    // (replacing the old "preview-only" toast) and editable directly once a
    // window exists. Mirrors setXKey exactly (undo history + macro record);
    // syncPlotWindow/updateFigureDocumentFromPlotView (windowDocuments.ts /
    // figureDocument.ts) then carry this singleton into the focused window's
    // canonical FigureDocument on the next view sync, same as every other
    // PlotView field.
    setGroupKey: (groupKey) => {
      get().recordHistory("change group");
      set({ groupKey });
      get().recordMacro(`Group by channel ${groupKey ?? "none"}`, `qz.setGroupKey(${lit(groupKey)})`);
    },
    setYKeys: (yKeys) => {
      get().recordHistory("change Y channels"); set({ yKeys });
      get().recordMacro(`Y channels → ${yKeys ? yKeys.join(",") : "all"}`, `qz.setYKeys(${lit(yKeys)})`);
    },
    setY2Keys: (y2Keys) => {
      get().recordHistory("change Y2 channels");
      set({ y2Keys, ...(y2Keys ? {} : { y2Lim: null, y2Scale: null, y2Step: null, y2AxisLabel: "" }) });
      get().recordMacro(
        `Y2 channels → ${y2Keys ? y2Keys.join(",") : "none"}`,
        `qz.setY2Keys(${lit(y2Keys)})`,
      );
    },
    addRefLine: (axis, value) => { get().recordHistory("add reference line"); set((s) => ({ refLines: [...s.refLines, { id: `ref-${++_refSeq}`, axis, value }] })); },
    removeRefLine: (id) => { get().recordHistory("delete reference line"); set((s) => ({ refLines: s.refLines.filter((r) => r.id !== id) })); },
    // Move a reference line to a new value (drag commit). No-op for an unknown id.
    updateRefLine: (id, value) => { get().recordHistory("move reference line"); set((s) => ({ refLines: s.refLines.map((r) => (r.id === id ? { ...r, value } : r)) })); },
    // Returns the new id (MAIN #27's "text box" flyout opens its text dialog).
    addAnnotation: (x, y, text, historyToken) => {
      const id = `ann-${++_annSeq}`;
      get().recordHistory("add annotation", historyToken);
      set((s) => ({ annotations: [...s.annotations, { id, x, y, text }] }));
      return id;
    },
    removeAnnotation: (id) => { get().recordHistory("delete annotation"); set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })); },
    setSeriesStyle: (channel, patch) => (get().recordHistory("style curve"),
      set((s) => ({
        seriesStyles: { ...s.seriesStyles, [channel]: { ...s.seriesStyles[channel], ...patch } },
      }))),
    resetSeriesStyle: (channel) => (get().recordHistory("reset curve style"),
      set((s) => {
        const next = { ...s.seriesStyles };
        delete next[channel];
        return { seriesStyles: next };
      })),
    // Rename a channel's legend/series label. Blank (or whitespace) clears the
    // override, reverting to the dataset's own label.
    setSeriesLabel: (channel, label) => (get().recordHistory("rename curve"),
      set((s) => {
        const next = { ...s.seriesLabels };
        const t = label.trim();
        if (t) next[channel] = t;
        else delete next[channel];
        return { seriesLabels: next };
      })),
    setErrKey: (channel, errChannel) => (get().recordHistory("change error bars"),
      set((s) => {
        const next = { ...s.errKeys };
        if (errChannel == null) delete next[channel];
        else next[channel] = errChannel;
        return { errKeys: next };
      })),
    // Persist an explicit plotted-channel draw order (a permutation of the current
    // plotted channels). effectiveChannels reorders by it; stale entries (channels
    // no longer plotted) are ignored and newly-plotted channels append in order.
    setSeriesOrder: (seriesOrder) => { get().recordHistory("reorder curves"); set({ seriesOrder }); },
    toggleHidden: (channel) => {
      get().recordHistory("toggle curve visibility");
      set((s) => ({
        hiddenChannels: s.hiddenChannels.includes(channel)
          ? s.hiddenChannels.filter((c) => c !== channel)
          : [...s.hiddenChannels, channel],
      }));
    },
    // Solo = hide every plotted channel except `channel` (the column switcher's
    // engine). null clears. View state like toggleHidden — not macro-recorded.
    soloChannel: (channel) => {
      get().recordHistory("solo curve");
      set((s) => {
        if (channel == null) return { hiddenChannels: [] };
        const ds = s.datasets.find((d) => d.id === s.activeId);
        if (!ds) return {};
        const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
        if (!plotted.includes(channel)) return {};
        return { hiddenChannels: plotted.filter((c) => c !== channel) };
      });
    },
    setWaterfall: (waterfall) => {
      get().recordHistory("change waterfall offset");
      set({ waterfall });
      get().recordMacro(`Waterfall → ${waterfall}`, `qz.setWaterfall(${waterfall})`);
    },
  };
}
