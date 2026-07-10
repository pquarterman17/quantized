// Snapshot-as-window (MULTI_PLOT_PLAN Tier 3 item 11): freeze the focused
// window's CURRENT composed display payload into a static "compare" window —
// the ⎘ raster-snapshot tool's natural upgrade, following the FigureDoc
// frozen-data precedent (lib/figuredoc.ts). Two halves live here:
//
// 1. The LIVE seam: `PlotStage` publishes its composed display bundle
//    (payload + the per-series style/label/error/hidden mappings — exactly
//    the slice of `usePlotPayload`'s output that `PlotViewport` renders) into
//    a module-scope ref on every change. An imperative write, NOT store
//    state, so publishing causes zero re-renders/store churn; the "Snapshot
//    to New Window" command reads it back at trigger time.
//
// 2. The FROZEN bundle: `freezePlotSnapshot` deep-copies the live bundle
//    into a JSON-safe value (`Map` error bars → entries; `undefined` array
//    holes → null) so a snapshot window rides the existing `.dwk`
//    `plotWindows` persistence unchanged. `sanitizeFrozenBundle` is its
//    untrusted-.dwk-boundary validator (drop-on-malformed, never throw — the
//    `sanitizePlotWindows` discipline), and the `thaw*` helpers convert back
//    to the render-side shapes `PlotViewport` expects.
//
// Pure lib module — no store import (the command layer in
// `components/windows/useWindowCommands.ts` wires the two ends together).

import type { PlotPayload, PlotSeriesSpec } from "./plotdata";
import type { SeriesStyle } from "./types";

/** The focused plot's live composed display bundle — field-for-field the
 *  slice of `usePlotPayload`'s result that `PlotViewport` renders from. */
export interface LivePlotSnapshot {
  payload: PlotPayload;
  styleList: (SeriesStyle | undefined)[] | undefined;
  labelList: (string | undefined)[] | undefined;
  errorBars: Map<number, (number | null)[]>;
  hidden: boolean[] | undefined;
}

/** The JSON-safe at-rest form carried on a `kind:"snapshot"` window record
 *  (`PlotWindow.snapshot`): `Map` → entry pairs, `undefined` → null (JSON
 *  drops/rewrites `undefined`, so the round-trip must never rely on it). */
export interface FrozenPlotBundle {
  payload: PlotPayload;
  styleList: (SeriesStyle | null)[] | null;
  labelList: (string | null)[] | null;
  errorBars: [number, (number | null)[]][];
  hidden: boolean[] | null;
}

// ── The live seam (written by PlotStage, read by the snapshot command) ──────

let _live: LivePlotSnapshot | null = null;

/** Publish (or clear, with null) the focused plot's current composed display
 *  bundle. Called from a `PlotStage` effect — the ONLY writer. */
export function publishLivePlotSnapshot(s: LivePlotSnapshot | null): void {
  _live = s;
}

/** The bundle currently on screen, or null when no live XY plot is showing
 *  (no dataset, an alternate render mode, or the Plot tab isn't mounted). */
export function readLivePlotSnapshot(): LivePlotSnapshot | null {
  return _live;
}

// ── Freeze / thaw ───────────────────────────────────────────────────────────

/** Deep-copy the live bundle into its JSON-safe frozen form. Fresh arrays and
 *  objects throughout — frozen means frozen: nothing the live pipeline later
 *  does to its own arrays can reach back into a snapshot window's record. */
export function freezePlotSnapshot(s: LivePlotSnapshot): FrozenPlotBundle {
  const cols = s.payload.data as (number | null)[][];
  return {
    payload: {
      data: cols.map((col) => [...col]) as PlotPayload["data"],
      series: s.payload.series.map((sp) => ({ ...sp })),
      xLabel: s.payload.xLabel,
      xUnit: s.payload.xUnit,
      ...(s.payload.xCategories ? { xCategories: [...s.payload.xCategories] } : {}),
    },
    styleList: s.styleList ? s.styleList.map((st) => (st ? { ...st } : null)) : null,
    labelList: s.labelList ? s.labelList.map((l) => l ?? null) : null,
    errorBars: [...s.errorBars.entries()].map(([k, col]) => [k, [...col]]),
    hidden: s.hidden ? [...s.hidden] : null,
  };
}

/** Frozen error-bar entries back to the `Map` shape `PlotViewport` expects. */
export function thawErrorBars(entries: FrozenPlotBundle["errorBars"]): Map<number, (number | null)[]> {
  return new Map(entries);
}

/** Frozen null-normalized style list back to the `undefined`-holed render
 *  shape (`BuildOptsArgs.seriesStyles`). */
export function thawStyleList(
  list: FrozenPlotBundle["styleList"],
): (SeriesStyle | undefined)[] | undefined {
  return list ? list.map((st) => st ?? undefined) : undefined;
}

/** Frozen null-normalized label list back to the render shape. */
export function thawLabelList(list: FrozenPlotBundle["labelList"]): (string | undefined)[] | undefined {
  return list ? list.map((l) => l ?? undefined) : undefined;
}

// ── Untrusted-boundary sanitizer (called by lib/plotview's
//    sanitizePlotWindows for kind:"snapshot" entries) ────────────────────────

function isCell(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

/** Validate a persisted frozen bundle. Returns null when the core payload is
 *  malformed (a snapshot window IS its at-rest payload — with nothing live to
 *  fall back to, the whole window entry is dropped by the caller); optional
 *  decorations (styles/labels/error bars/hidden) degrade to null/empty
 *  instead. Never throws. */
export function sanitizeFrozenBundle(v: unknown): FrozenPlotBundle | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.payload !== "object" || o.payload === null) return null;
  const p = o.payload as Record<string, unknown>;
  if (!Array.isArray(p.data) || !p.data.every((col) => Array.isArray(col))) return null;
  if (!Array.isArray(p.series)) return null;
  // The payload contract: data = [x, ...one column per series].
  if (p.data.length !== p.series.length + 1) return null;
  const series: PlotSeriesSpec[] = [];
  for (const sp of p.series) {
    if (typeof sp !== "object" || sp === null) return null;
    const so = sp as Record<string, unknown>;
    if (typeof so.label !== "string") return null;
    series.push({
      label: so.label,
      unit: typeof so.unit === "string" ? so.unit : "",
      ...(so.kind === "line" || so.kind === "points" ? { kind: so.kind } : {}),
      ...(typeof so.axis === "number" ? { axis: so.axis } : {}),
      ...(typeof so.muted === "boolean" ? { muted: so.muted } : {}),
      ...(typeof so.selected === "boolean" ? { selected: so.selected } : {}),
    });
  }
  const data = (p.data as unknown[][]).map((col) => col.map((cell) => (isCell(cell) ? cell : null)));
  const xCategories = Array.isArray(p.xCategories)
    ? p.xCategories.filter((s): s is string => typeof s === "string")
    : undefined;
  const errorBars: [number, (number | null)[]][] = [];
  if (Array.isArray(o.errorBars)) {
    for (const e of o.errorBars) {
      if (Array.isArray(e) && e.length === 2 && typeof e[0] === "number" && Array.isArray(e[1])) {
        errorBars.push([e[0], (e[1] as unknown[]).map((cell) => (isCell(cell) ? cell : null))]);
      }
    }
  }
  return {
    payload: {
      data: data as PlotPayload["data"],
      series,
      xLabel: typeof p.xLabel === "string" ? p.xLabel : "x",
      xUnit: typeof p.xUnit === "string" ? p.xUnit : "",
      ...(xCategories ? { xCategories } : {}),
    },
    // Structural passthrough for the style objects themselves — the same
    // cast-not-deep-validate precedent sanitizeView uses for seriesStyles.
    styleList: Array.isArray(o.styleList)
      ? o.styleList.map((st) => (typeof st === "object" && st !== null ? (st as SeriesStyle) : null))
      : null,
    labelList: Array.isArray(o.labelList)
      ? o.labelList.map((l) => (typeof l === "string" ? l : null))
      : null,
    errorBars,
    hidden: Array.isArray(o.hidden) ? o.hidden.map((h) => h === true) : null,
  };
}
