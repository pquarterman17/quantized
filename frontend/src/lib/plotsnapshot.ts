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
//    into its in-memory at-rest shape (`Map` error bars → entries;
//    `undefined` array holes → null). The workspace persistence seam applies
//    the BUG-017 numeric codec at the `.dwk` JSON boundary, and
//    `sanitizeFrozenBundle` decodes/validates it on read. The `thaw*` helpers
//    convert back to the render-side shapes `PlotViewport` expects.
//
// Pure lib module — no store import (the command layer in
// `components/windows/useWindowCommands.ts` wires the two ends together).

import type { ColorScatterSpec } from "./colorscatter";
import { decodeCell } from "./nonFiniteCells";
import type { PlotPayload, PlotSeriesSpec } from "./plotdata";
import type { SeriesStyle } from "./types";

const mapNullish = <T, U>(list: readonly T[] | null | undefined, fallback: U) =>
  list ? list.map((item) => item ?? fallback) : fallback;

/** The focused plot's live composed display bundle — field-for-field the
 *  slice of `usePlotPayload`'s result that `PlotViewport` renders from, with one
 *  documented exception: `styleList` below. */
export interface LivePlotSnapshot {
  payload: PlotPayload;
  /** `usePlotPayload`'s style list with the P3.3 auto dash/marker cycle already
   *  RESOLVED into it (`Stage/useLiveSnapshotPublish.ts` applies
   *  `resolveSeriesStyle` before publishing). Frozen means frozen: a snapshot
   *  window passes no cycle and must not re-derive one, or a plot snapshotted
   *  while the preference was on would turn solid the moment it was turned off.
   *  With the preference off the resolver is the identity and this is the
   *  caller's own array, unchanged. */
  styleList: (SeriesStyle | undefined)[] | undefined;
  labelList: (string | undefined)[] | undefined;
  errorBars: Map<number, (number | null)[]>;
  /** Dataset-channel index per plotted display-series — needed to resolve a
   *  fill `{vs: channel}` band the same way the live plot does (MAIN #13). */
  plotted: number[];
  /** Colour-mapped-scatter specs (MAIN #14) — without these, a frozen
   *  `colorBy` series would draw nothing at all (its native points are
   *  hidden and nothing would supply the plugin's per-point colours). */
  colorByColumns: Map<number, ColorScatterSpec>;
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
  plotted: number[];
  colorByColumns: [number, ColorScatterSpec][];
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
  return structuredClone({
    ...s,
    styleList: mapNullish(s.styleList, null),
    labelList: mapNullish(s.labelList, null),
    errorBars: [...s.errorBars],
    colorByColumns: [...s.colorByColumns],
    hidden: s.hidden ?? null,
  });
}

/** Frozen entries back to the `Map` shape `PlotViewport` expects. */
export const thawEntries = <T>(entries: readonly (readonly [number, T])[]) => new Map(entries);

/** Frozen null-normalized lists back to their `undefined`-holed render shape. */
export const thawList = <T>(list: (T | null)[] | null): (T | undefined)[] | undefined =>
  mapNullish(list, undefined);

// ── Untrusted-boundary sanitizer (called by lib/plotview's
//    sanitizePlotWindows for kind:"snapshot" entries) ────────────────────────

function persistedCell(v: unknown): number | null {
  return decodeCell(v) ?? null;
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
  const data = (p.data as unknown[][]).map((col) => col.map(persistedCell));
  const xCategories = Array.isArray(p.xCategories)
    ? p.xCategories.filter((s): s is string => typeof s === "string")
    : undefined;
  const errorBars: [number, (number | null)[]][] = [];
  if (Array.isArray(o.errorBars)) {
    for (const e of o.errorBars) {
      if (Array.isArray(e) && e.length === 2 && typeof e[0] === "number" && Array.isArray(e[1])) {
        errorBars.push([e[0], (e[1] as unknown[]).map(persistedCell)]);
      }
    }
  }
  const plotted = Array.isArray(o.plotted)
    ? o.plotted.filter((n): n is number => typeof n === "number")
    : [];
  const colorByColumns: [number, ColorScatterSpec][] = [];
  if (Array.isArray(o.colorByColumns)) {
    for (const e of o.colorByColumns) {
      if (
        Array.isArray(e) &&
        e.length === 2 &&
        typeof e[0] === "number" &&
        typeof e[1] === "object" &&
        e[1] !== null
      ) {
        const spec = e[1] as Record<string, unknown>;
        if (
          Array.isArray(spec.z) &&
          typeof spec.channel === "number" &&
          typeof spec.colormap === "string" &&
          typeof spec.lo === "number" &&
          typeof spec.hi === "number"
        ) {
          colorByColumns.push([
            e[0],
            {
              channel: spec.channel,
              colormap: spec.colormap as ColorScatterSpec["colormap"],
              lo: spec.lo,
              hi: spec.hi,
              z: (spec.z as unknown[]).map(persistedCell),
            },
          ]);
        }
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
    plotted,
    colorByColumns,
    hidden: Array.isArray(o.hidden) ? o.hidden.map((h) => h === true) : null,
  };
}
