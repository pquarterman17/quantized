// The per-window plot view snapshot (MULTI_PLOT_PLAN item 2): the ~35
// singleton plot-view fields in store/useApp.ts, lifted into one plain-data
// type so each plot window can carry its OWN copy while the store's singleton
// fields stay the FOCUSED window's LIVE view — the "focused-window facade"
// (see MULTI_PLOT_PLAN's "Key decisions" #1). `snapshotView`/`hydrateView` are
// the ONLY sanctioned way to move a view between "live" (singleton store
// fields) and "at rest" (a window record); today that's exclusively the
// store's `focusWindow`/`closeWindow` actions, and later item 7's `.dwk` save
// path. Pure — no store import (this stays a lib/ module; see
// `.claude/rules/architecture-guards.md` #1 pure-layer isolation).
//
// Deliberately EXCLUDED from PlotView: dataset binding (lives on the window
// record, not the view — a window can be re-pointed at a new dataset without
// losing its display config), tool/gadget/overlay transient state (fitOverlay,
// qfitRoi, plotTool, … — stays singleton/focused-only, MULTI_PLOT_PLAN's "Key
// decisions" #2), and global Preferences-dialog defaults (defaultTrace,
// wheelZoom, excludedDisplay, sigFigs, … — app-wide, not per-window).

import { PANEL_FITS, type PanelFit } from "./panelFit";
import { sanitizePageSetup, type PageSetup } from "./pagesetup";
import type { PanelLayout } from "./panelWindowModel";
import type { FrozenPlotBundle } from "./plotsnapshot";
import { boolViewFields, sanitizeLegendSize, sanitizeRegionShades, sanitizeStatMarksByMode, sanitizeStatPicks, uniqueIds, type StatMarksByMode, type StatPicks } from "./plotviewSanitize";
import { axisScaleOrDefault, y2ScaleOrDefault } from "./plotviewAxis";
import { LEGEND_POS, axisLabelOffsetsOrDefault, axisLabelStylesOrDefault, isRange, legendXYOrNull, sanitizeAnnotations, sanitizeShapes } from "./plotviewDecor";
import { isString, keyedRecord } from "./sanitizeRecord";
import { sanitizeHalfLim, type HalfLim } from "./axisLim";
import type { FigureDocument } from "./figureDocument";
import type { Annotation, AxisFormat, AxisLabelOffsets, AxisLabelStyles, AxisScale, RefLine, RegionShade, SeriesStyle, Shape, TickMode } from "./types";

// Moved-out siblings (module-size ratchet), re-exported so no importer changed.
export { cycleAxisScale, cycleTickMode, isAxisScale, scaleFromLog } from "./plotviewAxis";
export { LEGEND_POS, legendXYOrNull, nearestLegendCorner, sanitizeAnnotations, sanitizeShapes } from "./plotviewDecor";
export { cascadeGeometry, cascadeLayout, cycleWindow, dedupeWindowTitle, displayedWindowTitle, dropGeometry, nextLinkGroup, nextPlotBg, tileLayout, zOrderIds } from "./plotWindows";

const VALID_TICK_MODES: readonly TickMode[] = ["auto", "fixed", "sci", "eng", "date", "time", "datetime"];

// Re-exported: PlotWindow.panel (below) is the only reason this module
// depends on panelWindowModel.ts at all — callers that just need the window-record
// shape (store/panels.ts, PanelPlotWindow.tsx, lib/contextActions.ts) import
// the type from HERE like every other PlotWindow-adjacent type, not the leaf
// module.
export type { PanelLayout };
export type LegendPos = "auto" | "ne" | "nw" | "se" | "sw"; // "auto": lib/legendAutoPlace


/** One plot's full display configuration — everything that differs window to
 *  window. See the module doc above for what's deliberately excluded. */
export interface PlotView {
  yScale: AxisScale;
  xScale: AxisScale;
  showGrid: boolean;
  showLegend: boolean;
  legendPos: LegendPos;
  /** Free legend position (MAIN #18, pointer-mode drag): FRACTIONS [fx, fy]
   *  of the plot area, overriding `legendPos` when set. null (the default)
   *  keeps the corner-preset behaviour untouched — an Origin-imported
   *  position stays a `legendPos` corner, never this. */
  legendXY: [number, number] | null;
  legendSize: [number, number] | null;
  /** Frame-anchored legend position (decode #52): the legend box TOP-LEFT as
   *  FRACTIONS of the plot FRAME (uPlot's plotting area, `u.over`), NOT of the
   *  `.qzk-stage` container `legendXY` uses. Convention: `[fx, fy]` with fx
   *  measured RIGHTWARD from the frame's left edge (0 = left, 1 = right) and
   *  fy measured DOWNWARD from the frame's TOP edge (0 = top, 1 = bottom) —
   *  identical in spirit to `legendXY` (top-origin), and identical to Origin's
   *  own stored frame fraction (`frac_to_data`'s `frac_b` is "from the TOP"),
   *  so no flip is needed at render. Origin legends are FRAME-anchored, so this
   *  stays put through zoom/pan (unlike a data anchor). Set by
   *  `applyOriginFigure` when Origin's decoded position is inside the frame;
   *  WINS over `legendXY` and the corner `legendPos`. Dragging the box or a
   *  reset clears it (one-way degrade → `legendXY`/corner). null = not
   *  frame-anchored (the default; every non-Origin plot). */
  legendFrameXY: [number, number] | null;
  /** Static legend mode (decode #52): when true the legend renders as a clean,
   *  read-only Origin-style block — no reorder arrows, no click-to-hide /
   *  double-click-rename / drag / context-menu row chrome, and hidden channels
   *  are SKIPPED entirely (not shown greyed). The box stays draggable in
   *  pointer mode. `applyOriginFigure` sets it true; a plot menu toggle flips
   *  it back. Default false = the full interactive legend, unchanged. */
  legendStatic: boolean;
  /** Legend TITLE header text (decode #52) — Origin's bold legend header,
   *  drawn above the entries in the static legend. Set from
   *  `OriginFigure.legend_title` by `applyOriginFigure`; null = no title. */
  legendTitle: string | null;
  /** Per-axis title drag offsets (CSS px). Nudges an axis title clear of long
   *  tick labels; absent axes sit at default. Persisted like `legendXY`. */
  axisLabelOffsets: AxisLabelOffsets;
  /** Per-axis title text style (right-click ▸ Format: size/italic/bold). */
  axisLabelStyles: AxisLabelStyles;
  plotTemplate: string;
  showAxisBox: boolean;
  xReversed: boolean; // x high-to-low (IR wavenumber): uPlot dir -1, export x_reversed
  stackMode: boolean;
  insetMode: boolean;
  polarMode: boolean;
  statMode: boolean;
  /** P2.6 — Stat Stage options that persist with the plot (screen and export both honour
   *  them): hide empty levels (default false: n=0 slots), n captions (true), box 4's summary table (false), box 1's marks. */
  statHideEmptyLevels: boolean;
  statShowGroupN: boolean;
  statShowSummary: boolean;
  statMarks: StatMarksByMode; statPicks: StatPicks; // + plot type / columns / dist / bins / fit / stacking (2026-10-01)
  xLim: HalfLim | null; // either side null = auto for that side (lib/axisLim.ts)
  yLim: HalfLim | null;
  xStep: number | null;
  yStep: number | null;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  /** Secondary-axis tick format override; null = inherit `yFmt` (the
   *  compatibility default — see store/plotViewFields.ts's own y2Fmt doc). */
  y2Fmt: AxisFormat | null;
  plotTitle: string;
  xAxisLabel: string;
  yAxisLabel: string;
  xKey: number | null;
  yKeys: number[] | null;
  groupKey: number | null; // P1.5 "Group" well channel -- one series per level; bindings-owned like xKey/yKeys
  facetKey: number | null; // F4.4 facet-by-column binding; bindings-owned + reset-on-switch like groupKey
  y2Keys: number[] | null;
  y2Lim: [number, number] | null;
  y2Scale: AxisScale | null;
  y2Step: number | null;
  y2AxisLabel: string;
  refLines: RefLine[];
  annotations: Annotation[];
  regionShades: RegionShade[];
  /** Drawn shapes (MAIN #27: arrow/line/rect/ellipse). Global to the plot,
   *  same "lives on PlotView, swapped per-window" convention as
   *  `annotations`/`refLines`. */
  shapes: Shape[];
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  waterfall: number;
  waterfallDx: number; // waterfall X step per series, a fraction of the x-span (0 = off; lib/waterfallX.ts)
  /** How a spatial multi-panel composition fills the stage (#54): `"frames"`
   *  (letterbox the frames' bounding box — PR #47's default, and the
   *  back-compat value for a `.dwk` predating this field), `"window"` (fill
   *  the host), or `"page"` (true page coordinates — Stage 2). Only the
   *  spatial multi-panel view reads it; a plain XY plot ignores it. */
  panelFit: PanelFit;
  /** The window's physical page model (#54 Stage 2): drives the `"page"` fit
   *  and publication export. null = no page model (today's behaviour — export
   *  and fit fall back exactly as before). Prefilled aspect-honestly from a
   *  decoded Origin page on apply; editable via Page Setup. */
  pageSetup: PageSetup | null;
}

/** A fresh view — what a brand-new window starts from. Mirrors the store's
 *  own initial state for these fields, so the app's very first (sole,
 *  maximized) window is indistinguishable from "no windows yet" — the
 *  migration guarantee in MULTI_PLOT_PLAN's decision #6. */
export function defaultPlotView(): PlotView {
  return {
    yScale: "linear",
    xScale: "linear",
    showGrid: true,
    showLegend: true,
    legendPos: "auto",
    legendXY: null, legendSize: null,
    legendFrameXY: null,
    legendStatic: false,
    legendTitle: null,
    axisLabelOffsets: {},
    axisLabelStyles: {},
    plotTemplate: "screen",
    showAxisBox: true, xReversed: false,
    stackMode: false,
    insetMode: false,
    polarMode: false,
    statMode: false,
    statHideEmptyLevels: false, statShowGroupN: true, statShowSummary: false, statMarks: {}, statPicks: {},
    xLim: null, yLim: null,
    xStep: null, yStep: null,
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    xKey: null, yKeys: null,
    groupKey: null,
    facetKey: null,
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2Step: null,
    y2AxisLabel: "",
    refLines: [],
    annotations: [],
    regionShades: [],
    shapes: [],
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    waterfall: 0, waterfallDx: 0,
    panelFit: "frames",
    pageSetup: null,
  };
}
/** The exact PlotView field list — derived from `defaultPlotView()` so there
 *  is exactly ONE place that enumerates the ~35 fields. */
const VIEW_KEYS = Object.keys(defaultPlotView()) as (keyof PlotView)[];

/** Read the view fields out of any object that carries them (typically the
 *  live store state — a superset of `PlotView`) — the ONLY sanctioned way to
 *  freeze the focused window's live view into its record. A plain field pick,
 *  not a store import, so this stays a pure lib module. */
export function snapshotView(source: PlotView): PlotView {
  const out = {} as Record<keyof PlotView, unknown>;
  for (const k of VIEW_KEYS) out[k] = source[k];
  return out as unknown as PlotView;
}

/** The NAVIGATION subset of PlotView: the x/y zoom-pan window and the tick
 *  steps that travel with it (`setXLim`/`setYLim` clear their step). These sit
 *  OUTSIDE the edit undo/redo domain — zoom/pan rides the separate
 *  back/forward view history (see store/history.ts's header: "so Ctrl+Z stays
 *  predictable"), so folding them into an edit snapshot makes Ctrl+Z revert a
 *  zoom the user performed AFTER the action being undone.
 *
 *  `y2Lim`/`y2Step` are deliberately NOT here: nothing zooms y2 (the view
 *  history's ViewSnapshot carries x and y only) and `setY2Lim` calls
 *  `recordHistory` itself, so y2 limits are an ordinary undoable edit. */
export const NAV_VIEW_KEYS = ["xLim", "yLim", "xStep", "yStep"] as const;

export type NavigationView = Pick<PlotView, (typeof NAV_VIEW_KEYS)[number]>;

/** Pick the LIVE navigation fields, to carry across an undo/redo restore. */
export function navigationView(source: PlotView): NavigationView {
  return { xLim: source.xLim, yLim: source.yLim, xStep: source.xStep, yStep: source.yStep };
}

/** The inverse: produce a fresh, independent copy of a stored view to spread
 *  back onto the live singleton fields (e.g. `set(hydrateView(record.view))`).
 *  Identity with `snapshotView` at the field level (see the round-trip test)
 *  — a copy, not the same object, so mutating the live fields afterward never
 *  reaches back into the window record it came from. */
export function hydrateView(view: PlotView): PlotView {
  return snapshotView(view);
}

// ── Window geometry + record types ──────────────────────────────────────────

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WinState = "normal" | "minimized" | "maximized";

/** A plot window's background override (owner request 2026-07-09, item 18):
 *  "theme" (default) follows the app's plot canvas as it renders today —
 *  which stays dark regardless of the app's own light/dark theme (see
 *  `styles/colors.css`'s `--axes-bg` doc); "light"/"dark" pin THIS ONE
 *  window to a fixed page background instead, independent of every other
 *  window and the surrounding chrome — Origin's "white graph page in a dark
 *  app" model. Lives on the window record itself (not the swapped
 *  `PlotView`): it's a per-window display choice like `title`/`geometry`,
 *  not part of the focused-window "live view" swap (see the module doc's
 *  "deliberately EXCLUDED" list — same reasoning applies here). Resolved
 *  into concrete colours by `lib/uplotOpts.ts`'s `resolvePlotBg`. */
export type PlotBg = "theme" | "light" | "dark";


/** The window-kind discriminator (item 19 adds "panel"): `"plot"` is the
 *  live XY graph window (the only kind that can hold the view-facade focus);
 *  `"snapshot"` (item 11) is a static frozen-payload compare window;
 *  `"worksheet"` / `"map"` (item 17 — full Origin-style MDI) are floating
 *  DOCUMENT windows hosting the same components the stage tabs mount
 *  (`WorksheetPane` / `MapStage`), LIVE-bound to a dataset (unlike a
 *  snapshot: dataset removal nulls the binding, an explicit drop rebinds).
 *  `"panel"` (item 19 v1) is a composite MULTI-dataset window — the Library
 *  quick picks' "Panel: side by side/stacked/grid" and "Overlay in one
 *  plot" — carrying its own `panel` field instead of a single `datasetId`
 *  (see `PlotWindow.panel`'s doc). Every non-plot kind follows the snapshot
 *  focus model — `focusedWindowId` always points at a `kind:"plot"` window;
 *  `focusWindow` on the others only raises their z, and Ctrl+Tab cycling
 *  skips them. */
export type WindowKind = "plot" | "snapshot" | "worksheet" | "map" | "panel";

/** A plot window's persistent record: geometry/z/winState (the MDI chrome
 *  state — item 3), a dataset binding (by id; nulled, never force-closed, when
 *  that dataset is removed — MULTI_PLOT_PLAN decision #4), its own `PlotView`
 *  (swapped with the live singleton fields only while focused; REQUIRED but
 *  unused — kept at `defaultPlotView()` — on the item-17 worksheet/map
 *  document kinds), and its own background override (`bg`, item 18). See
 *  `WindowKind` above for the kind semantics. */
export interface PlotWindow {
  id: string;
  kind: WindowKind;
  title: string;
  datasetId: string | null;
  geometry: WindowGeometry;
  z: number;
  winState: WinState;
  view: PlotView;
  /** Canonical editable state for plot windows; absent on non-plot kinds. */
  document?: FigureDocument;
  bg: PlotBg;
  /** Cross-window link group (item 13, opt-in per the owner decision — never
   *  automatic same-dataset coupling): windows sharing the same non-null
   *  group share a uPlot cursor-sync group (crosshair tracks across them)
   *  and an x-zoom/pan sync; y-scales stay per-window. null = unlinked (the
   *  default). Like `bg`, a per-window display choice on the record itself,
   *  not part of the swapped `PlotView`. Wired in `lib/windowsync.ts`. */
  linkGroup: number | null;
  /** kind:"snapshot" only (item 11): the frozen composed display bundle this
   *  window renders VERBATIM — no fetch, no rowstate, no live dataset binding
   *  (a snapshot window's `datasetId` is always null; frozen means frozen).
   *  Its `view` is a frozen copy of the source's live view at freeze time.
   *  Absent on `kind:"plot"` windows. */
  snapshot?: FrozenPlotBundle;
  /** Item 14's pin toggle — the opt-out for the "focused window follows the
   *  Library" model (Key Decision 4's promised companion): while the FOCUSED
   *  window is pinned, a passive rebind (Library click / fresh import)
   *  retargets the top-z unpinned visible window (or a new one) instead of
   *  this one. An EXPLICIT gesture (drop onto the frame / `rebindWindow`)
   *  still rebinds a pinned window — deliberate beats passive. Like `bg`,
   *  this is per-window chrome state, not part of the swapped `PlotView`. */
  pinned: boolean;
  /** kind:"panel" only (item 19 v1): the composite window's dataset ids (in
   *  display order) + arrangement. A removed dataset drops OUT of this list
   *  (see `store/useApp.ts`'s removal sites -> `pruneWindowDatasetRefs`)
   *  rather than nulling a single `datasetId` — a panel window has no such
   *  field; `datasetId` stays `null` on every panel window, matching a
   *  snapshot's "frozen means frozen" convention. Absent on every other
   *  kind. Mirrors `snapshot`'s "kind-specific extra payload" shape. */
  panel?: { datasetIds: string[]; layout: PanelLayout };
}


// ── .dwk / untrusted-boundary sanitizer (wired by item 7) ──────────────────

export function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function strOrDefault(v: unknown, d: string): string {
  return typeof v === "string" ? v : d;
}


function isAxisFormat(v: unknown): v is AxisFormat {
  if (typeof v !== "object" || v === null) return false;
  const candidate = v as { mode?: unknown; digits?: unknown };
  return typeof candidate.mode === "string"
    && (VALID_TICK_MODES as readonly string[]).includes(candidate.mode)
    && typeof candidate.digits === "number"
    && Number.isFinite(candidate.digits);
}


/** Validate a persisted view (or drop back to `defaultPlotView()` field by
 *  field) — the same per-field-fallback discipline as `loadPrefs`/
 *  `sanitizeFigureDocs`. Never throws on malformed input. */
export function sanitizePlotView(v: unknown): PlotView {
  const fb = defaultPlotView();
  if (typeof v !== "object" || v === null) return fb;
  const o = v as Record<string, unknown>;
  return {
    yScale: axisScaleOrDefault(o.yScale, o.yLog, fb.yScale),
    xScale: axisScaleOrDefault(o.xScale, o.xLog, fb.xScale),
    ...boolViewFields(o, fb),
    statMarks: sanitizeStatMarksByMode(o.statMarks), statPicks: sanitizeStatPicks(o.statPicks),
    legendPos: LEGEND_POS.includes(o.legendPos as LegendPos) ? (o.legendPos as LegendPos) : fb.legendPos,
    legendXY: legendXYOrNull(o.legendXY),
    legendSize: sanitizeLegendSize(o.legendSize),
    // Same fraction shape + clamp-not-drop convention as `legendXY` (decode #52).
    legendFrameXY: legendXYOrNull(o.legendFrameXY),
    legendTitle: typeof o.legendTitle === "string" ? o.legendTitle : null,
    axisLabelOffsets: axisLabelOffsetsOrDefault(o.axisLabelOffsets),
    axisLabelStyles: axisLabelStylesOrDefault(o.axisLabelStyles),
    plotTemplate: strOrDefault(o.plotTemplate, fb.plotTemplate),
    xLim: sanitizeHalfLim(o.xLim), yLim: sanitizeHalfLim(o.yLim), // half-open survives reopen
    xStep: numOrNull(o.xStep),
    yStep: numOrNull(o.yStep),
    xFmt: isAxisFormat(o.xFmt) ? o.xFmt : fb.xFmt,
    yFmt: isAxisFormat(o.yFmt) ? o.yFmt : fb.yFmt,
    y2Fmt: isAxisFormat(o.y2Fmt) ? o.y2Fmt : fb.y2Fmt,
    plotTitle: strOrDefault(o.plotTitle, fb.plotTitle),
    xAxisLabel: strOrDefault(o.xAxisLabel, fb.xAxisLabel),
    yAxisLabel: strOrDefault(o.yAxisLabel, fb.yAxisLabel),
    xKey: numOrNull(o.xKey),
    yKeys: Array.isArray(o.yKeys) ? o.yKeys.filter((n): n is number => typeof n === "number") : null,
    groupKey: numOrNull(o.groupKey),
    facetKey: numOrNull(o.facetKey),
    y2Keys: Array.isArray(o.y2Keys) ? o.y2Keys.filter((n): n is number => typeof n === "number") : null,
    y2Lim: isRange(o.y2Lim) ? o.y2Lim : null,
    y2Scale: y2ScaleOrDefault(o.y2Scale, o.y2Log),
    y2Step: numOrNull(o.y2Step),
    y2AxisLabel: strOrDefault(o.y2AxisLabel, fb.y2AxisLabel),
    refLines: uniqueIds(Array.isArray(o.refLines) ? (o.refLines as RefLine[]) : []),
    annotations: uniqueIds(sanitizeAnnotations(o.annotations)),
    regionShades: uniqueIds(sanitizeRegionShades(o.regionShades)),
    shapes: uniqueIds(sanitizeShapes(o.shapes)),
    seriesStyles:
      typeof o.seriesStyles === "object" && o.seriesStyles !== null
        ? (o.seriesStyles as Record<number, SeriesStyle>)
        : {},
    // Values VALIDATED, not cast — see `lib/sanitizeRecord.ts` (BUG-014 r4).
    seriesLabels: keyedRecord<string, number>(o.seriesLabels, isString),
    errKeys:
      typeof o.errKeys === "object" && o.errKeys !== null ? (o.errKeys as Record<number, number>) : {},
    seriesOrder: Array.isArray(o.seriesOrder) ? o.seriesOrder.filter((n): n is number => typeof n === "number") : null,
    hiddenChannels: Array.isArray(o.hiddenChannels)
      ? o.hiddenChannels.filter((n): n is number => typeof n === "number")
      : [],
    waterfall: num(o.waterfall, fb.waterfall),
    waterfallDx: num(o.waterfallDx, fb.waterfallDx), // additive: an older .dwk has none -> 0
    // Unknown/absent (a pre-#54 .dwk) -> "frames", the PR #47 letterbox default.
    panelFit: PANEL_FITS.includes(o.panelFit as PanelFit) ? (o.panelFit as PanelFit) : fb.panelFit,
    // null (absent = today's no-page behaviour) or a clamped page model.
    pageSetup: sanitizePageSetup(o.pageSetup),
  };
}
