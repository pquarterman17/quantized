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

import { sanitizeFrozenBundle, type FrozenPlotBundle } from "./plotsnapshot";
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

const PLOT_BG_CYCLE: readonly PlotBg[] = ["theme", "light", "dark"];

/** The next background mode in the title-bar toggle's cycle
 *  (theme -> light -> dark -> theme -> ...). Pure; used by both the
 *  per-window toggle button (`PlotWindowFrame`) and the "Window Background"
 *  command (`useWindowCommands`). */
export function nextPlotBg(current: PlotBg): PlotBg {
  return PLOT_BG_CYCLE[(PLOT_BG_CYCLE.indexOf(current) + 1) % PLOT_BG_CYCLE.length];
}

/** The highest cross-window link group (item 13) — three groups is the
 *  Origin-ish sweet spot: enough for two or three simultaneous comparisons,
 *  few enough that a single toggle button can cycle through all of them. */
const MAX_LINK_GROUP = 3;

/** The next link group in the title-bar toggle's cycle
 *  (null -> 1 -> 2 -> 3 -> null -> ...) — item 13's `nextPlotBg` analogue.
 *  Pure; used by both the per-window ⧟ button (`PlotWindowFrame`) and the
 *  "Link Window Group" command (`useWindowCommands`). */
export function nextLinkGroup(current: number | null): number | null {
  if (current === null) return 1;
  return current >= MAX_LINK_GROUP ? null : current + 1;
}

/** The window-kind discriminator (item 17 completes the set): `"plot"` is the
 *  live XY graph window (the only kind that can hold the view-facade focus);
 *  `"snapshot"` (item 11) is a static frozen-payload compare window;
 *  `"worksheet"` / `"map"` (item 17 — full Origin-style MDI) are floating
 *  DOCUMENT windows hosting the same components the stage tabs mount
 *  (`WorksheetPane` / `MapStage`), LIVE-bound to a dataset (unlike a
 *  snapshot: dataset removal nulls the binding, an explicit drop rebinds).
 *  Every non-plot kind follows the snapshot focus model — `focusedWindowId`
 *  always points at a `kind:"plot"` window; `focusWindow` on the others only
 *  raises their z, and Ctrl+Tab cycling skips them. */
export type WindowKind = "plot" | "snapshot" | "worksheet" | "map";

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

/** Geometry for a window created by DROPPING a dataset onto empty canvas
 *  (item 14): a default-sized window whose top-left lands at the drop point,
 *  clamped so the whole frame stays inside `bounds` (a drop near the right/
 *  bottom edge slides back on-canvas rather than spawning half off-screen;
 *  a canvas smaller than the default size degrades to 0,0). Pure — the
 *  store's `createWindowAt` applies it against the live canvas bounds. */
export function dropGeometry(
  x: number,
  y: number,
  bounds: { width: number; height: number },
): WindowGeometry {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, bounds.width - DEFAULT_WIDTH)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.height - DEFAULT_HEIGHT)),
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
const PLOT_BGS: readonly PlotBg[] = ["theme", "light", "dark"];
const WINDOW_KINDS: readonly WindowKind[] = ["plot", "snapshot", "worksheet", "map"];

// ── Tile / Cascade / z-order-aware focus cycling (item 6) ──────────────────

const TILE_GUTTER = 6;
const TILE_MIN_W = 200;
const TILE_MIN_H = 140;

/** An even grid layout for `count` windows inside `bounds` (roughly square —
 *  cols = ceil(sqrt(count))) — the pure geometry behind the "Tile Windows"
 *  command. Fills row-major; an incomplete last row simply leaves its unused
 *  cells empty (standard grid-tile behaviour) rather than stretching cells to
 *  fill the gap. Cell size is floored at a sane minimum so a large `count`
 *  against a small `bounds` degrades to overlapping-but-usable cells instead
 *  of collapsing to zero. */
export function tileLayout(count: number, bounds: { width: number; height: number }): WindowGeometry[] {
  if (count <= 0) return [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = Math.max(TILE_MIN_W, (bounds.width - TILE_GUTTER * (cols + 1)) / cols);
  const cellH = Math.max(TILE_MIN_H, (bounds.height - TILE_GUTTER * (rows + 1)) / rows);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      x: TILE_GUTTER + col * (cellW + TILE_GUTTER),
      y: TILE_GUTTER + row * (cellH + TILE_GUTTER),
      w: cellW,
      h: cellH,
    };
  });
}

/** A cascade layout for ALL `count` windows at once (item 6's "Cascade
 *  Windows" command) — distinct from `cascadeGeometry` above, which places
 *  only ONE new window at a given index. Reuses the same offset step so
 *  cascading N windows looks identical to N windows each freshly created in
 *  turn via `cascadeGeometry`. */
export function cascadeLayout(count: number): WindowGeometry[] {
  return Array.from({ length: count }, (_, i) => cascadeGeometry(i));
}

/** Window ids in Z-order, back-to-front (ascending z) — the item-6 upgrade to
 *  focus cycling, replacing v1's plain creation-order input to `cycleWindow`.
 *  A stable sort, so windows that have never been raised (equal z) keep their
 *  creation order — identical to v1 in the common case where nothing has
 *  been raised yet. */
export function zOrderIds(windows: readonly PlotWindow[]): string[] {
  return [...windows].sort((a, b) => a.z - b.z).map((w) => w.id);
}

// ── Default window titles + rename dedupe (item 10) ─────────────────────────

/** The title a window CURRENTLY displays — matches `PlotWindowFrame`'s own
 *  fallback chain (explicit title, else its bound dataset's name, else
 *  "Untitled graph") so a fresh window's computed default can be deduped
 *  against what's already showing. */
export function displayedWindowTitle(
  win: Pick<PlotWindow, "title" | "datasetId">,
  datasets: readonly { id: string; name: string }[],
): string {
  if (win.title) return win.title;
  const name = win.datasetId ? datasets.find((d) => d.id === win.datasetId)?.name : undefined;
  return name || "Untitled graph";
}

/** A default title for a NEW window named `baseName`, deduped against
 *  `existingTitles` (each already resolved via `displayedWindowTitle`) by
 *  appending " (2)", " (3)", … — so two windows that would otherwise show the
 *  identical name (e.g. two windows bound to the same dataset) are
 *  distinguishable at a glance (item 10). A user's own explicit rename
 *  (`renameWindow`) is never deduped — this only applies to computed
 *  defaults at creation time. */
export function dedupeWindowTitle(baseName: string, existingTitles: readonly string[]): string {
  if (!existingTitles.includes(baseName)) return baseName;
  let n = 2;
  while (existingTitles.includes(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

/** Validate persisted plot windows (drop malformed entries; clamp dead
 *  dataset refs to null — never drop the window itself, see decision #4;
 *  clamp geometry to finite, non-negative numbers). Never throws. */
export function sanitizePlotWindows(v: unknown, dsIds: ReadonlySet<string>): PlotWindow[] {
  if (!Array.isArray(v)) return [];
  const out: PlotWindow[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !WINDOW_KINDS.includes(o.kind as WindowKind)) continue;
    const kind = o.kind as WindowKind;
    // A snapshot window (item 11) IS its at-rest frozen bundle — with nothing
    // live to fall back to, a malformed bundle drops the whole entry (still
    // never throws; the per-field-fallback discipline applies inside). The
    // item-17 worksheet/map kinds carry no bundle — they're LIVE documents,
    // so the ordinary datasetId clamp below is all they need.
    const snapshot = kind === "snapshot" ? sanitizeFrozenBundle(o.snapshot) : null;
    if (kind === "snapshot" && !snapshot) continue;
    const g = (typeof o.geometry === "object" && o.geometry !== null ? o.geometry : {}) as Record<
      string,
      unknown
    >;
    const datasetId = typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    out.push({
      id: o.id,
      kind,
      title: strOrDefault(o.title, ""),
      // A snapshot window is never dataset-bound (frozen means frozen).
      datasetId: kind === "snapshot" ? null : datasetId,
      geometry: {
        x: num(g.x, 0),
        y: num(g.y, 0),
        w: Math.max(1, num(g.w, DEFAULT_WIDTH)),
        h: Math.max(1, num(g.h, DEFAULT_HEIGHT)),
      },
      z: num(o.z, 0),
      winState: WIN_STATES.includes(o.winState as WinState) ? (o.winState as WinState) : "normal",
      view: sanitizeView(o.view),
      bg: PLOT_BGS.includes(o.bg as PlotBg) ? (o.bg as PlotBg) : "theme",
      linkGroup:
        typeof o.linkGroup === "number" && Number.isInteger(o.linkGroup) && o.linkGroup >= 1
          ? o.linkGroup
          : null,
      pinned: boolOrDefault(o.pinned, false),
      ...(snapshot ? { snapshot } : {}),
    });
  }
  return out;
}

// ── Edge / sibling snapping while dragging (item 12) ────────────────────────

/** How close (px) a window edge must be to a snap line before it snaps. */
export const SNAP_THRESHOLD = 8;

/** All the vertical (`v`) and horizontal (`h`) snap lines a dragged window
 *  can land on: the canvas edges plus BOTH edges of every sibling rect on
 *  each axis — one flat pool per axis, so edge-ALIGN (our left on a
 *  sibling's left) and ABUT (our left on a sibling's right) fall out of the
 *  same comparison instead of being separate cases. */
function collectSnapLines(
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
): { v: number[]; h: number[] } {
  const v: number[] = bounds ? [0, bounds.width] : [];
  const h: number[] = bounds ? [0, bounds.height] : [];
  for (const s of siblings) {
    v.push(s.x, s.x + s.w);
    h.push(s.y, s.y + s.h);
  }
  return { v, h };
}

/** The adjustment that moves the best of `edges` onto the nearest of `lines`,
 *  or 0 when nothing is within `threshold` — the NEAREST candidate wins
 *  across all edge×line pairs on this axis. */
function snapDelta(edges: readonly number[], lines: readonly number[], threshold: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const edge of edges) {
    for (const line of lines) {
      const d = line - edge;
      const dist = Math.abs(d);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
  }
  return best;
}

/** Snap a MOVE gesture's proposed geometry: either vertical edge (left OR
 *  right) may pull `x`, either horizontal edge (top OR bottom) may pull `y`
 *  — the two axes snap independently. Returns the snapped position only (a
 *  move never changes size). Pure; `PlotWindowFrame` applies this before its
 *  clamp + rAF-throttled store write, and skips it while Alt is held (the
 *  standard window-manager convention). */
export function snapMovePosition(
  proposed: WindowGeometry,
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
  threshold: number = SNAP_THRESHOLD,
): { x: number; y: number } {
  const lines = collectSnapLines(bounds, siblings);
  return {
    x: proposed.x + snapDelta([proposed.x, proposed.x + proposed.w], lines.v, threshold),
    y: proposed.y + snapDelta([proposed.y, proposed.y + proposed.h], lines.h, threshold),
  };
}

/** Snap a RESIZE gesture's proposed geometry: only the MOVING edges — the
 *  right (`x+w`) and bottom (`y+h`), matching the frame's single bottom-right
 *  grip — may pull `w`/`h`; the anchored left/top edges never snap. Returns
 *  the snapped size only (a resize never changes position). */
export function snapResizeSize(
  proposed: WindowGeometry,
  bounds: { width: number; height: number } | undefined,
  siblings: readonly WindowGeometry[],
  threshold: number = SNAP_THRESHOLD,
): { w: number; h: number } {
  const lines = collectSnapLines(bounds, siblings);
  return {
    w: proposed.w + snapDelta([proposed.x + proposed.w], lines.v, threshold),
    h: proposed.h + snapDelta([proposed.y + proposed.h], lines.h, threshold),
  };
}
