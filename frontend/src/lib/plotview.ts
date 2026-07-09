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

import type { Annotation, AxisFormat, RefLine, SeriesStyle } from "./types";

export type LegendPos = "ne" | "nw" | "se" | "sw";

/** One plot's full display configuration — everything that differs window to
 *  window. See the module doc above for what's deliberately excluded. */
export interface PlotView {
  yLog: boolean;
  xLog: boolean;
  showGrid: boolean;
  showLegend: boolean;
  legendPos: LegendPos;
  plotTemplate: string;
  showAxisBox: boolean;
  stackMode: boolean;
  insetMode: boolean;
  polarMode: boolean;
  statMode: boolean;
  xLim: [number, number] | null;
  yLim: [number, number] | null;
  xStep: number | null;
  yStep: number | null;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  plotTitle: string;
  xAxisLabel: string;
  yAxisLabel: string;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  y2Lim: [number, number] | null;
  y2Log: boolean | null;
  y2Step: number | null;
  y2AxisLabel: string;
  refLines: RefLine[];
  annotations: Annotation[];
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  waterfall: number;
}

/** A fresh view — what a brand-new window starts from. Mirrors the store's
 *  own initial state for these fields, so the app's very first (sole,
 *  maximized) window is indistinguishable from "no windows yet" — the
 *  migration guarantee in MULTI_PLOT_PLAN's decision #6. */
export function defaultPlotView(): PlotView {
  return {
    yLog: false,
    xLog: false,
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    plotTemplate: "screen",
    showAxisBox: false,
    stackMode: false,
    insetMode: false,
    polarMode: false,
    statMode: false,
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    y2Lim: null,
    y2Log: null,
    y2Step: null,
    y2AxisLabel: "",
    refLines: [],
    annotations: [],
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    waterfall: 0,
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

/** A plot window's persistent record: geometry/z/winState (the MDI chrome
 *  state — item 3), a dataset binding (by id; nulled, never force-closed, when
 *  that dataset is removed — MULTI_PLOT_PLAN decision #4), and its own
 *  `PlotView` (swapped with the live singleton fields only while focused). The
 *  `kind` discriminator carries the door open for future window kinds
 *  (worksheet/map — item 17) without a model change. */
export interface PlotWindow {
  id: string;
  kind: "plot";
  title: string;
  datasetId: string | null;
  geometry: WindowGeometry;
  z: number;
  winState: WinState;
  view: PlotView;
}

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 360;
const CASCADE_ORIGIN = 40;
const CASCADE_STEP = 24;

/** A cascade-offset geometry for the `index`-th new "normal" window (0-based) —
 *  Origin/typical-MDI "new window" placement so successive windows don't stack
 *  exactly on top of one another. Pure; item 6 builds real tile/cascade
 *  commands on top of this. */
export function cascadeGeometry(index: number): WindowGeometry {
  const n = Math.max(0, index);
  return {
    x: CASCADE_ORIGIN + n * CASCADE_STEP,
    y: CASCADE_ORIGIN + n * CASCADE_STEP,
    w: DEFAULT_WIDTH,
    h: DEFAULT_HEIGHT,
  };
}

/** The next/previous window id in `ids` order, wrapping — the pure cycling
 *  step behind the "Focus Next/Previous Window" commands (item 5). v1 cycles
 *  by array (creation) order; item 6's Tier-2 Ctrl+Tab upgrade makes this
 *  z-order-aware instead. Returns null when there's nothing to cycle to
 *  (fewer than 2 windows, or `currentId` isn't among `ids`). */
export function cycleWindow(
  ids: readonly string[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (ids.length < 2 || currentId === null) return null;
  const i = ids.indexOf(currentId);
  if (i < 0) return null;
  return ids[(i + direction + ids.length) % ids.length];
}

// ── .dwk / untrusted-boundary sanitizer (wired by item 7) ──────────────────

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function boolOrDefault(v: unknown, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

function strOrDefault(v: unknown, d: string): string {
  return typeof v === "string" ? v : d;
}

function isRange(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function isAxisFormat(v: unknown): v is AxisFormat {
  return typeof v === "object" && v !== null && typeof (v as { mode?: unknown }).mode === "string";
}

const LEGEND_POS: readonly LegendPos[] = ["ne", "nw", "se", "sw"];

/** Validate a persisted view (or drop back to `defaultPlotView()` field by
 *  field) — the same per-field-fallback discipline as `loadPrefs`/
 *  `sanitizeFigureDocs`. Never throws on malformed input. */
function sanitizeView(v: unknown): PlotView {
  const fb = defaultPlotView();
  if (typeof v !== "object" || v === null) return fb;
  const o = v as Record<string, unknown>;
  return {
    yLog: boolOrDefault(o.yLog, fb.yLog),
    xLog: boolOrDefault(o.xLog, fb.xLog),
    showGrid: boolOrDefault(o.showGrid, fb.showGrid),
    showLegend: boolOrDefault(o.showLegend, fb.showLegend),
    legendPos: LEGEND_POS.includes(o.legendPos as LegendPos) ? (o.legendPos as LegendPos) : fb.legendPos,
    plotTemplate: strOrDefault(o.plotTemplate, fb.plotTemplate),
    showAxisBox: boolOrDefault(o.showAxisBox, fb.showAxisBox),
    stackMode: boolOrDefault(o.stackMode, fb.stackMode),
    insetMode: boolOrDefault(o.insetMode, fb.insetMode),
    polarMode: boolOrDefault(o.polarMode, fb.polarMode),
    statMode: boolOrDefault(o.statMode, fb.statMode),
    xLim: isRange(o.xLim) ? o.xLim : null,
    yLim: isRange(o.yLim) ? o.yLim : null,
    xStep: numOrNull(o.xStep),
    yStep: numOrNull(o.yStep),
    xFmt: isAxisFormat(o.xFmt) ? o.xFmt : fb.xFmt,
    yFmt: isAxisFormat(o.yFmt) ? o.yFmt : fb.yFmt,
    plotTitle: strOrDefault(o.plotTitle, fb.plotTitle),
    xAxisLabel: strOrDefault(o.xAxisLabel, fb.xAxisLabel),
    yAxisLabel: strOrDefault(o.yAxisLabel, fb.yAxisLabel),
    xKey: numOrNull(o.xKey),
    yKeys: Array.isArray(o.yKeys) ? o.yKeys.filter((n): n is number => typeof n === "number") : null,
    y2Keys: Array.isArray(o.y2Keys) ? o.y2Keys.filter((n): n is number => typeof n === "number") : null,
    y2Lim: isRange(o.y2Lim) ? o.y2Lim : null,
    y2Log: typeof o.y2Log === "boolean" ? o.y2Log : null,
    y2Step: numOrNull(o.y2Step),
    y2AxisLabel: strOrDefault(o.y2AxisLabel, fb.y2AxisLabel),
    refLines: Array.isArray(o.refLines) ? (o.refLines as RefLine[]) : [],
    annotations: Array.isArray(o.annotations) ? (o.annotations as Annotation[]) : [],
    seriesStyles:
      typeof o.seriesStyles === "object" && o.seriesStyles !== null
        ? (o.seriesStyles as Record<number, SeriesStyle>)
        : {},
    seriesLabels:
      typeof o.seriesLabels === "object" && o.seriesLabels !== null
        ? (o.seriesLabels as Record<number, string>)
        : {},
    errKeys:
      typeof o.errKeys === "object" && o.errKeys !== null ? (o.errKeys as Record<number, number>) : {},
    seriesOrder: Array.isArray(o.seriesOrder) ? o.seriesOrder.filter((n): n is number => typeof n === "number") : null,
    hiddenChannels: Array.isArray(o.hiddenChannels)
      ? o.hiddenChannels.filter((n): n is number => typeof n === "number")
      : [],
    waterfall: num(o.waterfall, fb.waterfall),
  };
}

const WIN_STATES: readonly WinState[] = ["normal", "minimized", "maximized"];

/** Validate persisted plot windows (drop malformed entries; clamp dead
 *  dataset refs to null — never drop the window itself, see decision #4;
 *  clamp geometry to finite, non-negative numbers). Never throws. */
export function sanitizePlotWindows(v: unknown, dsIds: ReadonlySet<string>): PlotWindow[] {
  if (!Array.isArray(v)) return [];
  const out: PlotWindow[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || o.kind !== "plot") continue;
    const g = (typeof o.geometry === "object" && o.geometry !== null ? o.geometry : {}) as Record<
      string,
      unknown
    >;
    const datasetId = typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    out.push({
      id: o.id,
      kind: "plot",
      title: strOrDefault(o.title, ""),
      datasetId,
      geometry: {
        x: num(g.x, 0),
        y: num(g.y, 0),
        w: Math.max(1, num(g.w, DEFAULT_WIDTH)),
        h: Math.max(1, num(g.h, DEFAULT_HEIGHT)),
      },
      z: num(o.z, 0),
      winState: WIN_STATES.includes(o.winState as WinState) ? (o.winState as WinState) : "normal",
      view: sanitizeView(o.view),
    });
  }
  return out;
}
