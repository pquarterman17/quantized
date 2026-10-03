// Plot-window helpers moved verbatim out of lib/plotview.ts (module-size
// ratchet): MDI placement, tile/cascade, focus cycling, default titles, the
// bg/link-group cycles (all re-exported from lib/plotview.ts, so no importer
// changed) and the persisted plot-window list sanitizer (`.dwk` / autosave
// restore). Pure — the record TYPES stay in lib/plotview.ts.

import { sanitizePanelDatasetIds, sanitizePanelLayout } from "./panelWindowModel";
import { sanitizeFrozenBundle } from "./plotsnapshot";
import { num, sanitizePlotView, strOrDefault, type PlotBg, type PlotWindow, type WindowGeometry, type WindowKind, type WinState } from "./plotview";

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
export const MAX_LINK_GROUP = 3;

/** The next link group in the title-bar toggle's cycle
 *  (null -> 1 -> 2 -> 3 -> null -> ...) — item 13's `nextPlotBg` analogue.
 *  Pure; used by both the per-window ⧟ button (`PlotWindowFrame`) and the
 *  "Link Window Group" command (`useWindowCommands`). */
export function nextLinkGroup(current: number | null): number | null {
  if (current === null) return 1;
  return current >= MAX_LINK_GROUP ? null : current + 1;
}

export const DEFAULT_WIDTH = 480;
export const DEFAULT_HEIGHT = 360;
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


const WIN_STATES: readonly WinState[] = ["normal", "minimized", "maximized"];
const PLOT_BGS: readonly PlotBg[] = ["theme", "light", "dark"];
const WINDOW_KINDS: readonly WindowKind[] = ["plot", "snapshot", "worksheet", "map", "panel"];

// LIBRARY_WORKBOOK_UX_PLAN PR E2 ("oversized window coordinates") — how far
// off the right/bottom edge a restored window's position may sail before
// its top-left becomes permanently unreachable (a workspace saved on a big
// monitor must not restore a window the user can never grab back on a
// smaller one; applies to every winState, see sanitizePlotWindows's doc).
// Mirrors lib/toolwindow.ts's clampToolWindowPos margin discipline, but
// clamps the UPPER bound only: this function's own pre-existing "clamps
// non-finite/negative geometry to sane defaults" test pins that a negative
// x/y is left alone (already a valid on-screen position — partially off the
// left/top edge, same as any live drag can stop short of); this only guards
// the direction restoring onto a smaller viewport can actually overflow
// toward.
const RESTORE_POSITION_MARGIN = 40;

function clampRestoreAxis(pos: number, viewport: number): number {
  if (!Number.isFinite(viewport) || viewport <= RESTORE_POSITION_MARGIN) return pos;
  return Math.min(pos, viewport - RESTORE_POSITION_MARGIN);
}

/** Validate persisted plot windows (drop malformed entries; clamp dead
 *  dataset refs to null — never drop the window itself, see decision #4;
 *  clamp geometry to finite, non-negative numbers). `viewport` (PR E2)
 *  additionally clamps every window's restored x/y so its top-left stays
 *  reachable — INCLUDING a maximized/minimized one: its stored geometry is
 *  the "restore to normal" target `restoreWindow`/`toggleMaximizeWindow`
 *  (store/windows.ts) apply verbatim on un-maximize/un-minimize, so leaving
 *  it unclamped would just recreate an unreachable window one click later.
 *  Width/height keep their existing finite-only clamp. Defaults to the real
 *  browser window, like lib/toolwindow.ts's `sanitizeToolWindowLayout`, so
 *  callers only override it in tests. Never throws. */
export function sanitizePlotWindows(
  v: unknown,
  dsIds: ReadonlySet<string>,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  },
): PlotWindow[] {
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
    // Item 19 v1: a panel window carries its dataset ids + layout in the
    // `panel` field, not a single `datasetId` (see PlotWindow.panel's doc).
    // A stale/removed dataset id simply drops out of the list (never nulls
    // the whole window — same "never force-close" spirit as decision #4);
    // an empty resulting list still loads (the empty-panel placeholder).
    const rawPanel =
      kind === "panel" && typeof o.panel === "object" && o.panel !== null
        ? (o.panel as Record<string, unknown>)
        : null;
    const panel =
      kind === "panel"
        ? { datasetIds: sanitizePanelDatasetIds(rawPanel?.datasetIds, dsIds), layout: sanitizePanelLayout(rawPanel?.layout) }
        : null;
    const g = (typeof o.geometry === "object" && o.geometry !== null ? o.geometry : {}) as Record<
      string,
      unknown
    >;
    const datasetId = typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    const winState = WIN_STATES.includes(o.winState as WinState) ? (o.winState as WinState) : "normal";
    // PR E2: clamp every winState's stored x/y — see this function's doc.
    const x = clampRestoreAxis(num(g.x, 0), viewport.width);
    const y = clampRestoreAxis(num(g.y, 0), viewport.height);
    out.push({
      id: o.id,
      kind,
      title: strOrDefault(o.title, ""),
      // Snapshot ("frozen means frozen") and panel (its binding is the
      // `panel.datasetIds` LIST, not a single id) windows are never
      // dataset-bound via this field.
      datasetId: kind === "snapshot" || kind === "panel" ? null : datasetId,
      geometry: {
        x,
        y,
        w: Math.max(1, num(g.w, DEFAULT_WIDTH)),
        h: Math.max(1, num(g.h, DEFAULT_HEIGHT)),
      },
      z: num(o.z, 0),
      winState,
      view: sanitizePlotView(o.view),
      bg: PLOT_BGS.includes(o.bg as PlotBg) ? (o.bg as PlotBg) : "theme",
      // Only plot windows can sync, and only groups 1..MAX_LINK_GROUP exist —
      // a hand-edited .dwk can't smuggle in a ⧟7 badge or a "linked" snapshot.
      linkGroup:
        kind === "plot" &&
        typeof o.linkGroup === "number" &&
        Number.isInteger(o.linkGroup) &&
        o.linkGroup >= 1 &&
        o.linkGroup <= MAX_LINK_GROUP
          ? o.linkGroup
          : null,
      pinned: o.pinned === true, // a boolean, else false (the plain-boolean view fields: plotviewSanitize.boolViewFields)
      ...(snapshot ? { snapshot } : {}),
      ...(panel ? { panel } : {}),
    });
  }
  return out;
}

/** Dataset-removal semantics are implemented in `store/windowDocuments.ts`: when datasets are
 *  deleted from the store — the single helper `removeDataset`/
 *  `removeSelected`/`removeDatasets` in `store/useApp.ts` all call, so the
 *  "never force-close a window" rule (decision #4) applies uniformly: a
 *  plain `kind:"plot"`/`"snapshot"`-adjacent window's `datasetId` nulls out
 *  (its existing behaviour), and a `kind:"panel"` window's `panel.
 *  datasetIds` drops the removed ids (item 19's "a removed dataset drops
 *  out of the panel" — the render layer already treats a missing id as an
 *  empty slot, and an empty `datasetIds` as the whole-window empty state).
 *  Identity (same window object) when nothing on it changed, so callers
 *  that spread this into other patch fields don't force needless re-renders. */
// Edge/sibling drag-snapping (item 12) moved to lib/windowSnap.ts (F2.3j) —
// pure window-geometry math with no PlotView involvement, extracted to fund
// the region-shades sanitizer below under this module's own size ratchet.
